"use server";

import { cookies, headers } from "next/headers";
import { DISCOVERY_MARKET_COOKIE, getDiscoveryMarketSettings } from "@/lib/discoveryMarket";
import { isAllowedMarket } from "@/lib/markets";

export async function selectDiscoveryMarket(market: string): Promise<boolean> {
  if (!isAllowedMarket(market) || !getDiscoveryMarketSettings().selectableMarkets.includes(market)) {
    return false;
  }
  // Next checks Origin against Host for Server Actions. Require it to be present
  // so this browser-only mutation cannot use the missing-Origin compatibility path.
  if (!(await headers()).get("origin")) return false;

  (await cookies()).set(DISCOVERY_MARKET_COOKIE, market, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return true;
}
