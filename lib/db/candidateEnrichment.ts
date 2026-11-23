import { computeCandidateReadiness } from "@/lib/candidateReadiness";
import { getApprovedHeroSelectionMapForCandidates } from "./heroMediaSelections";
import { getCandidateEvidenceMetaMap } from "./restaurantEvidence";
import { getCandidatePromotionConflictMap } from "./restaurants";
import { getCandidateVideoMetaMap } from "./videoCandidates";
import type { CandidateRestaurant } from "./candidates";

/**
 * The review signals the admin candidate list shows next to every candidate (website-evidence summary, video
 * counts, promotion conflict, approved hero selection and the computed readiness). READ-ONLY. Shared by the
 * list route and the single-restaurant review route so both always describe a candidate the same way.
 */
export async function enrichCandidates(candidates: CandidateRestaurant[]) {
  const candidateIds = candidates.map((c) => c.id);
  const [evidenceMeta, videoMeta, promotionConflicts, heroSelections] = await Promise.all([
    getCandidateEvidenceMetaMap(candidateIds),
    getCandidateVideoMetaMap(candidates.map((c) => ({ id: c.id, slug: c.slug }))),
    getCandidatePromotionConflictMap(candidates.map((c) => ({ id: c.id, googlePlaceId: c.googlePlaceId }))),
    getApprovedHeroSelectionMapForCandidates(candidateIds),
  ]);
  return candidates.map((candidate) => {
    const websiteEvidenceMeta = evidenceMeta[candidate.id] ?? { total: 0, okDocs: 0, latestFetchedAt: null, stale: false };
    const video = videoMeta[candidate.id] ?? { total: 0, approvedOrAttached: 0 };
    const promotionConflict = promotionConflicts[candidate.id] ?? null;
    const heroMediaSelection = heroSelections[candidate.id] ?? null;
    const hasApprovedHeroSelection = Boolean(heroMediaSelection);
    return {
      ...candidate,
      websiteEvidenceMeta,
      videoMeta: video,
      promotionConflict,
      heroMediaSelection,
      hasApprovedHeroSelection,
      readiness: computeCandidateReadiness({
        ...candidate,
        hasApprovedHeroSelection,
        websiteEvidenceOkDocs: websiteEvidenceMeta.okDocs,
        videoCandidateCount: video.total,
        approvedOrAttachedVideoCount: video.approvedOrAttached,
        promotionConflict: promotionConflict?.conflict ?? null,
      }),
    };
  });
}
