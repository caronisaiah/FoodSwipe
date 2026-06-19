import { getRestaurantById } from "@/lib/seed/restaurants";
import { getPlacePhoto } from "@/lib/places";

/*
  GET /api/restaurants/[id]/photo  (public read, v1.5)

  Returns a fresh Google Place Photo for a seeded restaurant that has a
  `googlePlaceId`. The response always includes a safe diagnostic `status`
  (e.g. "ok" / "missing-api-key" / "place-details-failed" / "no-photos"), and
  `photo` is null on anything but "ok". The client hero reads `photo` to show a
  real identity image and falls back to the video-style placeholder on null; the
  `status` (+ optional numeric httpStatus / Google error enum) is for debugging
  and contains NO secrets and NO raw Google body.

  Caching: NONE. Google Places policy forbids caching the photo `name` (it can
  expire), and we never persist the ephemeral `photoUri` or attribution, so the
  response is explicitly `no-store` — every request resolves fresh. (See README:
  "Caching decision".) The handler never throws; failures degrade to null.
*/
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const restaurant = getRestaurantById(id);
  if (!restaurant) {
    return Response.json({ error: "Unknown restaurant." }, { status: 404 });
  }

  // No Place ID -> no Google call at all; the hero uses its clean fallback.
  if (!restaurant.googlePlaceId) {
    return noStoreJson({ photo: null, status: "missing-google-place-id" });
  }

  // Result carries `photo` (null on any failure) plus a SAFE diagnostic `status`
  // (+ optional numeric httpStatus / Google error enum) — no key, no raw body.
  const result = await getPlacePhoto(restaurant.googlePlaceId);
  return noStoreJson(result);
}

function noStoreJson(body: unknown): Response {
  return Response.json(body, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
