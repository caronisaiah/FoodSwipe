import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { getCandidateRestaurant, isDbConfigured } from "@/lib/db/candidates";
import { collectCandidateCaptionSources } from "@/lib/db/tagSuggestionSources";
import { suggestTagsForRestaurant } from "@/lib/tagSuggester";

/*
  GET /api/admin/restaurants/candidates/[id]/suggest-tags  (INTERNAL, admin-secret)

  Tag Automation B2 — READ-ONLY tag suggestions for a candidate restaurant. Runs
  the shared deterministic engine over the candidate's current fields + existing
  tags + admin text + (bounded) review-only video-caption hints. WRITES NOTHING:
  no DB mutations, no apply, no auto-save. Suggestions are a starting point for the
  human reviewer. Guards mirror the other admin routes: 503 no secret · 401 bad
  secret · 503 no DB · 404 unknown candidate. `no-store`.
*/
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
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
  if (!isDbConfigured()) {
    return Response.json(
      { error: "Database not configured (DATABASE_URL not set)." },
      { status: 503 },
    );
  }

  const { id } = await params;
  const candidate = await getCandidateRestaurant(id);
  if (!candidate) {
    return Response.json({ error: "Candidate not found." }, { status: 404 });
  }

  // Review-only caption hints (bounded, read-only).
  const captions = await collectCandidateCaptionSources(candidate.id, candidate.slug);

  // NB: Google primaryType/types are NOT stored on candidates post-import, so the
  // on-demand engine relies on name + existing tags + admin text + captions.
  const suggestions = suggestTagsForRestaurant({
    name: candidate.name,
    market: candidate.market,
    neighborhood: candidate.neighborhood,
    priceLevel: candidate.priceLevel,
    existing: {
      cuisineTags: candidate.cuisineTags,
      dietaryTags: candidate.dietaryTags,
      vibeTags: candidate.vibeTags,
      bestFor: candidate.bestFor,
      dishHighlights: candidate.dishHighlights,
    },
    adminText: [candidate.reasonText, candidate.reviewNotes].filter(Boolean).join(" "),
    captions,
  });

  return Response.json(
    {
      restaurant: { id: candidate.id, name: candidate.name, kind: "candidate", market: candidate.market },
      // Provenance from the original Google import (if any) — context for the UI.
      priorImportSnapshot: candidate.suggestedTags ?? null,
      priorImportConfidence: candidate.suggestionConfidence ?? null,
      captionsConsidered: captions.length,
      suggestions,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
