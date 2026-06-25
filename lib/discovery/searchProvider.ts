/**
 * Social video discovery — Slice 2: search provider abstraction (server-only).
 *
 * A tiny, swappable interface over a web-search API. The only implementation is
 * Brave Web Search. The provider returns LEADS (title/url/snippet) — never media,
 * never truth. The API key is read from `process.env.BRAVE_SEARCH_API_KEY`
 * server-side and is NEVER returned to the client.
 *
 * Constraints: official Brave Web Search only (no local/video/image APIs); no
 * scraping; no media download. Auth failures throw `SearchAuthError` so the route
 * can abort cleanly; other per-query failures throw plain errors the route can
 * swallow without killing the whole run.
 */

export type SearchProviderName = "brave";

export interface RawSearchResult {
  title: string;
  url: string;
  description: string; // snippet (HTML stripped)
  rank: number; // 1-based position within this query's results
  provider: SearchProviderName;
  query: string;
}

export interface SearchProvider {
  name: SearchProviderName;
  isConfigured(): boolean;
  /** Run one query. Throws SearchAuthError on bad key; other errors on transient failures. */
  search(query: string, count: number): Promise<RawSearchResult[]>;
}

/** Thrown when the provider rejects the API key (401/403) — abort the whole run. */
export class SearchAuthError extends Error {}

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

function braveKey(): string | undefined {
  const k = process.env.BRAVE_SEARCH_API_KEY;
  return typeof k === "string" && k.trim().length > 0 ? k.trim() : undefined;
}

function stripTags(v: unknown): string {
  return typeof v === "string" ? v.replace(/<[^>]+>/g, "").trim() : "";
}

interface BraveWebResult {
  title?: unknown;
  url?: unknown;
  description?: unknown;
}
interface BraveResponse {
  web?: { results?: BraveWebResult[] };
}

export const braveProvider: SearchProvider = {
  name: "brave",
  isConfigured() {
    return Boolean(braveKey());
  },
  async search(query: string, count: number): Promise<RawSearchResult[]> {
    const key = braveKey();
    if (!key) throw new SearchAuthError("BRAVE_SEARCH_API_KEY not set");
    const c = Math.min(Math.max(Math.trunc(count) || 5, 1), 10); // hard cap 10 for this slice

    const url = new URL(BRAVE_ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(c));
    url.searchParams.set("country", "US");
    url.searchParams.set("search_lang", "en");
    url.searchParams.set("safesearch", "moderate");

    const res = await fetch(url, {
      headers: { "X-Subscription-Token": key, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      throw new SearchAuthError(`Brave Search rejected the API key (${res.status}).`);
    }
    if (!res.ok) {
      throw new Error(`Brave Search failed (${res.status}).`);
    }

    const data = (await res.json()) as BraveResponse;
    const results = Array.isArray(data.web?.results) ? (data.web?.results ?? []) : [];
    const out: RawSearchResult[] = [];
    results.forEach((r, i) => {
      const u = typeof r.url === "string" ? r.url.trim() : "";
      if (!u) return;
      out.push({
        title: stripTags(r.title),
        url: u,
        description: stripTags(r.description),
        rank: i + 1,
        provider: "brave",
        query,
      });
    });
    return out;
  },
};
