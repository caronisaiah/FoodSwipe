import { filterCuisines, filterVibes } from "@/lib/vocab";
import { cleanPublicReasonText } from "@/lib/publicReasonText";

export type PromotionConflict = "already-promoted" | "place-already-published";
export type HeroMediaReadinessStatus = "approved" | "needs_review" | "fallback_only" | "missing";

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
  hasApprovedHeroSelection?: boolean | null;
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
  hasApprovedHeroSelection: boolean;
  hasHeroMedia: boolean;
  heroMediaStatus: HeroMediaReadinessStatus;
  hasVideoCandidates: boolean;
  hasApprovedVideos: boolean;
}

export interface CandidateReadinessResult {
  isReadyToPromote: boolean;
  completenessScore: number;
  heroMediaStatus: HeroMediaReadinessStatus;
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
};

function str(v: string | null | undefined): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function finiteNumber(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function heroMediaStatusFor(c: CandidateReadinessInput): HeroMediaReadinessStatus {
  if (c.hasApprovedHeroSelection) return "approved";
  if (str(c.googlePlaceId)) return "needs_review";
  if (str(c.websiteDomain)) return "fallback_only";
  return "missing";
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
  return missing;
}

export function computeCandidateReadiness(c: CandidateReadinessInput): CandidateReadinessResult {
  const missingRequired = missingPromotionRequiredFields(c);
  const hasVideoCandidates = (c.videoCandidateCount ?? 0) > 0;
  const hasApprovedVideos = (c.approvedOrAttachedVideoCount ?? 0) > 0;
  const heroMediaStatus = heroMediaStatusFor(c);
  const signals: CandidateReadinessSignals = {
    hasName: Boolean(str(c.name)),
    hasAddress: Boolean(str(c.address)),
    hasCoordinates: finiteNumber(c.lat) && finiteNumber(c.lng),
    hasPriceLevel: finiteNumber(c.priceLevel) && c.priceLevel >= 1 && c.priceLevel <= 4,
    hasCuisine: filterCuisines(c.cuisineTags ?? []).length > 0,
    hasVibeOrBestFor: filterVibes(c.vibeTags ?? []).length > 0 || filterVibes(c.bestFor ?? []).length > 0,
    hasDishHighlights: Array.isArray(c.dishHighlights) && c.dishHighlights.some((d) => str(d)),
    hasReasonText: Boolean(cleanPublicReasonText(c.reasonText)),
    hasWebsite: Boolean(str(c.websiteDomain)),
    hasWebsiteEvidence: (c.websiteEvidenceOkDocs ?? 0) > 0,
    hasApprovedHeroSelection: heroMediaStatus === "approved",
    // Launch-ready hero media now means an admin selected an exact-location
    // hero. A Place ID or Logo.dev fallback remains useful, but needs review.
    hasHeroMedia: heroMediaStatus === "approved",
    heroMediaStatus,
    hasVideoCandidates,
    hasApprovedVideos,
  };

  const warnings: string[] = [];
  if (c.status !== "approved") warnings.push("Status is not approved.");
  if (c.promotionConflict === "already-promoted") warnings.push("Already promoted from this candidate.");
  if (c.promotionConflict === "place-already-published") warnings.push("Another live restaurant uses this Google Place ID.");
  if (!signals.hasWebsite) warnings.push("No website on candidate.");
  else if (!signals.hasWebsiteEvidence) warnings.push("No website evidence yet.");
  if (!signals.hasReasonText) warnings.push("No public reason text; promotion will use fallback copy.");
  if (heroMediaStatus === "needs_review") warnings.push("Hero photo needs admin selection.");
  if (heroMediaStatus === "fallback_only") warnings.push("Only logo/placeholder fallback available for hero media.");
  if (heroMediaStatus === "missing") warnings.push("No Google Place ID or website fallback for hero media.");
  if (!signals.hasVideoCandidates && !signals.hasApprovedVideos) warnings.push("Needs media/video leads.");
  if (!signals.hasDishHighlights) warnings.push("No dish highlights yet.");

  const scoreUnits = [
    signals.hasName ? 1 : 0,
    signals.hasAddress ? 1 : 0,
    signals.hasCoordinates ? 1 : 0,
    signals.hasPriceLevel ? 1 : 0,
    signals.hasCuisine ? 1 : 0,
    signals.hasVibeOrBestFor ? 1 : 0,
    signals.hasReasonText ? 1 : 0,
    signals.hasWebsite ? 1 : 0,
    signals.hasWebsiteEvidence ? 1 : 0,
    heroMediaStatus === "approved" ? 2 : heroMediaStatus === "needs_review" ? 1 : 0,
    signals.hasVideoCandidates || signals.hasApprovedVideos ? 1 : 0,
    signals.hasDishHighlights ? 1 : 0,
  ];
  const completenessScore = Math.round((scoreUnits.reduce((sum, value) => sum + value, 0) / 13) * 100);

  return {
    isReadyToPromote: c.status === "approved" && missingRequired.length === 0 && heroMediaStatus === "approved" && !c.promotionConflict,
    completenessScore,
    heroMediaStatus,
    missingRequired,
    warnings,
    signals,
  };
}
