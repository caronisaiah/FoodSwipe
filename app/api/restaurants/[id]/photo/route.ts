import { getAppRestaurantById } from "@/lib/db/restaurants";
import { getApprovedHeroSelectionForRestaurantSlug } from "@/lib/db/heroMediaSelections";
import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";
import { resolveHeroMediaWithSelection } from "@/lib/heroMedia";

/*
  GET /api/restaurants/[id]/photo  (public read, v1.5)

  Returns fresh identity media for a public restaurant. In production content
  mode, seed-only restaurant ids do not resolve. The response always includes a
  safe diagnostic `status`
  (e.g. "ok" / "missing-api-key" / "place-details-failed" / "no-photos"), and
  `photo` is null on anything but "ok". The client hero reads `photo` to show a
  real identity image and falls back to the logo/placeholder on null; the
  `status` (+ optional numeric httpStatus / Google error enum) is for debugging
  and contains NO secrets and NO raw Google body.

  The photo + logo come from the shared `resolveHeroMedia` helper (also used by
  the admin candidate photo route). Response shape is unchanged:
  `{ photo, status, logoUrl, httpStatus?, googleStatus? }`.

  Caching: NONE, on every response. Google Places policy forbids caching the
  photo `name` (it can expire), and we never persist the ephemeral `photoUri` or
  attribution, so the response is explicitly `no-store` — every request resolves
  fresh. (See README: "Caching decision".) That includes the 404 for an unknown,
  hidden or unpublished restaurant and the 503 for an unexpected failure: a
  cached "not found" must never outlive a change in publication status. The 404
  is identical for all three cases so it does not reveal that a hidden
  restaurant exists. Failures degrade to a response the client already handles.
*/
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    // Resolve seed only when content mode allows it; DB-published rows always work.
    const restaurant = await getAppRestaurantById(id, {
      includeSeeds: shouldIncludeSeedRestaurants(),
    });
    if (!restaurant) return noStoreJson({ error: "Unknown restaurant." }, 404);

    // DB-published rows may have an explicit approved exact-location selection.
    // Seed-only rows have no DB selection and keep the existing ladder unchanged.
    const selection = await getApprovedHeroSelectionForRestaurantSlug(id);
    const media = await resolveHeroMediaWithSelection({
      googlePlaceId: restaurant.googlePlaceId,
      websiteDomain: restaurant.websiteDomain,
      selectedHero: selection
        ? {
            sourcePlaceId: selection.sourcePlaceId,
            selectedPhotoOrdinal: selection.selectedPhotoOrdinal,
          }
        : null,
    });

    return noStoreJson({
      photo: media.photo,
      status: media.photoStatus,
      logoUrl: media.logoUrl,
      httpStatus: media.httpStatus,
      googleStatus: media.googleStatus,
    });
  } catch {
    return noStoreJson({ error: "Photo temporarily unavailable." }, 503);
  }
}

function noStoreJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
