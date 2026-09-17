import "server-only";

import { DEFAULT_MARKET, isAllowedMarket, type Market } from "@/lib/markets";
import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";
import { RESTAURANTS } from "@/lib/seed/restaurants";
import type { Restaurant } from "@/lib/types";

let warnedInvalidDefault = false;

/** Consumer discovery default only; never changes stored/admin market defaults. */
export function getDefaultPublicMarket(
  raw = process.env.FOODSWIPE_DEFAULT_MARKET,
): Market | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return DEFAULT_MARKET;

  const market = raw.trim().toLowerCase();
  if (isAllowedMarket(market)) return market;

  if (!warnedInvalidDefault) {
    warnedInvalidDefault = true;
    console.warn(
      "Invalid FOODSWIPE_DEFAULT_MARKET. Default public discovery is disabled until configuration is corrected.",
    );
  }
  return null;
}

/** Never serialize another market's seeds, or any seeds in production mode. */
export function getPublicSeedRestaurants(market: Market | null): Restaurant[] {
  if (!market || !shouldIncludeSeedRestaurants()) return [];
  return RESTAURANTS.filter((restaurant) => restaurant.market === market);
}
