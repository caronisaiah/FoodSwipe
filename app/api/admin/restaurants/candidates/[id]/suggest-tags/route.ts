import { hasValidAdminSecret, isAdminConfigured } from "@/lib/adminAuth";
import { getCandidateRestaurant, isDbConfigured } from "@/lib/db/candidates";
import { collectCandidateCaptionSources } from "@/lib/db/tagSuggestionSources";
import { getEvidenceForSubject, getEvidenceMeta } from "@/lib/db/restaurantEvidence";
import { suggestTagsForRestaurant } from "@/lib/tagSuggester";
import { isAIConfigured } from "@/lib/aiClient";
import { requestAITagSuggestions } from "@/lib/aiTagSuggester";

const NO_STORE = { "Cache-Control": "no-store" };

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
      { status: 503, headers: NO_STORE },
    );
  }
  if (!hasValidAdminSecret(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers: NO_STORE });
  }
  if (!isDbConfigured()) {
    return Response.json(
      { error: "Database not configured (DATABASE_URL not set)." },
      { status: 503, headers: NO_STORE },
    );
  }

  const { id } = await params;
  const candidate = await getCandidateRestaurant(id);
  if (!candidate) {
    return Response.json({ error: "Candidate not found." }, { status: 404, headers: NO_STORE });
  }

  const mode = new URL(req.url).searchParams.get("mode") === "ai" ? "ai" : "deterministic";

  // Review-only caption hints (bounded, read-only).
  const captions = await collectCandidateCaptionSources(candidate.id, candidate.slug);
  const subject = { type: "candidate" as const, candidateRestaurantId: candidate.id };
  const adminText = [candidate.reasonText, candidate.reviewNotes].filter(Boolean).join(" ");
  const existing = {
    cuisineTags: candidate.cuisineTags,
    dietaryTags: candidate.dietaryTags,
    vibeTags: candidate.vibeTags,
    bestFor: candidate.bestFor,
    dishHighlights: candidate.dishHighlights,
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
        name: candidate.name,
        market: candidate.market,
        neighborhood: candidate.neighborhood,
        priceLevel: candidate.priceLevel,
        existing,
        adminText,
        captions,
        evidence,
      });
      return Response.json(
        {
          restaurant: { id: candidate.id, name: candidate.name, kind: "candidate", market: candidate.market },
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

  // Deterministic (default). NB: Google primaryType/types are NOT stored on
  // candidates post-import, so this relies on name + existing tags + admin text + captions.
  const suggestions = suggestTagsForRestaurant({
    name: candidate.name,
    market: candidate.market,
    neighborhood: candidate.neighborhood,
    priceLevel: candidate.priceLevel,
    existing,
    adminText,
    captions,
  });

  return Response.json(
    {
      restaurant: { id: candidate.id, name: candidate.name, kind: "candidate", market: candidate.market },
      mode: "deterministic",
      // Provenance from the original Google import (if any) — context for the UI.
      priorImportSnapshot: candidate.suggestedTags ?? null,
      priorImportConfidence: candidate.suggestionConfidence ?? null,
      captionsConsidered: captions.length,
      evidenceMeta,
      suggestions,
    },
    { status: 200, headers: NO_STORE },
  );
}
