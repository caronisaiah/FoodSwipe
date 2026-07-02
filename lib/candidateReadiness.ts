import { filterCuisines, filterVibes } from "@/lib/vocab";

export type PromotionConflict = "already-promoted" | "place-already-published";

export interface CandidateReadinessInput {
  status?: string | null;
  name?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  priceLevel?: number | null;
  cuisineTags?: string[] | null;
  vibeTags?: string[] | null;
  bestFor?: string[] | null;
  dishHighlights?: string[] | null;
  reasonText?: string | null;
  websiteDomain?: string | null;
  googlePlaceId?: string | null;
  websiteEvidenceOkDocs?: number | null;
  videoCandidateCount?: number | null;
  approvedOrAttachedVideoCount?: number | null;
  promotionConflict?: PromotionConflict | null;
}

export interface CandidateReadinessSignals {
  hasName: boolean;
  hasAddress: boolean;
  hasCoordinates: boolean;
  hasPriceLevel: boolean;
  hasCuisine: boolean;
  hasVibeOrBestFor: boolean;
  hasDishHighlights: boolean;
  hasReasonText: boolean;
  hasWebsite: boolean;
  hasWebsiteEvidence: boolean;
  hasHeroMedia: boolean;
  hasVideoCandidates: boolean;
  hasApprovedVideos: boolean;
}

export interface CandidateReadinessResult {
  isReadyToPromote: boolean;
  completenessScore: number;
  missingRequired: string[];
  warnings: string[];
  signals: CandidateReadinessSignals;
}

const FRIENDLY_MISSING: Record<string, string> = {
  name: "name",
  address: "address",
  priceLevel: "price level",
  lat: "latitude",
  lng: "longitude",
  cuisineTags: "at least one cuisine tag",
  "vibeTags|bestFor": "at least one vibe or best-for tag",
  reasonText: "reason text",
};

function str(v: string | null | undefined): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function finiteNumber(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function formatMissingRequiredFields(fields: string[]): string {
  return fields.map((field) => FRIENDLY_MISSING[field] ?? field).join(", ");
}

/** Required fields a candidate must have before it can become a feed restaurant. */
export function missingPromotionRequiredFields(c: CandidateReadinessInput): string[] {
  const missing: string[] = [];
  if (!str(c.name)) missing.push("name");
  if (!str(c.address)) missing.push("address");
  if (!(finiteNumber(c.priceLevel) && c.priceLevel >= 1 && c.priceLevel <= 4)) missing.push("priceLevel");
  if (!finiteNumber(c.lat)) missing.push("lat");
  if (!finiteNumber(c.lng)) missing.push("lng");
  if (filterCuisines(c.cuisineTags ?? []).length === 0) missing.push("cuisineTags");
  if (filterVibes(c.vibeTags ?? []).length === 0 && filterVibes(c.bestFor ?? []).length === 0) {
    missing.push("vibeTags|bestFor");
  }
  if (!str(c.reasonText)) missing.push("reasonText");
  return missing;
}

export function computeCandidateReadiness(c: CandidateReadinessInput): CandidateReadinessResult {
  const missingRequired = missingPromotionRequiredFields(c);
  const hasVideoCandidates = (c.videoCandidateCount ?? 0) > 0;
  const hasApprovedVideos = (c.approvedOrAttachedVideoCount ?? 0) > 0;
  const signals: CandidateReadinessSignals = {
    hasName: Boolean(str(c.name)),
    hasAddress: Boolean(str(c.address)),
    hasCoordinates: finiteNumber(c.lat) && finiteNumber(c.lng),
    hasPriceLevel: finiteNumber(c.priceLevel) && c.priceLevel >= 1 && c.priceLevel <= 4,
    hasCuisine: filterCuisines(c.cuisineTags ?? []).length > 0,
    hasVibeOrBestFor: filterVibes(c.vibeTags ?? []).length > 0 || filterVibes(c.bestFor ?? []).length > 0,
    hasDishHighlights: Array.isArray(c.dishHighlights) && c.dishHighlights.some((d) => str(d)),
    hasReasonText: Boolean(str(c.reasonText)),
    hasWebsite: Boolean(str(c.websiteDomain)),
    hasWebsiteEvidence: (c.websiteEvidenceOkDocs ?? 0) > 0,
    // Cheap, honest proxy for the hero-media ladder: Place Photo if a Place ID
    // resolves, Logo.dev fallback if a website domain exists. Do not fetch here.
    hasHeroMedia: Boolean(str(c.googlePlaceId) || str(c.websiteDomain)),
    hasVideoCandidates,
    hasApprovedVideos,
  };

  const warnings: string[] = [];
  if (c.status !== "approved") warnings.push("Status is not approved.");
  if (c.promotionConflict === "already-promoted") warnings.push("Already promoted from this candidate.");
  if (c.promotionConflict === "place-already-published") warnings.push("Another live restaurant uses this Google Place ID.");
  if (!signals.hasWebsite) warnings.push("No website on candidate.");
  else if (!signals.hasWebsiteEvidence) warnings.push("No website evidence yet.");
  if (!signals.hasVideoCandidates && !signals.hasApprovedVideos) warnings.push("Needs media/video leads.");
  if (!signals.hasDishHighlights) warnings.push("No dish highlights yet.");

  const scoreChecks = [
    signals.hasName,
    signals.hasAddress,
    signals.hasCoordinates,
    signals.hasPriceLevel,
    signals.hasCuisine,
    signals.hasVibeOrBestFor,
    signals.hasReasonText,
    signals.hasWebsite,
    signals.hasWebsiteEvidence,
    signals.hasHeroMedia,
    signals.hasVideoCandidates || signals.hasApprovedVideos,
    signals.hasDishHighlights,
  ];
  const completenessScore = Math.round((scoreChecks.filter(Boolean).length / scoreChecks.length) * 100);

  return {
    isReadyToPromote: c.status === "approved" && missingRequired.length === 0 && !c.promotionConflict,
    completenessScore,
    missingRequired,
    warnings,
    signals,
  };
}
