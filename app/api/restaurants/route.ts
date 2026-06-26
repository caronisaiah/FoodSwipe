import { RESTAURANTS } from "@/lib/seed/restaurants";
import { getAllRestaurants } from "@/lib/db/restaurants";
import { isAllowedMarket, type Market } from "@/lib/markets";

/*
  GET /api/restaurants  (public read)

  The merged feed dataset: code-managed seed restaurants + DB-published
  restaurants. The client (feed + saved) fetches this and ranks locally. Degrades
  safely: if the DB is down/unset, `getAllRestaurants` returns seed-only (it
  swallows DB errors internally), and this handler falls back to seed when NO
  market filter is applied, so a DB outage never empties the default feed.
  `no-store` — published edits/promotions show on the next fetch.

  Optional `?market=dc|nyc` (Slice A1, backward-compatible): omitted → today's
  behavior (seed + all published). An explicit market returns ONLY that market's
  rows (seed counts as "dc") and is honest about an empty result — no seed
  fallback, so `?market=nyc` with no NYC rows returns []. A public market
  selector / feed UI is deferred to A2; this param just makes the data reachable.
*/
export async function GET(req: Request): Promise<Response> {
  const raw = new URL(req.url).searchParams.get("market");
  const m = raw ? raw.trim().toLowerCase() : "";
  const market: Market | undefined = isAllowedMarket(m) ? m : undefined;
  try {
    const restaurants = await getAllRestaurants(market);
    // With an explicit market, an empty list is a truthful answer (don't leak seed).
    if (market) return noStore({ restaurants });
    return noStore({ restaurants: restaurants.length ? restaurants : RESTAURANTS });
  } catch {
    // Last-resort safety net: only the default (no-filter) feed falls back to seed.
    return noStore({ restaurants: market ? [] : RESTAURANTS });
  }
}

function noStore(body: unknown): Response {
  return Response.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}
