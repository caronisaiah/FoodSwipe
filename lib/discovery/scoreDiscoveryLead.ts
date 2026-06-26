import {
  getMarketDisplayName,
  getMarketLocationTerms,
  normalizeMarket,
  type Market,
} from "@/lib/markets";
import type { DiscoveryLead, DetectedPlatform } from "./normalizeSearchResults";

/**
 * Conservative, explainable match scoring for a discovery lead (pure). Scores how
 * likely a search lead is actually about THIS restaurant — never uses view/like/
 * comment counts (no public social proof). Output 0–100 + human reasons.
 *
 * Market-aware (A2): the "is this lead in the right city" signal uses the
 * restaurant's MARKET location terms (lib/markets), not hardcoded Washington/DC.
 * DC restaurants still match washington/dc; NYC restaurants match New York / NYC /
 * the boroughs. Omitted market → DC default (DC behavior unchanged).
 */

export interface ScoreRestaurantInput {
  name: string;
  /** Market id (lib/markets). Omitted/unknown → DC (DC-first default). */
  market?: Market | null;
  address?: string | null;
  neighborhood?: string | null;
  cuisineTags?: string[] | null;
  dishHighlights?: string[] | null;
}

const BASE_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "at", "on", "in", "to", "for", "co", "by",
  "restaurant", "cafe", "café", "bar", "grill", "kitchen", "house",
]);

/** Base stopwords + the market's location words (so "Brooklyn"/"Washington" never
 *  count as distinctive name tokens, market-aware rather than DC-only). */
function marketStopwords(market: Market): Set<string> {
  const stops = new Set(BASE_STOPWORDS);
  for (const term of getMarketLocationTerms(market)) {
    for (const tok of term.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)) {
      if (tok.length >= 3) stops.add(tok);
    }
  }
  return stops;
}

/**
 * Regex matching any of the market's location terms (city + areas). Long place
 * names (e.g. "washington", "brooklyn") match as substrings — preserving the prior
 * DC behavior where "washington" was an unanchored match (so "Washingtonian" still
 * counts). Short abbreviations (<=3 chars, e.g. "dc"/"nyc") are word-boundary
 * anchored so they don't match inside unrelated words (also matches prior `\bdc\b`).
 */
function marketLocationRegex(market: Market): RegExp {
  const parts = getMarketLocationTerms(market).map((t) => {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return t.length <= 3 ? `\\b${esc}\\b` : esc;
  });
  return new RegExp(`(${parts.join("|")})`, "i");
}

function distinctiveTokens(name: string, stops: Set<string>): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !stops.has(t));
}

// A URL path that is a single video (vs a profile/search/hashtag landing page).
const DIRECT_VIDEO_RE: Record<DetectedPlatform, RegExp> = {
  tiktok: /\/video\/\d+|\/player\/v1\/|\/embed\/v2\//,
  instagram: /\/(reel|reels|p|tv)\//,
  youtube: /\/shorts\/|\/watch|youtu\.be\//,
};

export function scoreDiscoveryLead(
  lead: DiscoveryLead,
  r: ScoreRestaurantInput,
): { matchConfidence: number; matchReasons: string[] } {
  const market = normalizeMarket(r.market);
  const stops = marketStopwords(market);
  const cityRe = marketLocationRegex(market);

  const text = `${lead.title} ${lead.snippet}`.toLowerCase();
  const url = lead.url.toLowerCase();
  const name = (r.name ?? "").trim();
  const nameLower = name.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  // 1) Restaurant name
  if (nameLower && text.includes(nameLower)) {
    score += 40;
    reasons.push(`Exact name "${name}" in title/snippet`);
  } else {
    const tokens = distinctiveTokens(name, stops);
    const hits = tokens.filter((t) => text.includes(t));
    if (tokens.length > 0 && hits.length === tokens.length) {
      score += 25;
      reasons.push("All name keywords present");
    } else if (hits.length > 0) {
      score += 8;
      reasons.push(`Partial name match (${hits.join(", ")})`);
    }
  }

  // 2) Location — market-aware (city + boroughs/areas), not hardcoded DC.
  const nb = (r.neighborhood ?? "").trim().toLowerCase();
  const cityHit = cityRe.test(text) || cityRe.test(url);
  const nbHit = nb.length > 2 && (text.includes(nb) || url.includes(nb.replace(/\s+/g, "")));
  if (nbHit) {
    score += 15;
    reasons.push(`Neighborhood "${r.neighborhood}" match`);
  } else if (cityHit) {
    score += 12;
    reasons.push(`${getMarketDisplayName(market)} match`);
  }

  // 3) Dish / cuisine overlap
  const terms = [...(r.dishHighlights ?? []), ...(r.cuisineTags ?? [])]
    .map((t) => (typeof t === "string" ? t.toLowerCase().trim() : ""))
    .filter((t) => t.length > 2);
  const termHit = terms.find((t) => text.includes(t));
  if (termHit) {
    score += 15;
    reasons.push(`Mentions "${termHit}"`);
  }

  // 4) Direct video vs profile/search page
  const dp = lead.detectedPlatform;
  const directRe = dp ? DIRECT_VIDEO_RE[dp] : null;
  const isDirectVideo = Boolean(lead.platformVideoId) || (directRe ? directRe.test(url) : false);
  const isProfileOrSearch =
    /\/(tag|tags|explore|search|hashtag)\b/.test(url) ||
    /tiktok\.com\/@[^/]+\/?$/.test(url) ||
    (/instagram\.com\/[^/]+\/?$/.test(url) && !/\/(reel|reels|p|tv)\//.test(url));
  if (isDirectVideo) {
    score += 15;
    reasons.push("Direct video URL");
  } else if (isProfileOrSearch) {
    score -= 20;
    reasons.push("Looks like a profile/search page, not a single video");
  }

  // 5) Resolver outcome (source-link-only is acceptable, just lower)
  if (lead.resolverStatus === "resolved" && lead.legalDisplayStatus === "embeddable") {
    score += 10;
    reasons.push("Resolved to an embeddable video");
  } else if (lead.resolverStatus === "failed") {
    score -= 10;
    reasons.push("Resolver could not confirm a playable video");
  }

  // 6) Generic/chain ambiguity without a location anchor
  if (distinctiveTokens(name, stops).length <= 1 && !cityHit && !nbHit) {
    score -= 25;
    reasons.push("Generic name without a city match — likely ambiguous");
  }

  const matchConfidence = Math.max(0, Math.min(100, Math.round(score)));
  if (reasons.length === 0) reasons.push("No strong signals");
  return { matchConfidence, matchReasons: reasons };
}
