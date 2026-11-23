import { mkdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";

const IMAGE_DIR = resolve(process.env.IMAGE_DIR ?? "../../storage/images");
const USER_AGENT = process.env.SCRAPER_USER_AGENT ?? "atlas-scraper";
const MAX_WIDTH = 460;
const QUALITY = 80;
const HASH_LENGTH = 8;

/** The SHA-1 suffix changes whenever the source image changes, which also busts browser caches. */
export function imageFileName(slug: string, sha1: string): string {
  return `${slug}-${sha1.slice(0, HASH_LENGTH)}.webp`;
}

export async function storeImage(sourceUrl: string, fileName: string): Promise<void> {
  const response = await fetch(sourceUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${sourceUrl}`);
  }

  const input = Buffer.from(await response.arrayBuffer());
  await mkdir(IMAGE_DIR, { recursive: true });
  await sharp(input)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toFile(join(IMAGE_DIR, fileName));
}

export async function deleteImage(fileName: string): Promise<void> {
  await unlink(join(IMAGE_DIR, fileName)).catch(() => undefined);
}
