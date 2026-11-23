import type { apStatus, linkKind, tagKind } from "@atlas/api/db";
import { extractInfobox, findTemplates, type Template } from "./infobox";
import type { PageContent } from "./mediawiki";

type ApStatus = (typeof apStatus.enumValues)[number];
type LinkKind = (typeof linkKind.enumValues)[number];
type TagKind = (typeof tagKind.enumValues)[number];

export interface ParsedGame {
  pageId: number;
  name: string;
  revisionAt: Date;
  apStatus: ApStatus | null;
  imageFile: string | null;
  isBroken: boolean;
  isFree: boolean;
  adultContent: boolean;
  links: { kind: LinkKind; url: string }[];
  tags: { kind: TagKind; name: string }[];
  warnings: string[];
}

const STATUS_VALUES: Record<string, ApStatus> = {
  "core-verified": "core_verified",
  "approved for core": "approved_for_core",
  "submitted for core review": "submitted_for_core_review",
  custom: "custom",
  // After Dark implementations can never be core-verified, so they are always custom.
  "after dark": "custom",
  discontinued: "discontinued",
};

const AFTER_DARK_STATUS = "after dark";

const LINK_FIELDS: Record<string, LinkKind> = {
  "ap-infolink": "info",
  "ap-setuplink": "setup_guide",
  "ap-optionslink": "options",
  "ap-download": "download",
  "ap-repolink": "repository",
  "ap-bugreportlink": "community",
  "ap-techsupportlink": "community",
  "ap-gamelink": "other",
};

const TAG_FIELDS: Record<string, TagKind> = {
  platform: "platform",
  genre: "genre",
  developer: "developer",
  publisher: "publisher",
  series: "series",
  "ap-maintainer": "maintainer",
};

// Category names are normalized first (see normalizeCategory), so "Free games" matches "free implementations".
const FLAG_CATEGORIES = {
  isBroken: ["implementations that are broken on archipelago main"],
  isFree: ["free implementations", "implementations created for archipelago"],
  adultContent: ["after dark implementations", "erotic implementations"],
} as const;

const FEATURE_CATEGORIES: Record<string, string> = {
  "implementations playable on mac": "Playable on Mac",
  "mac compatible": "Playable on Mac",
  "implementations that require a rom at generation": "Requires a ROM",
};

const FEATURE_PREFIX = "implementations with ";
const IGNORED_FEATURES = new Set(["ai disclosures"]);

/** A page without "Infobox game" (e.g. a pointer to a dedicated wiki) still yields a game with its name. */
export function parseGame(page: PageContent): ParsedGame {
  const warnings: string[] = [];
  const found = extractInfobox(page.wikitext);
  if (!found) warnings.push("no Infobox game template, created with its name only");
  const infobox = found ?? new Map<string, string>();
  const categories = new Set(page.categories.map(normalizeCategory));

  const rawStatus = toPlainText(infobox.get("ap-status") ?? "");
  const status = rawStatus ? (STATUS_VALUES[rawStatus.toLowerCase()] ?? null) : null;
  if (rawStatus && !status) warnings.push(`Unknown ap-status "${rawStatus}"`);

  const links = Object.entries(LINK_FIELDS).flatMap(([field, kind]) =>
    extractUrls(infobox.get(field) ?? "").map((url) => ({ kind, url })),
  );

  const fieldTags = Object.entries(TAG_FIELDS).flatMap(([field, kind]) =>
    splitValues(infobox.get(field) ?? "").map((name) => ({ kind, name })),
  );
  const featureTags = page.categories.flatMap((category) => {
    const name = featureFromCategory(category);
    return name ? [{ kind: "feature" as const, name }] : [];
  });

  const hasAny = (names: readonly string[]) => names.some((name) => categories.has(name));

  return {
    pageId: page.pageId,
    name: page.title,
    revisionAt: page.revisionAt,
    apStatus: status,
    imageFile: extractImageFile(infobox.get("boxart")),
    isBroken: hasAny(FLAG_CATEGORIES.isBroken),
    isFree: hasAny(FLAG_CATEGORIES.isFree),
    adultContent: hasAny(FLAG_CATEGORIES.adultContent) || rawStatus.toLowerCase() === AFTER_DARK_STATUS,
    links: uniqueBy(links, (link) => `${link.kind}|${link.url}`),
    tags: uniqueBy([...fieldTags, ...featureTags], (tag) => `${tag.kind}|${tag.name.toLowerCase()}`),
    warnings,
  };
}

/** "Category:Games with Death Link" → "implementations with death link" (the wiki is migrating from "games"). */
function normalizeCategory(category: string): string {
  return category
    .replace(/^Category:/i, "")
    .toLowerCase()
    .replace(/\bgames\b/g, "implementations")
    .trim();
}

function featureFromCategory(category: string): string | null {
  const normalized = normalizeCategory(category);
  const known = FEATURE_CATEGORIES[normalized];
  if (known) return known;
  if (!normalized.startsWith(FEATURE_PREFIX)) return null;

  // Keep the wiki's own casing: "Category:Implementations with PopTracker" → "PopTracker".
  const rest = category.replace(/^Category:/i, "").replace(/^(implementations|games) with\s+/i, "").trim();
  if (!rest || IGNORED_FEATURES.has(rest.toLowerCase())) return null;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

function extractUrls(value: string): string[] {
  const templates = findTemplates(value);
  const fromTemplates = templates.flatMap((template) => {
    if (template.name.toLowerCase() !== "apgg") return [];
    const url = apggUrl(template.args[0], template.args[1]);
    return url ? [url] : [];
  });

  const withoutTemplates = templates.reduce((text, template) => text.replace(template.raw, ""), value);
  const fromText = withoutTemplates.match(/https?:\/\/[^\s\]|<]+/g) ?? [];

  return [...fromTemplates, ...fromText];
}

// Mirrors Template:Apgg on the wiki.
function apggUrl(kind: string | undefined, game: string | undefined): string | null {
  if (!game) return null;
  const encoded = game.trim().replace(/ /g, "%20");
  switch (kind?.trim()) {
    case "info":
      return `https://archipelago.gg/games/${encoded}/info/en`;
    case "setup":
      return `https://archipelago.gg/tutorial/#${encoded}`;
    case "options":
      return `https://archipelago.gg/games/${encoded}/player-options`;
    default:
      return null;
  }
}

function extractImageFile(value: string | undefined): string | null {
  if (!value) return null;
  const match = /(?:File|Image)\s*:\s*([^\]|}]+)/i.exec(value);
  const name = (match?.[1] ?? value).trim();
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name) ? `File:${name}` : null;
}

function splitValues(value: string): string[] {
  return toPlainText(value, ",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Strips wiki markup. Each template is followed by `separator` so adjacent ones stay distinct. */
function toPlainText(value: string, separator = ""): string {
  let text = value;
  for (const template of findTemplates(value)) {
    text = text.replace(template.raw, toPlainText(renderTemplate(template), separator) + separator);
  }

  return text
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<br\s*\/?>/gi, ",")
    .replace(/<[^>]+>/g, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/'{2,}/g, "")
    .trim();
}

// {{platform|Personal computer|PC}} and {{genre|...}} keep their canonical first argument,
// {{wp|Target|Label}} and other templates keep their displayed (last) argument.
function renderTemplate(template: Template): string {
  const name = template.name.toLowerCase();
  if (name === "platform" || name === "genre") return template.args[0] ?? "";
  return template.args.at(-1) ?? "";
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item);
  return [...seen.values()];
}
