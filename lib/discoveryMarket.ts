import "server-only";

import { cookies } from "next/headers";
import { isAllowedMarket, type Market } from "@/lib/markets";

export const DISCOVERY_MARKET_COOKIE = "foodswipe.discovery-market.v1";

export function getDiscoveryMarketSettings() {
  const enableLocalDC = process.env.NODE_ENV === "development"
    && process.env.FOODSWIPE_ENABLE_DC_DISCOVERY === "true";
  const selectableMarkets: Market[] = enableLocalDC ? ["nyc", "dc"] : ["nyc"];
  const configured = process.env.FOODSWIPE_DEFAULT_MARKET?.trim().toLowerCase() || "nyc";
  const defaultMarket = isAllowedMarket(configured) && selectableMarkets.includes(configured)
    ? configured : null;
  return { selectableMarkets, defaultMarket };
}

export async function getDiscoveryMarket() {
  const { defaultMarket, selectableMarkets } = getDiscoveryMarketSettings();
  const stored = (await cookies()).get(DISCOVERY_MARKET_COOKIE)?.value;
  const validSelection = isAllowedMarket(stored) && selectableMarkets.includes(stored);
  return {
    market: validSelection ? stored : defaultMarket,
    selectableMarkets,
    resetSelection: stored !== undefined && !validSelection,
  };
}
