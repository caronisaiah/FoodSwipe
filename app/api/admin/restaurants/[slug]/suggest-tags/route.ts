import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { getAppRestaurantById } from "@/lib/db/restaurants";
import { collectRestaurantCaptionSources } from "@/lib/db/tagSuggestionSources";
import { suggestTagsForRestaurant } from "@/lib/tagSuggester";

/*
  GET /api/admin/restaurants/[slug]/suggest-tags  (INTERNAL, admin-secret)

  Tag Automation B2 — READ-ONLY tag suggestions for a PUBLISHED (or seed)
  restaurant resolved by slug. Runs the shared deterministic engine over the
  restaurant's current fields + existing tags + reasonText + (bounded) review-only
  caption hints from attached videos / proposed candidates. WRITES NOTHING.

  Guards mirror the discovery query route: 503 no secret · 401 bad secret · 404
  unknown restaurant. No DB guard — seed restaurants resolve offline (caption
  collection simply returns seed-only without a DB). `no-store`.
*/
export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  if (!isAdminConfigured()) {
    return Response.json(
      { error: "Admin API is disabled (FOODSWIPE_ADMIN_SECRET not set)." },
      { status: 503 },
    );
  }
  if (!hasValidAdminSecret(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { slug } = await params;
  const restaurant = await getAppRestaurantById(slug);
  if (!restaurant) {
    return Response.json({ error: "Unknown restaurant." }, { status: 404 });
  }

  // Review-only caption hints: attached DB videos + seed/curated captions +
  // proposed candidates (bounded, read-only). `restaurant.id` is the app slug.
  const captions = await collectRestaurantCaptionSources(restaurant.id, restaurant.videos);

  const suggestions = suggestTagsForRestaurant({
    name: restaurant.name,
    market: restaurant.market,
    neighborhood: restaurant.neighborhood,
    priceLevel: restaurant.priceLevel,
    existing: {
      cuisineTags: restaurant.cuisineTags,
      dietaryTags: restaurant.dietaryTags,
      vibeTags: restaurant.vibeTags,
      bestFor: restaurant.bestFor,
      dishHighlights: restaurant.dishHighlights,
    },
    adminText: restaurant.reasonText,
    captions,
  });

  return Response.json(
    {
      restaurant: { id: restaurant.id, name: restaurant.name, kind: "published", market: restaurant.market },
      captionsConsidered: captions.length,
      suggestions,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
