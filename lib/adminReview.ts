import { formatMissingRequiredFields, type CandidateReadinessResult } from "@/lib/candidateReadiness";
import { validateLatLng } from "@/lib/adminValidation";
import type { PublicationCheck } from "@/lib/publicationChecks";
import { MARKETS } from "@/lib/markets";

/*
  Pure logic behind the unified restaurant review workspace (/admin/restaurants/candidates/[id]).

  Nothing here reads or writes anything. It turns records the existing admin APIs already return into the
  honest, human-readable statements the workspace shows: how far a video lead has actually been verified, whether a
  restaurant could appear on the map, and what is complete, missing, invalid or waiting for a person.

  Honesty rules (kept in one place so they can be tested):
   - Automated signals (resolver status, match score, match reasons, AI tag suggestions) are never presented as a
     person's confirmation.
   - The system cannot establish that a PERSON watched a video: the audit log records which shared credential made a
     request. The only thing it can show is a reviewer's own declaration, typed at approval time and stored on the
     audit event, labelled as a declaration under a shared credential.
   - Audio, sponsorship and branch identity are not checked by any part of the system.
*/

/* ---------------------------------------------------------------- video evidence */

export type StageState = "yes" | "partial" | "declared" | "no" | "not_recorded";
export type StageId = "url_discovered" | "metadata_verified" | "restaurant_identified" | "content_reviewed" | "approved";

export interface EvidenceStage {
  id: StageId;
  label: string;
  state: StageState;
  detail: string;
}

/** A reviewer's own words, recorded on the approval event. Never a system-verified fact. */
export interface ReviewerDeclaration {
  watchedVideo: boolean;
  restaurantIdentified: boolean;
  note: string | null;
  /** The credential label that sent the approval (a shared credential, not a verified person). */
  credential: string;
  occurredAt: string;
}

export const DECLARATION_PREFIX = "Reviewer declaration:";
export const DECLARATION_MAX_NOTE = 400;

const WATCHED_TEXT = "watched the video";
const IDENTIFIED_TEXT = "restaurant identified";

/** The text stored as the audit reason of an approval. Returns undefined when the reviewer declared nothing. */
export function buildDeclarationReason(input: { watchedVideo: boolean; restaurantIdentified: boolean; note?: string | null }): string | undefined {
  const parts = [input.watchedVideo ? WATCHED_TEXT : null, input.restaurantIdentified ? IDENTIFIED_TEXT : null].filter((p): p is string => Boolean(p));
  const note = (input.note ?? "").replace(/\s+/g, " ").trim().slice(0, DECLARATION_MAX_NOTE);
  if (parts.length === 0) return note ? note : undefined;
  return `${DECLARATION_PREFIX} ${parts.join("; ")}.${note ? ` Note: ${note}` : ""}`;
}

/** Reads a declaration back from an audit reason. Anything that does not start with the prefix is ordinary text. */
export function parseDeclarationReason(reason: string | null | undefined): { watchedVideo: boolean; restaurantIdentified: boolean; note: string | null } | null {
  if (!reason || !reason.startsWith(DECLARATION_PREFIX)) return null;
  const body = reason.slice(DECLARATION_PREFIX.length).trim();
  const noteIndex = body.indexOf(" Note: ");
  const claims = noteIndex === -1 ? body : body.slice(0, noteIndex);
  const note = noteIndex === -1 ? null : body.slice(noteIndex + 7).trim() || null;
  return { watchedVideo: claims.includes(WATCHED_TEXT), restaurantIdentified: claims.includes(IDENTIFIED_TEXT), note };
}

export interface AuditEventLite {
  action: string;
  actorIdentity: string;
  authScope: string;
  reason: string | null;
  occurredAt: string;
}

/** The latest approval declaration among a video candidate's audit events (newest first or any order). */
export function latestDeclaration(events: AuditEventLite[] | null): ReviewerDeclaration | null {
  if (!events) return null;
  const approvals = events
    .filter((e) => e.action === "video_candidate.approved")
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
  for (const event of approvals) {
    const parsed = parseDeclarationReason(event.reason);
    if (parsed) return { ...parsed, credential: event.actorIdentity, occurredAt: event.occurredAt };
  }
  return null;
}

export interface VideoEvidenceInput {
  status: string;
  platform: string;
  platformVideoId: string | null;
  discoveredAt: string;
  resolverStatus: string;
  resolverError: string | null;
  sourceFetchedAt: string | null;
  matchConfidence: number | null;
  matchReasons: string[];
  attachedVideoId: string | null;
}

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "an unknown date";
}

/**
 * The five distinct things "reviewed" can mean for a video lead. `events` is the lead's audit history, or
 * null when this credential cannot read it (the draft credential), in which case declarations are simply not visible.
 */
export function videoEvidenceStages(video: VideoEvidenceInput, events: AuditEventLite[] | null): EvidenceStage[] {
  const declaration = latestDeclaration(events);
  const approved = video.status === "approved" || video.status === "attached";

  const metadata: EvidenceStage = (() => {
    switch (video.resolverStatus) {
      case "resolved":
        return { id: "metadata_verified", label: "Metadata verified", state: "yes", detail: `Creator and caption came from the platform's official metadata endpoint${video.sourceFetchedAt ? ` on ${day(video.sourceFetchedAt)}` : ""}. This checks the link and its public details, not the footage.` };
      case "source-link-only":
        return { id: "metadata_verified", label: "Metadata verified", state: "partial", detail: "Only the source link is stored. No platform metadata was fetched, so creator and caption are whatever was typed in." };
      case "missing-credentials":
        return { id: "metadata_verified", label: "Metadata verified", state: "no", detail: "Not verified: the platform credentials needed to fetch metadata were missing when the link was added." };
      case "error":
        return { id: "metadata_verified", label: "Metadata verified", state: "no", detail: `Not verified: the platform lookup failed${video.resolverError ? ` (${video.resolverError})` : ""}.` };
      default:
        return { id: "metadata_verified", label: "Metadata verified", state: "no", detail: `Not verified: resolver status "${video.resolverStatus}".` };
    }
  })();

  const hints = [
    video.matchConfidence !== null ? `automated match score ${video.matchConfidence}/100` : null,
    video.matchReasons.length ? `automated reasons: ${video.matchReasons.join(", ")}` : null,
  ].filter((h): h is string => Boolean(h));
  const hintText = hints.length ? ` Automated hints only, not a confirmation: ${hints.join("; ")}.` : "";
  const hiddenText = approved && events === null ? " This credential cannot read the audit history, so any approval declaration is not visible here." : "";

  const identified: EvidenceStage = declaration?.restaurantIdentified
    ? { id: "restaurant_identified", label: "Restaurant visually identified", state: "declared", detail: `The approving reviewer declared the restaurant was identified (credential ${declaration.credential}, ${day(declaration.occurredAt)}). A shared credential, so this is a declaration, not a verified person.` }
    : { id: "restaurant_identified", label: "Restaurant visually identified", state: "not_recorded", detail: `No record that anyone watched this video and matched it to this restaurant.${hintText}${hiddenText}` };

  const reviewed: EvidenceStage = declaration?.watchedVideo
    ? { id: "content_reviewed", label: "Video content reviewed by a human", state: "declared", detail: `The approving reviewer declared they watched the video (credential ${declaration.credential}, ${day(declaration.occurredAt)}). Audio, sponsorship and branch identity are not checked by the system.` }
    : { id: "content_reviewed", label: "Video content reviewed by a human", state: "not_recorded", detail: `No record that a person watched the video. Audio, sponsorship and branch identity are not checked by the system.${hiddenText}` };

  const decision: EvidenceStage = (() => {
    if (video.status === "attached") return { id: "approved", label: "Approved for FoodSwipe", state: "yes", detail: `Approved and attached as a live video${video.attachedVideoId ? ` (${video.attachedVideoId.slice(0, 8)}…)` : ""}.` };
    if (video.status === "approved") return { id: "approved", label: "Approved for FoodSwipe", state: "yes", detail: "Approved. It is not live until it is attached to a published restaurant." };
    if (video.status === "rejected") return { id: "approved", label: "Approved for FoodSwipe", state: "no", detail: "Rejected." };
    return { id: "approved", label: "Approved for FoodSwipe", state: "no", detail: "Still under review." };
  })();

  return [
    { id: "url_discovered", label: "URL discovered", state: "yes", detail: `${video.platform} link added ${day(video.discoveredAt)}${video.platformVideoId ? `, platform id ${video.platformVideoId}` : ", no platform video id"}.` },
    metadata,
    identified,
    reviewed,
    decision,
  ];
}

/* ---------------------------------------------------------------- map readiness */

export type CheckState = "valid" | "missing" | "invalid";
export type LocationState = "not_published" | "none" | "pending" | "approved" | "rejected";

export interface MapReadinessInput {
  lat: number | null;
  lng: number | null;
  market: string;
  /** The published restaurant made from this candidate, if any. */
  published: { slug: string; status: string } | null;
  /** Statuses of its restaurant_locations rows; null when not published. */
  locationStatuses: string[] | null;
}

export interface MapReadiness {
  coordinates: { state: CheckState; detail: string };
  market: { state: CheckState; detail: string };
  location: { state: LocationState; detail: string };
  /** True only when the public map would be able to draw a pin for this restaurant. */
  canAppear: boolean;
  notes: string[];
}

export function mapReadiness(input: MapReadinessInput): MapReadiness {
  const coordinates: MapReadiness["coordinates"] = (() => {
    if (input.lat === null || input.lng === null) return { state: "missing", detail: "No coordinates saved." };
    const valid = validateLatLng(input.lat, input.lng);
    return valid.ok
      ? { state: "valid", detail: `${input.lat}, ${input.lng}` }
      : { state: "invalid", detail: valid.errors.map((e) => e.message).join(" ") };
  })();
  const market: MapReadiness["market"] = (MARKETS as readonly string[]).includes(input.market)
    ? { state: "valid", detail: input.market.toUpperCase() }
    : { state: "invalid", detail: `"${input.market}" is not a known market.` };

  let location: MapReadiness["location"];
  if (!input.published || !input.locationStatuses) {
    location = { state: "not_published", detail: "Not published yet, so there is no map location to review." };
  } else if (input.locationStatuses.includes("approved")) {
    location = { state: "approved", detail: "An independently reviewed map location is approved." };
  } else if (input.locationStatuses.includes("pending")) {
    location = { state: "pending", detail: "A candidate map location exists but has not been approved in the map-location review." };
  } else if (input.locationStatuses.includes("rejected")) {
    location = { state: "rejected", detail: "Map locations were reviewed and rejected." };
  } else {
    location = { state: "none", detail: "No map location has been proposed for this restaurant." };
  }

  const canAppear = coordinates.state === "valid" && market.state === "valid" && input.published?.status === "published" && location.state === "approved";
  return {
    coordinates,
    market,
    location,
    canAppear,
    notes: [
      "The map draws only locations approved in the separate map-location review for a published restaurant. Publishing a restaurant does not create a map point.",
      "The coordinates above belong to the restaurant record. The map uses its own reviewed location, never these coordinates.",
    ],
  };
}

/* ---------------------------------------------------------------- publication checklist */

export type ChecklistState = "complete" | "missing" | "invalid" | "human" | "info";
export type ChecklistGroup = "identity" | "details" | "photo" | "videos" | "publication";

export interface ChecklistItem {
  id: string;
  group: ChecklistGroup;
  label: string;
  state: ChecklistState;
  /** True when promotion is refused until this is fixed (not merely warned about). */
  blocking: boolean;
  detail: string;
}

export interface ChecklistInput {
  status: string;
  name: string;
  address: string | null;
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  market: string;
  googlePlaceId: string | null;
  websiteDomain: string | null;
  priceLevel: number | null;
  cuisineTags: string[];
  vibeTags: string[];
  bestFor: string[];
  reasonText: string | null;
  hasApprovedHero: boolean;
  readiness: CandidateReadinessResult;
  publicationChecks: PublicationCheck[];
  promotionConflict: "already-promoted" | "place-already-published" | null;
  published: { slug: string; status: string } | null;
  videoCounts: { total: number; approved: number; attached: number; underReview: number; rejected: number; slugOnly: number };
}

export interface ReviewChecklist {
  items: ChecklistItem[];
  /** Backend promotion rules that currently stop promotion. */
  blockers: number;
  /** Items that need a person's judgement (warnings, unreviewed videos). */
  humanDecisions: number;
  /** Mirrors the promote route: approved, nothing required missing, no conflict. Warnings then still need a documented override. */
  promotable: boolean;
  summary: string;
}

export function buildChecklist(input: ChecklistInput): ReviewChecklist {
  const items: ChecklistItem[] = [];
  const add = (item: ChecklistItem) => items.push(item);
  const missing = new Set(input.readiness.missingRequired);
  const has = (value: string | null | undefined) => Boolean(value && value.trim());
  const warnings = input.publicationChecks.filter((c) => c.severity === "warning");
  const infos = input.publicationChecks.filter((c) => c.severity === "info");
  const coords = input.lat !== null && input.lng !== null ? validateLatLng(input.lat, input.lng) : null;

  add({ id: "name", group: "identity", label: "Name", state: has(input.name) ? "complete" : "missing", blocking: !has(input.name), detail: has(input.name) ? input.name : "A name is required." });
  add({ id: "address", group: "identity", label: "Address", state: has(input.address) ? "complete" : "missing", blocking: missing.has("address"), detail: has(input.address) ? (input.address as string) : "A street address is required." });
  add({ id: "market", group: "identity", label: "Market", state: (MARKETS as readonly string[]).includes(input.market) ? "complete" : "invalid", blocking: false, detail: input.market.toUpperCase() });
  add({
    id: "coordinates", group: "identity", label: "Coordinates",
    state: coords === null ? "missing" : coords.ok ? "complete" : "invalid",
    blocking: coords === null || !coords.ok,
    detail: coords === null ? "Latitude and longitude are required." : coords.ok ? `${input.lat}, ${input.lng}` : coords.errors.map((e) => e.message).join(" "),
  });
  const placeWarning = warnings.find((c) => c.code === "missing_place_identity" || c.code === "malformed_place_identity");
  add({
    id: "place_id", group: "identity", label: "Google Place ID",
    state: placeWarning ? "human" : "complete", blocking: false,
    detail: placeWarning ? `${placeWarning.message} Publishing needs a written override.` : has(input.googlePlaceId) ? "Present and well formed." : "—",
  });
  add({ id: "website", group: "identity", label: "Website", state: has(input.websiteDomain) ? "complete" : "info", blocking: false, detail: has(input.websiteDomain) ? (input.websiteDomain as string) : "No website saved (optional)." });

  add({ id: "price", group: "details", label: "Price level", state: input.priceLevel === null ? "missing" : "complete", blocking: missing.has("priceLevel"), detail: input.priceLevel === null ? "Set $ to $$$$." : "$".repeat(input.priceLevel) });
  add({ id: "cuisine", group: "details", label: "Cuisine", state: input.cuisineTags.length ? "complete" : "missing", blocking: missing.has("cuisineTags"), detail: input.cuisineTags.length ? input.cuisineTags.join(", ") : "At least one cuisine tag is required." });
  add({ id: "vibe", group: "details", label: "Vibe or best-for", state: input.vibeTags.length || input.bestFor.length ? "complete" : "missing", blocking: missing.has("vibeTags|bestFor"), detail: input.vibeTags.length || input.bestFor.length ? [...input.vibeTags, ...input.bestFor].join(", ") : "At least one vibe or best-for tag is required." });
  add({ id: "reason", group: "details", label: "Public description", state: has(input.reasonText) ? "complete" : "info", blocking: false, detail: has(input.reasonText) ? "Written." : "Blank: the profile will use safe fallback copy." });

  add({
    id: "hero", group: "photo", label: "Hero photo",
    state: input.hasApprovedHero ? "complete" : "missing", blocking: false,
    detail: input.hasApprovedHero ? "A Google place photo is approved as the hero." : "No hero approved. The profile will use a logo or placeholder until one is chosen (optional).",
  });

  const v = input.videoCounts;
  add({
    id: "videos", group: "videos", label: "Creator videos",
    state: v.total === 0 ? "info" : v.underReview > 0 ? "human" : "complete", blocking: false,
    detail: v.total === 0 ? "No video leads are linked to this restaurant (optional)."
      : `${v.total} lead${v.total === 1 ? "" : "s"}: ${v.approved + v.attached} approved, ${v.underReview} under review, ${v.rejected} rejected${v.attached ? `, ${v.attached} live` : ""}.`,
  });
  if (v.slugOnly > 0) {
    add({ id: "videos_by_slug", group: "videos", label: "Videos linked by slug only", state: "human", blocking: false, detail: `${v.slugOnly} lead${v.slugOnly === 1 ? " is" : "s are"} connected by a typed slug. Link them to this draft by ID so they stay correct if the slug changes.` });
  }

  add({
    id: "approval", group: "publication", label: "Restaurant approved",
    state: input.status === "approved" ? "complete" : input.status === "rejected" ? "invalid" : "human",
    blocking: input.status !== "approved",
    detail: input.status === "approved" ? "Reviewed and approved. Approval does not publish." : input.status === "rejected" ? "Rejected: reopen it (needs review) before it can be approved." : "Waiting for a person with the publication credential to approve it.",
  });
  // Once published, "already promoted" is simply the current state, not a problem to flag.
  if (input.promotionConflict && !(input.published && input.promotionConflict === "already-promoted")) {
    add({ id: "conflict", group: "publication", label: "Already published", state: "invalid", blocking: true, detail: input.promotionConflict === "already-promoted" ? "This candidate has already been promoted." : "Another published restaurant already uses this Google Place ID." });
  }
  for (const check of warnings.filter((c) => c !== placeWarning)) {
    add({ id: `check_${check.code}`, group: "publication", label: check.code === "possible_duplicate" ? "Possible duplicate" : check.code === "coordinates_outside_market" ? "Pin far from market" : "Publication warning", state: "human", blocking: false, detail: `${check.message} Publishing needs a written override.` });
  }
  for (const check of infos) {
    add({ id: `info_${check.code}`, group: "publication", label: "Worth a look", state: "info", blocking: false, detail: check.message });
  }
  add({
    id: "published", group: "publication", label: "Published",
    state: input.published ? "complete" : "info", blocking: false,
    detail: input.published ? `Live as /${input.published.slug} (${input.published.status}).` : "Not published. Promotion is a separate, explicit step.",
  });

  const blockers = items.filter((i) => i.blocking && i.state !== "complete").length;
  const humanDecisions = items.filter((i) => i.state === "human").length;
  const requiredMissing = input.readiness.missingRequired;
  const promotable = !input.published && input.status === "approved" && requiredMissing.length === 0 && !input.promotionConflict && coords?.ok === true;
  const summary = input.published
    ? `Published as /${input.published.slug}.`
    : promotable
      ? warnings.length ? `Ready to promote once ${warnings.length} warning${warnings.length === 1 ? " is" : "s are"} acknowledged with a written reason.` : "Ready to promote."
      : requiredMissing.length
        ? `Not ready: ${formatMissingRequiredFields(requiredMissing)} ${requiredMissing.length === 1 ? "is" : "are"} missing.`
        : input.status !== "approved" ? "Not ready: the restaurant has not been approved." : "Not ready: see the items marked invalid.";
  return { items, blockers, humanDecisions, promotable, summary };
}
