import { RESTAURANTS } from "@/lib/seed/restaurants";
import { getAllRestaurants } from "@/lib/db/restaurants";

/*
  GET /api/restaurants  (public read)

  The merged feed dataset: code-managed seed restaurants + DB-published
  restaurants. The client (feed + saved) fetches this and ranks locally. Degrades
  safely: if the DB is down/unset, `getAllRestaurants` returns seed-only (it
  swallows DB errors internally), and this handler falls back to seed regardless,
  so a DB outage never empties the feed. `no-store` — published edits/promotions
  show on the next fetch.
*/
export async function GET(): Promise<Response> {
  try {
    const restaurants = await getAllRestaurants();
    return noStore({ restaurants: restaurants.length ? restaurants : RESTAURANTS });
  } catch {
    return noStore({ restaurants: RESTAURANTS });
  }
}

function noStore(body: unknown): Response {
  return Response.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}
