import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { getAppRestaurantById } from "@/lib/db/restaurants";
import { collectRestaurantCaptionSources } from "@/lib/db/tagSuggestionSources";
import { getEvidenceForSubject, getEvidenceMeta } from "@/lib/db/restaurantEvidence";
import { suggestTagsForRestaurant } from "@/lib/tagSuggester";
import { isAIConfigured } from "@/lib/aiClient";
import { requestAITagSuggestions } from "@/lib/aiTagSuggester";

const NO_STORE = { "Cache-Control": "no-store" };

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
      { status: 503, headers: NO_STORE },
    );
  }
  if (!hasValidAdminSecret(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });
  }

  const { slug } = await params;
  const restaurant = await getAppRestaurantById(slug);
  if (!restaurant) {
    return Response.json({ error: "Unknown restaurant." }, { status: 404, headers: NO_STORE });
  }

  const mode = new URL(req.url).searchParams.get("mode") === "ai" ? "ai" : "deterministic";

  // Review-only caption hints: attached DB videos + seed/curated captions +
  // proposed candidates (bounded, read-only). `restaurant.id` is the app slug.
  const captions = await collectRestaurantCaptionSources(restaurant.id, restaurant.videos);
  const subject = { type: "restaurant" as const, restaurantSlug: restaurant.id };
  const existing = {
    cuisineTags: restaurant.cuisineTags,
    dietaryTags: restaurant.dietaryTags,
    vibeTags: restaurant.vibeTags,
    bestFor: restaurant.bestFor,
    dishHighlights: restaurant.dishHighlights,
  };
  const evidenceMeta = await getEvidenceMeta(subject);

  if (mode === "ai") {
    if (!isAIConfigured()) {
      return Response.json(
        { error: "AI suggestions are not configured (ANTHROPIC_API_KEY not set).", mode: "ai", aiAvailable: false, evidenceMeta },
        { status: 503, headers: NO_STORE },
      );
    }
    try {
      const evidence = await getEvidenceForSubject(subject);
      const ai = await requestAITagSuggestions({
        name: restaurant.name,
        market: restaurant.market,
        neighborhood: restaurant.neighborhood,
        priceLevel: restaurant.priceLevel,
        existing,
        adminText: restaurant.reasonText,
        captions,
        evidence,
      });
      return Response.json(
        {
          restaurant: { id: restaurant.id, name: restaurant.name, kind: "published", market: restaurant.market },
          mode: "ai",
          aiAvailable: true,
          captionsConsidered: captions.length,
          evidenceMeta,
          evidenceSourcesUsed: ai.evidenceSourcesUsed,
          suggestions: ai.result,
        },
        { status: 200, headers: NO_STORE },
      );
    } catch {
      return Response.json(
        { error: "AI suggestion request failed.", mode: "ai", aiAvailable: true, evidenceMeta },
        { status: 502, headers: NO_STORE },
      );
    }
  }

  const suggestions = suggestTagsForRestaurant({
    name: restaurant.name,
    market: restaurant.market,
    neighborhood: restaurant.neighborhood,
    priceLevel: restaurant.priceLevel,
    existing,
    adminText: restaurant.reasonText,
    captions,
  });

  return Response.json(
    {
      restaurant: { id: restaurant.id, name: restaurant.name, kind: "published", market: restaurant.market },
      mode: "deterministic",
      captionsConsidered: captions.length,
      evidenceMeta,
      suggestions,
    },
    { status: 200, headers: NO_STORE },
  );
}
