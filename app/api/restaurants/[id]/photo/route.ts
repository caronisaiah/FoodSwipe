import { getAppRestaurantById } from "@/lib/db/restaurants";
import { getApprovedHeroSelectionForRestaurantSlug } from "@/lib/db/heroMediaSelections";
import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";
import { resolveGalleryWithSelection, resolveHeroMediaWithSelection } from "@/lib/heroMedia";

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

  Gallery (Phase 13B, opt-in): `?gallery=1` returns the approved hero first and up
  to two more distinct photos as `{ photos, galleryCount, heroSourceUri,
  includesHero, heroSkipped, status, httpStatus?, googleStatus? }`; every photo carries its own
  source link and credits. Only this explicit request makes the extra photo-media
  requests. `&skipHero=1` leaves the hero out (the caller already holds it) so it
  is not fetched twice; `heroSourceUri` lets the caller confirm it is still the same
  hero. With `skipHero=1`, `includesHero` is always false and `heroSkipped` true:
  that is an intentional omission, not a failure. `includesHero: false` with
  `heroSkipped: false` means the hero's image could not be resolved. The default
  response gains only `galleryCount`, which costs no extra request.

  The photo + logo come from the shared `resolveHeroMedia` helper (also used by
  the admin candidate photo route). The established fields are unchanged:
  `{ photo, status, logoUrl, httpStatus?, googleStatus? }`, plus `galleryCount`.

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
  req: Request,
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
    const selectedHero = selection
      ? {
          sourcePlaceId: selection.sourcePlaceId,
          selectedPhotoOrdinal: selection.selectedPhotoOrdinal,
        }
      : null;

    const query = new URL(req.url).searchParams;
    if (query.get("gallery") === "1") {
      const gallery = await resolveGalleryWithSelection({
        googlePlaceId: restaurant.googlePlaceId,
        selectedHero,
        skipHero: query.get("skipHero") === "1",
      });
      return noStoreJson({
        photos: gallery.photos,
        galleryCount: gallery.galleryCount,
        heroSourceUri: gallery.heroSourceUri,
        includesHero: gallery.includesHero,
        heroSkipped: gallery.heroSkipped,
        status: gallery.status,
        httpStatus: gallery.httpStatus,
        googleStatus: gallery.googleStatus,
      });
    }

    const media = await resolveHeroMediaWithSelection({
      googlePlaceId: restaurant.googlePlaceId,
      websiteDomain: restaurant.websiteDomain,
      selectedHero,
    });

    return noStoreJson({
      photo: media.photo,
      status: media.photoStatus,
      logoUrl: media.logoUrl,
      httpStatus: media.httpStatus,
      googleStatus: media.googleStatus,
      galleryCount: media.galleryCount,
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
