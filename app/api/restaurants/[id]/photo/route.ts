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
  // Resolve seed only when content mode allows it; DB-published rows always work.
  const restaurant = await getAppRestaurantById(id, {
    includeSeeds: shouldIncludeSeedRestaurants(),
  });
  if (!restaurant) {
    return Response.json({ error: "Unknown restaurant." }, { status: 404 });
  }

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
}

function noStoreJson(body: unknown): Response {
  return Response.json(body, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
