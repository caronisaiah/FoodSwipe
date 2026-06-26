import { RESTAURANTS } from "@/lib/seed/restaurants";
import { getAllRestaurants } from "@/lib/db/restaurants";
import { DEFAULT_MARKET, isAllowedMarket, type Market } from "@/lib/markets";

/*
  GET /api/restaurants  (public read)

  The merged feed dataset: code-managed seed restaurants + DB-published
  restaurants. The client (feed + saved) fetches this and ranks locally.

  Market (Slice A2): the app is DC-first, so this route is **DC by default**.
  - no `?market`           → DC (seed + DC published) — current behavior, since
                             no non-DC rows exist yet, this is unchanged today.
  - `?market=dc`           → DC (seed + DC published).
  - `?market=nyc`          → NYC published rows ONLY (seed is the DC market, so it
                             is never mixed in); honest empty list if none exist.
  - invalid/garbage market → falls back to the DC default. This is a public,
                             degrade-safe READ route (it already prefers a safe
                             fallback over erroring), so we don't 400 here — unlike
                             the admin WRITE import route, which rejects bad input.

  Degrades safely: `getAllRestaurants` swallows DB errors internally (returns
  seed-only for DC), so a DB outage never empties the DC feed. A public market
  selector / feed UI is deferred (see README); this just makes the data reachable.
  `no-store` — published edits/promotions show on the next fetch.
*/
export async function GET(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("market");
  const m = raw ? raw.trim().toLowerCase() : "";
  // DC-first: absent OR invalid → the default market (dc).
  const market: Market = isAllowedMarket(m) ? m : DEFAULT_MARKET;
  try {
    const restaurants = await getAllRestaurants(market);
    return noStore({ restaurants });
  } catch {
    // Last-resort safety net: DC falls back to the always-present seed; a non-DC
    // market is honest about an empty result rather than leaking DC seed.
    return noStore({ restaurants: market === DEFAULT_MARKET ? RESTAURANTS : [] });
  }
}

function noStore(body: unknown): Response {
  return Response.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}
