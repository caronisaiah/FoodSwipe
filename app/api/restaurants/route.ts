import { getAllRestaurants } from "@/lib/db/restaurants";
import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";
import { isAllowedMarket } from "@/lib/markets";
import { getDefaultPublicMarket, getPublicSeedRestaurants } from "@/lib/publicMarket";

/*
  GET /api/restaurants  (public read)

  Content mode controls whether code-managed seed restaurants are visible
  alongside DB-published restaurants. The client fetches this and ranks locally.

  Market (M2A): FOODSWIPE_DEFAULT_MARKET chooses default public discovery.
  - no `?market`           → configured default (missing config = DC).
  - `?market=dc`           → DC. demo/mixed: seed + published; production:
                             published only, regardless of the default.
  - `?market=nyc`          → NYC published rows ONLY (seed is the DC market, so it
                             is never mixed in); honest empty list if none exist.
  - invalid/garbage market → falls back to the configured default. This is a public,
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
  // Explicit supported markets win, even if the default env is misconfigured.
  const market = isAllowedMarket(m) ? m : getDefaultPublicMarket();
  if (!market) return noStore({ restaurants: [] });
  const includeSeeds = shouldIncludeSeedRestaurants();
  try {
    const restaurants = await getAllRestaurants(market, { includeSeeds });
    return noStore({ restaurants });
  } catch {
    // Last-resort safety net. Seed fallback is allowed only outside production.
    return noStore({
      restaurants: getPublicSeedRestaurants(market),
    });
  }
}

function noStore(body: unknown): Response {
  return Response.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}
