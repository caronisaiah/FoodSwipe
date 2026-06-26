/**
 * Multi-market support — Slice A1 (write-path foundation).
 *
 * The single source of truth for which markets FoodSwipe knows about and the
 * per-market geographic origin used to compute honest `distanceMiles`. The app is
 * DC-first today; `"dc"` is the default everywhere so existing behavior is
 * unchanged. Public feed filtering, a market selector, and market-aware discovery
 * are intentionally NOT here — those are later slices (A2+).
 *
 * Markets are an allow-list: untrusted input is validated/normalized through these
 * helpers, never stored raw.
 */

export const MARKETS = ["dc", "nyc"] as const;
export type Market = (typeof MARKETS)[number];

/** DC-first: the default for omitted/unknown input and for all backfilled rows. */
export const DEFAULT_MARKET: Market = "dc";

export interface MarketConfig {
  id: Market;
  /** Full UI name, e.g. "Washington, DC". */
  displayName: string;
  /** Compact UI label used in badges/share text, e.g. "DC" / "NYC". */
  shortName: string;
  /** Geographic origin for distanceMiles (honest estimate, never a fake metric). */
  origin: { lat: number; lng: number };
  /**
   * Primary location qualifier for discovery SEARCH QUERIES — the string quoted
   * alongside the restaurant name (A2 query generation), e.g. "Washington DC" /
   * "New York".
   */
  queryCity: string;
  /** Optional alternate query qualifiers (e.g. "DC", "NYC"). */
  searchTerms: string[];
  /**
   * Lowercase location terms used for discovery SCORING — a lead's title/snippet/
   * URL is checked for any of these (word-boundary matched) to award a city hit.
   * Includes the city, common abbreviations, and boroughs/areas. NEVER popularity.
   */
  locationTerms: string[];
}

const MARKET_CONFIG: Record<Market, MarketConfig> = {
  dc: {
    id: "dc",
    displayName: "Washington, DC",
    shortName: "DC",
    origin: { lat: 38.9072, lng: -77.0369 },
    queryCity: "Washington DC",
    searchTerms: ["Washington DC", "DC"],
    locationTerms: ["washington", "dc", "d.c."],
  },
  nyc: {
    id: "nyc",
    displayName: "New York City",
    shortName: "NYC",
    origin: { lat: 40.7128, lng: -74.006 },
    queryCity: "New York",
    searchTerms: ["New York", "NYC"],
    locationTerms: [
      "new york",
      "new york city",
      "nyc",
      "manhattan",
      "brooklyn",
      "queens",
      "the bronx",
      "bronx",
      "staten island",
    ],
  },
};

/** Strict membership test on the canonical (lowercase) market ids. */
export function isAllowedMarket(value: unknown): value is Market {
  return typeof value === "string" && (MARKETS as readonly string[]).includes(value);
}

/**
 * Coerce untrusted input (DB row or request value) to a valid Market. Trims and
 * lowercases, then falls back to the default for anything unrecognized — so a junk
 * DB value or omitted field can never produce an invalid market. Use this for
 * STORAGE/DISPLAY coercion; use `isAllowedMarket` when you want to REJECT bad
 * client input instead of silently defaulting.
 */
export function normalizeMarket(value: unknown): Market {
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (isAllowedMarket(v)) return v;
  }
  return DEFAULT_MARKET;
}

/** Origin coordinates for distance math; defaults to DC for unknown input. */
export function getMarketOrigin(market: unknown): { lat: number; lng: number } {
  return MARKET_CONFIG[normalizeMarket(market)].origin;
}

/** Human-readable market name; defaults to DC for unknown input. */
export function getMarketDisplayName(market: unknown): string {
  return MARKET_CONFIG[normalizeMarket(market)].displayName;
}

/** Compact market label for badges/share text ("DC"/"NYC"); defaults to DC. */
export function getMarketShortName(market: unknown): string {
  return MARKET_CONFIG[normalizeMarket(market)].shortName;
}

/** Primary location qualifier for discovery queries ("Washington DC"/"New York"). */
export function getMarketQueryCity(market: unknown): string {
  return MARKET_CONFIG[normalizeMarket(market)].queryCity;
}

/** Lowercase location terms for discovery SCORING (city + abbreviations + areas). */
export function getMarketLocationTerms(market: unknown): string[] {
  return MARKET_CONFIG[normalizeMarket(market)].locationTerms;
}

/** Full config for a market; defaults to DC for unknown input. */
export function getMarketConfig(market: unknown): MarketConfig {
  return MARKET_CONFIG[normalizeMarket(market)];
}

/** All known markets (e.g. for an admin dropdown). */
export function listMarkets(): MarketConfig[] {
  return MARKETS.map((m) => MARKET_CONFIG[m]);
}
