/**
 * Social video discovery — deterministic search-query generator.
 *
 * PURE + side-effect-free. Given a restaurant, it produces a small set of
 * name-anchored, platform-targeted search queries an admin can run by hand to
 * find TikTok/Instagram/YouTube review videos faster. It makes NO network calls,
 * NO DB writes, and creates NO candidates — it only builds query strings + a
 * "run in browser" search URL. Later slices may feed these queries to a search
 * provider, but this module stays provider-agnostic and offline.
 *
 * Anti-flood rules: every query is anchored on the EXACT restaurant name in
 * quotes plus a location qualifier; we never emit bare cuisine/dish queries.
 *
 * Market-aware (A2): the location qualifier comes from the restaurant's MARKET
 * (lib/markets), not a hardcoded "Washington DC". DC restaurants still get
 * "Washington DC"; an NYC restaurant gets "New York" (+ its neighborhood/borough
 * if present). Examples:
 *   DC  (market "dc"):  "Le Diplomate" "Washington DC" site:tiktok.com
 *   NYC (market "nyc"): "Lucali" "New York" site:tiktok.com
 *                       "Lucali" "Carroll Gardens" site:tiktok.com  (neighborhood)
 */

import { getMarketLocationTerms, getMarketQueryCity, normalizeMarket, type Market } from "@/lib/markets";

export type DiscoveryPlatform = "tiktok" | "instagram" | "youtube" | "web";

export type DiscoveryQueryType =
  | "exact_name"
  | "review"
  | "dish"
  | "neighborhood"
  | "creator_keyword"
  | "fallback";

export interface DiscoveryRestaurantInput {
  name: string;
  slug?: string | null;
  /** Market id (lib/markets). Omitted/unknown → DC (DC-first default). */
  market?: Market | null;
  neighborhood?: string | null;
  address?: string | null;
  cuisineTags?: string[] | null;
  dishHighlights?: string[] | null;
  websiteDomain?: string | null;
}

export interface GeneratedDiscoveryQuery {
  /** Stable key for React lists. */
  key: string;
  /** The search query text (anchored on the quoted restaurant name). */
  query: string;
  platform: DiscoveryPlatform;
  queryType: DiscoveryQueryType;
  /** Human explanation of why this query exists. */
  reason: string;
  /** A normal web-search URL the admin opens in a new tab (no API call). */
  searchUrl: string;
  /** Name-level cautions (generic/chain-like name, missing location, …). */
  warnings?: string[];
}

// Tokens that don't make a name distinctive (so we can flag generic names).
// Market location words (e.g. "washington", "brooklyn") are added per-market at
// call time so the generic-name check is market-aware, not DC-only.
const BASE_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "at", "on", "in", "to", "for", "co", "by",
  "restaurant", "cafe", "café", "bar", "grill", "kitchen", "house", "eatery",
  "bistro", "tavern",
]);

/** Split a market's location terms into single tokens usable as stopwords. */
function marketStopwords(market: Market): Set<string> {
  const stops = new Set(BASE_STOPWORDS);
  for (const term of getMarketLocationTerms(market)) {
    for (const tok of term.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)) {
      if (tok.length >= 3) stops.add(tok);
    }
  }
  return stops;
}

// A few obvious chains — these almost always have many locations, so a query
// must be location-anchored and the admin must verify the city/handle.
const KNOWN_CHAINS = new Set([
  "mcdonalds", "starbucks", "chipotle", "shakeshack", "fiveguys", "subway",
  "dominos", "chickfila", "wendys", "tacobell", "dunkin", "sweetgreen", "cava",
  "pizzahut", "kfc", "popeyes", "wingstop", "panerabread",
]);

function distinctiveTokens(name: string, stops: Set<string>): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !stops.has(t));
}

function isChainLike(name: string): boolean {
  return KNOWN_CHAINS.has(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

function searchUrl(query: string): string {
  // A normal Google web-search URL the admin runs manually — NOT an API call.
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * Generate a small set (~6–10) of deterministic, name-anchored discovery queries.
 * Empty array if there's no usable name.
 */
export function generateDiscoveryQueries(
  input: DiscoveryRestaurantInput,
): GeneratedDiscoveryQuery[] {
  const name = (input.name ?? "").trim();
  if (!name) return [];

  const market = normalizeMarket(input.market);
  const stops = marketStopwords(market);

  const quoted = `"${name}"`;
  // Location qualifier comes from the MARKET (DC → "Washington DC", NYC → "New
  // York"), never hardcoded.
  const city = getMarketQueryCity(market);
  const cityQ = `"${city}"`;

  const neighborhood = (input.neighborhood ?? "").trim();
  const nbLower = neighborhood.toLowerCase();
  // A neighborhood adds signal only if it isn't just the city/market name itself.
  const neighborhoodUsable =
    neighborhood.length > 0 &&
    nbLower !== city.toLowerCase() &&
    !getMarketLocationTerms(market).includes(nbLower);

  const dishes = (Array.isArray(input.dishHighlights) ? input.dishHighlights : [])
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter((d) => d.length > 0)
    .slice(0, 2); // top 1–2 only — avoid flooding the queue

  // Name-level cautions, attached to every query so the admin reads results carefully.
  const warnings: string[] = [];
  if (isChainLike(name)) {
    warnings.push("Name looks like a chain — results may be other locations; verify the city/handle before importing.");
  } else if (distinctiveTokens(name, stops).length <= 1) {
    warnings.push("Short/generic name — results may be ambiguous; verify against the address/neighborhood.");
  }
  const warn = warnings.length > 0 ? warnings : undefined;

  const out: GeneratedDiscoveryQuery[] = [];
  let n = 0;
  const add = (
    platform: DiscoveryPlatform,
    queryType: DiscoveryQueryType,
    query: string,
    reason: string,
  ) => {
    out.push({ key: `${queryType}-${platform}-${n++}`, query, platform, queryType, reason, searchUrl: searchUrl(query), warnings: warn });
  };

  // exact_name — one per platform (always name + location).
  add("tiktok", "exact_name", `${quoted} ${cityQ} site:tiktok.com`, `Exact name in ${city} on TikTok`);
  add("instagram", "exact_name", `${quoted} ${cityQ} site:instagram.com/reel`, `Exact name in ${city} on Instagram Reels`);
  add("youtube", "exact_name", `${quoted} ${cityQ} site:youtube.com/shorts`, `Exact name in ${city} on YouTube Shorts`);

  // review
  add("tiktok", "review", `${quoted} review site:tiktok.com`, `Name + "review" on TikTok`);

  // dish — only when real dish highlights exist (top 1–2). Never invent dishes.
  for (const dish of dishes) {
    add("tiktok", "dish", `${quoted} "${dish}" site:tiktok.com`, `Name + dish "${dish}" on TikTok`);
  }

  // neighborhood — only when it adds signal beyond the city.
  if (neighborhoodUsable) {
    add("tiktok", "neighborhood", `${quoted} "${neighborhood}" site:tiktok.com`, `Name + neighborhood "${neighborhood}" on TikTok`);
  }

  // creator_keyword — name + a food-creator term.
  add("tiktok", "creator_keyword", `${quoted} foodie site:tiktok.com`, `Name + creator keyword ("foodie") on TikTok`);

  // fallback — exact name + location across the whole web (no site filter).
  add("web", "fallback", `${quoted} ${cityQ}`, `Name + ${city} across the web (no site filter)`);

  return out;
}
