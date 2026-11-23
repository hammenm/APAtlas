const API_URL = "https://archipelago.miraheze.org/w/api.php";
const IMPLEMENTATIONS_CATEGORY = "Category:Implementations";
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 3;

const USER_AGENT = process.env.SCRAPER_USER_AGENT;
if (!USER_AGENT) {
  throw new Error("SCRAPER_USER_AGENT is missing");
}

type Params = Record<string, string>;

interface ApiPage {
  pageid?: number;
  title: string;
  missing?: boolean;
  revisions?: { timestamp: string; slots?: { main?: { content?: string } } }[];
  categories?: { title: string }[];
  imageinfo?: { url: string; sha1: string }[];
}

interface ApiResponse {
  continue?: Params;
  query?: {
    pages?: ApiPage[];
    normalized?: { from: string; to: string }[];
  };
  error?: { code: string; info: string };
}

export interface PageSummary {
  pageId: number;
  title: string;
  revisionAt: Date;
}

export interface PageContent extends PageSummary {
  wikitext: string;
  categories: string[];
}

export interface ImageInfo {
  url: string;
  sha1: string;
}

/** Every page in the implementations category, with its last revision date. */
export async function listImplementations(): Promise<PageSummary[]> {
  const pages = await queryPages({
    action: "query",
    generator: "categorymembers",
    gcmtitle: IMPLEMENTATIONS_CATEGORY,
    gcmnamespace: "0",
    gcmlimit: "max",
    prop: "revisions",
    rvprop: "timestamp",
  });

  return pages.flatMap((page) => {
    const revision = page.revisions?.[0];
    if (!page.pageid || !revision) return [];
    return [{ pageId: page.pageid, title: page.title, revisionAt: new Date(revision.timestamp) }];
  });
}

/** Wikitext and categories of the given pages. */
export async function fetchPages(pageIds: number[]): Promise<PageContent[]> {
  const result: PageContent[] = [];

  for (const batch of chunk(pageIds, BATCH_SIZE)) {
    const pages = await queryPages({
      action: "query",
      pageids: batch.join("|"),
      prop: "revisions|categories",
      rvprop: "content|timestamp",
      rvslots: "main",
      cllimit: "max",
    });

    for (const page of pages) {
      const revision = page.revisions?.[0];
      const wikitext = revision?.slots?.main?.content;
      if (!page.pageid || !revision || wikitext === undefined) continue;

      result.push({
        pageId: page.pageid,
        title: page.title,
        revisionAt: new Date(revision.timestamp),
        wikitext,
        categories: (page.categories ?? []).map((category) => category.title),
      });
    }
  }

  return result;
}

/** Download URL and SHA-1 of the given files, keyed by the title as requested. */
export async function fetchImageInfo(fileTitles: string[]): Promise<Map<string, ImageInfo>> {
  const result = new Map<string, ImageInfo>();

  for (const batch of chunk([...new Set(fileTitles)], BATCH_SIZE)) {
    const requestedTitle = new Map<string, string>();
    const pages: ApiPage[] = [];

    for await (const data of paginate({
      action: "query",
      titles: batch.join("|"),
      prop: "imageinfo",
      iiprop: "url|sha1",
    })) {
      for (const { from, to } of data.query?.normalized ?? []) requestedTitle.set(to, from);
      pages.push(...(data.query?.pages ?? []));
    }

    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      result.set(requestedTitle.get(page.title) ?? page.title, { url: info.url, sha1: info.sha1 });
    }
  }

  return result;
}

/** Runs a query through all its continuations and merges partial results per page. */
async function queryPages(params: Params): Promise<ApiPage[]> {
  const pages = new Map<string, ApiPage>();

  for await (const data of paginate(params)) {
    for (const page of data.query?.pages ?? []) {
      const existing = pages.get(page.title);
      if (!existing) {
        pages.set(page.title, { ...page });
        continue;
      }
      existing.revisions ??= page.revisions;
      if (page.categories) {
        existing.categories = [...(existing.categories ?? []), ...page.categories];
      }
    }
  }

  return [...pages.values()];
}

async function* paginate(params: Params): AsyncGenerator<ApiResponse> {
  let next: Params | undefined = {};
  while (next) {
    const data = await request({ ...params, ...next });
    yield data;
    next = data.continue;
  }
}

async function request(params: Params): Promise<ApiResponse> {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({
    ...params,
    format: "json",
    formatversion: "2",
    maxlag: "5",
  }).toString();

  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT!, Accept: "application/json" },
    });

    const retryable = response.status === 429 || response.status >= 500;
    if (!response.ok) {
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      await sleep(retryDelay(response));
      continue;
    }

    const data = (await response.json()) as ApiResponse;
    if (data.error?.code === "maxlag" && attempt < MAX_ATTEMPTS) {
      await sleep(retryDelay(response));
      continue;
    }
    if (data.error) {
      throw new Error(`MediaWiki error ${data.error.code}: ${data.error.info}`);
    }
    return data;
  }
}

function retryDelay(response: Response): number {
  const seconds = Number(response.headers.get("Retry-After"));
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 5) * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
