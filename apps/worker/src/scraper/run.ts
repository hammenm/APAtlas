import { closeDb } from "@atlas/api/db";
import { deleteImage, imageFileName, storeImage } from "./images";
import { fetchImageInfo, fetchPages, listImplementations, type ImageInfo } from "./mediawiki";
import { parseGame } from "./parse";
import { getWikiRevisions, removeMissingWikiGames, setGameImage, syncGame, type SyncResult } from "./sync";

const FULL_RUN = process.argv.includes("--full");

// Guards against wiping the catalog when the wiki returns a truncated list.
const MIN_LISTED_RATIO = 0.9;

async function main(): Promise<void> {
  const startedAt = Date.now();

  const pages = await listImplementations();
  const known = await getWikiRevisions();
  const changed = pages.filter((page) => {
    const revisionAt = known.get(page.pageId);
    return FULL_RUN || !revisionAt || revisionAt < page.revisionAt;
  });
  log(`${pages.length} pages listed, ${changed.length} to process${FULL_RUN ? " (full run)" : ""}`);

  const games = (await fetchPages(changed.map((page) => page.pageId))).map(parseGame);

  const images = await fetchImageInfo(games.flatMap((game) => (game.imageFile ? [game.imageFile] : [])));

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const parsed of games) {
    for (const message of parsed.warnings) warn(parsed.name, message);

    try {
      const result = await syncGame(parsed);
      if (result.created) created++;
      else updated++;
      await syncImage(result, parsed.imageFile ? images.get(parsed.imageFile) : undefined, parsed.name);
    } catch (error) {
      failed++;
      console.error(`[${parsed.name}]`, error);
    }
  }

  let removed = 0;
  if (pages.length >= known.size * MIN_LISTED_RATIO) {
    removed = (await removeMissingWikiGames(pages.map((page) => page.pageId))).length;
  } else {
    warn("catalog", `only ${pages.length} pages listed for ${known.size} known, removal skipped`);
  }

  const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
  log(`done in ${duration}s: ${created} created, ${updated} updated, ${removed} removed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

async function syncImage(game: SyncResult, info: ImageInfo | undefined, name: string): Promise<void> {
  try {
    if (!info) {
      if (game.imageFile) {
        await setGameImage(game.gameId, null);
        await deleteImage(game.imageFile);
      }
      return;
    }

    const fileName = imageFileName(game.slug, info.sha1);
    if (fileName === game.imageFile) return;

    await storeImage(info.url, fileName);
    await setGameImage(game.gameId, fileName);
    if (game.imageFile) await deleteImage(game.imageFile);
  } catch (error) {
    warn(name, `image not updated: ${error instanceof Error ? error.message : error}`);
  }
}

function log(message: string): void {
  console.log(`[scraper] ${message}`);
}

function warn(subject: string, message: string): void {
  console.warn(`[scraper] ${subject}: ${message}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closeDb);
