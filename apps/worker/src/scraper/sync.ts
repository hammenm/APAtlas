import { and, eq, inArray, like, notInArray, or } from "drizzle-orm";
import { db, game, gameLink, gameSource, gameTag, tag, type tagKind } from "@atlas/api/db";
import { slugify } from "@atlas/api/domain";
import type { ParsedGame } from "./parse";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type TagKind = (typeof tagKind.enumValues)[number];

// The wiki scraper owns these tag kinds: it replaces them freely on every update.
const WIKI_TAG_KINDS: TagKind[] = ["genre", "platform", "developer", "publisher", "series", "maintainer", "feature"];

export interface SyncResult {
  gameId: number;
  slug: string;
  imageFile: string | null;
  created: boolean;
}

/** Last known revision of every wiki page, keyed by page id. */
export async function getWikiRevisions(): Promise<Map<number, Date | null>> {
  const rows = await db
    .select({ externalId: gameSource.externalId, revisionAt: gameSource.revisionAt })
    .from(gameSource)
    .where(eq(gameSource.source, "wiki"));

  return new Map(rows.map((row) => [Number(row.externalId), row.revisionAt]));
}

export async function syncGame(parsed: ParsedGame): Promise<SyncResult> {
  return db.transaction(async (tx) => {
    const externalId = String(parsed.pageId);
    const sourceMatch = and(eq(gameSource.source, "wiki"), eq(gameSource.externalId, externalId));
    const [existing] = await tx.select({ gameId: gameSource.gameId }).from(gameSource).where(sourceMatch);

    let result: SyncResult;

    if (existing) {
      const [row] = await tx
        .update(game)
        .set(wikiFields(parsed))
        .where(eq(game.id, existing.gameId))
        .returning({ id: game.id, slug: game.slug, imageFile: game.imageFile });
      if (!row) throw new Error(`Game ${existing.gameId} not found`);

      await tx.update(gameSource).set({ revisionAt: parsed.revisionAt }).where(sourceMatch);
      result = { gameId: row.id, slug: row.slug, imageFile: row.imageFile, created: false };
    } else {
      const slug = await uniqueSlug(tx, parsed.name, parsed.pageId);
      const [row] = await tx
        .insert(game)
        .values({ slug, ...wikiFields(parsed) })
        .returning({ id: game.id });
      if (!row) throw new Error(`Could not create game "${parsed.name}"`);

      await tx
        .insert(gameSource)
        .values({ gameId: row.id, source: "wiki", externalId, revisionAt: parsed.revisionAt });
      result = { gameId: row.id, slug, imageFile: null, created: true };
    }

    await replaceLinks(tx, result.gameId, parsed.links);
    await replaceTags(tx, result.gameId, parsed.tags);
    return result;
  });
}

// Game columns owned by the wiki: overwritten on every update of the page.
function wikiFields(parsed: ParsedGame) {
  return {
    name: parsed.name,
    apStatus: parsed.apStatus,
    isBroken: parsed.isBroken,
    isFree: parsed.isFree,
    adultContent: parsed.adultContent,
  };
}

export async function setGameImage(gameId: number, imageFile: string | null): Promise<void> {
  await db.update(game).set({ imageFile }).where(eq(game.id, gameId));
}

/**
 * Detaches games whose page left the implementations category.
 * The game itself is kept: it may come from other sources, and hiding it is an admin decision.
 */
export async function removeMissingWikiGames(currentPageIds: number[]): Promise<number[]> {
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(gameSource)
      .where(and(eq(gameSource.source, "wiki"), notInArray(gameSource.externalId, currentPageIds.map(String))))
      .returning({ gameId: gameSource.gameId });

    const gameIds = removed.map((row) => row.gameId);
    if (gameIds.length > 0) {
      await tx.delete(gameLink).where(and(inArray(gameLink.gameId, gameIds), eq(gameLink.source, "wiki")));
      await tx.delete(gameTag).where(and(inArray(gameTag.gameId, gameIds), inArray(gameTag.tagId, wikiTagIds(tx))));
    }
    return gameIds;
  });
}

async function replaceLinks(tx: Transaction, gameId: number, links: ParsedGame["links"]): Promise<void> {
  await tx.delete(gameLink).where(and(eq(gameLink.gameId, gameId), eq(gameLink.source, "wiki")));
  if (links.length === 0) return;

  // A link already provided by another source keeps its original owner.
  await tx
    .insert(gameLink)
    .values(links.map((link) => ({ gameId, kind: link.kind, url: link.url, source: "wiki" as const })))
    .onConflictDoNothing();
}

async function replaceTags(tx: Transaction, gameId: number, tags: ParsedGame["tags"]): Promise<void> {
  await tx.delete(gameTag).where(and(eq(gameTag.gameId, gameId), inArray(gameTag.tagId, wikiTagIds(tx))));

  const rows = new Map<string, { kind: TagKind; slug: string; name: string }>();
  for (const { kind, name } of tags) {
    const slug = slugify(name);
    if (slug && !rows.has(`${kind}|${slug}`)) rows.set(`${kind}|${slug}`, { kind, slug, name });
  }
  if (rows.size === 0) return;

  const values = [...rows.values()];
  await tx.insert(tag).values(values).onConflictDoNothing({ target: [tag.kind, tag.slug] });

  const tagIds = await tx
    .select({ id: tag.id })
    .from(tag)
    .where(or(...values.map((value) => and(eq(tag.kind, value.kind), eq(tag.slug, value.slug)))));

  await tx
    .insert(gameTag)
    .values(tagIds.map(({ id }) => ({ gameId, tagId: id })))
    .onConflictDoNothing();
}

function wikiTagIds(tx: Transaction) {
  return tx.select({ id: tag.id }).from(tag).where(inArray(tag.kind, WIKI_TAG_KINDS));
}

async function uniqueSlug(tx: Transaction, name: string, pageId: number): Promise<string> {
  const base = slugify(name) || `game-${pageId}`;
  const taken = await tx
    .select({ slug: game.slug })
    .from(game)
    .where(or(eq(game.slug, base), like(game.slug, `${base}-%`)));

  const slugs = new Set(taken.map((row) => row.slug));
  if (!slugs.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    if (!slugs.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
  }
}
