import { RESTAURANTS } from "@/lib/seed/restaurants";
import { getAllRestaurants } from "@/lib/db/restaurants";
import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";
import { DEFAULT_MARKET, isAllowedMarket, type Market } from "@/lib/markets";

/*
  GET /api/restaurants  (public read)

  Content mode controls whether code-managed seed restaurants are visible
  alongside DB-published restaurants. The client fetches this and ranks locally.

  Market (Slice A2): the app is DC-first, so this route is **DC by default**.
  - no `?market`           → DC. demo/mixed: seed + published; production:
                             published only.
  - `?market=dc`           → same as above for DC.
  - `?market=nyc`          → NYC published rows ONLY (seed is the DC market, so it
                             is never mixed in); honest empty list if none exist.
  - invalid/garbage market → falls back to the DC default. This is a public,
                             degrade-safe READ route (it already prefers a safe
                             fallback over erroring), so we don't 400 here — unlike
                             the admin WRITE import route, which rejects bad input.

  Degrades safely for demo/mixed. Production never falls back to seeds, so an
  empty/down DB stays an honest empty list instead of showing demo content.
  `no-store` — published edits/promotions show on the next fetch.
*/
export async function GET(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("market");
  const m = raw ? raw.trim().toLowerCase() : "";
  // DC-first: absent OR invalid → the default market (dc).
  const market: Market = isAllowedMarket(m) ? m : DEFAULT_MARKET;
  const includeSeeds = shouldIncludeSeedRestaurants();
  try {
    const restaurants = await getAllRestaurants(market, { includeSeeds });
    return noStore({ restaurants });
  } catch {
    // Last-resort safety net. Seed fallback is allowed only outside production.
    return noStore({
      restaurants: includeSeeds && market === DEFAULT_MARKET ? RESTAURANTS : [],
    });
  }
}

function noStore(body: unknown): Response {
  return Response.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}
