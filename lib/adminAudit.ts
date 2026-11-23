import type { AdminActor } from "@/lib/adminAuth";

/**
 * Pure definitions for the admin audit log (Admin Hardening B): event taxonomy, which fields may be
 * recorded, and request correlation. No database access here; the SQL lives in lib/db/audit.ts.
 *
 * What the log can and cannot say:
 *  - It records that a request authenticated with a given shared credential changed a given record, what
 *    changed, and when. The actor is a credential label (see AdminActor), not a verified person.
 *  - An "approved" event means "a request carrying the publication credential approved this". It does NOT
 *    establish that a particular human reviewed the content. Treat it as accountability for the
 *    credential holder; per-person proof needs per-user authentication.
 */

export const AUDIT_RESOURCE_TYPES = ["restaurant_candidate", "restaurant", "video_candidate", "restaurant_video"] as const;
export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

/** Closed taxonomy: "<resource>.<verb>". Adding an action means adding it here (and to AUDIT_CATEGORY). */
export const AUDIT_ACTIONS = [
  "restaurant_candidate.created",
  "restaurant_candidate.updated",
  "restaurant_candidate.market_changed",
  "restaurant_candidate.status_changed",
  "restaurant_candidate.approved",
  "restaurant_candidate.rejected",
  "restaurant_candidate.hero_selected",
  "restaurant_candidate.hero_cleared",
  "restaurant.promoted",
  "restaurant.hero_inherited",
  "restaurant.updated",
  "restaurant.hidden",
  "restaurant.restored",
  "video_candidate.created",
  "video_candidate.updated",
  "video_candidate.status_changed",
  "video_candidate.approved",
  "video_candidate.rejected",
  "restaurant_video.attached",
  "restaurant_video.added_direct",
  "restaurant_video.updated",
  "restaurant_video.hidden",
  "restaurant_video.restored",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_CATEGORIES = ["draft_modification", "approval", "publication", "edit", "removal", "recovery"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

const AUDIT_CATEGORY: Record<AuditAction, AuditCategory> = {
  "restaurant_candidate.created": "draft_modification",
  "restaurant_candidate.updated": "draft_modification",
  "restaurant_candidate.market_changed": "draft_modification",
  "restaurant_candidate.status_changed": "draft_modification",
  "restaurant_candidate.approved": "approval",
  "restaurant_candidate.rejected": "approval",
  "restaurant_candidate.hero_selected": "approval",
  "restaurant_candidate.hero_cleared": "draft_modification",
  "restaurant.promoted": "publication",
  "restaurant.hero_inherited": "publication",
  "restaurant.updated": "edit",
  "restaurant.hidden": "removal",
  "restaurant.restored": "recovery",
  "video_candidate.created": "draft_modification",
  "video_candidate.updated": "draft_modification",
  "video_candidate.status_changed": "draft_modification",
  "video_candidate.approved": "approval",
  "video_candidate.rejected": "approval",
  "restaurant_video.attached": "publication",
  "restaurant_video.added_direct": "publication",
  "restaurant_video.updated": "edit",
  "restaurant_video.hidden": "removal",
  "restaurant_video.restored": "recovery",
};

export function auditCategory(action: string): AuditCategory | null {
  return (AUDIT_CATEGORY as Record<string, AuditCategory | undefined>)[action] ?? null;
}

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === "string" && (AUDIT_ACTIONS as readonly string[]).includes(value);
}
export function isAuditResourceType(value: unknown): value is AuditResourceType {
  return typeof value === "string" && (AUDIT_RESOURCE_TYPES as readonly string[]).includes(value);
}

/**
 * Columns whose values may appear in `changes` (previous/new values). An ALLOW-list: a column that is
 * not listed is never recorded, so a new sensitive column is excluded by default. None of these hold
 * credentials, tokens, raw provider payloads or request bodies. Values longer than 400 characters are
 * clipped (length + 120-character preview) so the log never carries large payloads.
 */
export const AUDIT_FIELDS = {
  restaurant_candidate: [
    "name", "slug", "status", "source", "market", "google_place_id", "website_domain", "address", "neighborhood",
    "lat", "lng", "price_level", "cuisine_tags", "dietary_tags", "vibe_tags", "dish_highlights", "best_for",
    "reason_text", "review_notes",
  ],
  restaurant: [
    "name", "slug", "market", "neighborhood", "address", "google_place_id", "website_domain", "lat", "lng",
    "distance_miles", "price_level", "cuisine_tags", "dietary_tags", "vibe_tags", "dish_highlights", "best_for",
    "reason_text", "status", "source_candidate_id",
  ],
  video_candidate: [
    "status", "platform", "source_url", "platform_video_id", "restaurant_slug", "candidate_restaurant_id",
    "proposed_restaurant_name", "creator_handle", "creator_name", "caption", "attribution_text", "match_confidence",
    "match_reasons", "legal_display_status", "review_notes", "attached_video_id",
  ],
  restaurant_video: [
    "restaurant_id", "platform", "source_url", "creator_handle", "creator_display_name", "caption",
    "attribution_text", "status", "legal_display_status", "source_type", "match_confidence", "is_real_source",
  ],
  hero_selection: [
    "target_type", "candidate_restaurant_id", "restaurant_id", "source_place_id", "selected_photo_ordinal",
    "approval_state", "reviewer_notes", "selection_reason", "risk_note",
  ],
} as const;

/** First matching rule wins; `field` is a snake_case column, `to` the NEW value that must match. */
export type ActionRuleSet = { field: string; to?: string; action: AuditAction }[];

export interface AuditContext {
  actor: AdminActor;
  /** Correlates all events written by one HTTP request. */
  requestId: string;
  /** Optional human-supplied reason / review note (max 1000 chars; see cleanReason). */
  reason?: string | null;
  /** Small non-secret context merged into the event's `details`. */
  details?: Record<string, unknown>;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

/** A caller-supplied `x-request-id` (for cross-system tracing) when well-formed, otherwise a fresh uuid. */
export function newRequestId(req: Request): string {
  const supplied = req.headers.get("x-request-id")?.trim();
  return supplied && REQUEST_ID_PATTERN.test(supplied) ? supplied : crypto.randomUUID();
}

export const MAX_REASON_LENGTH = 1000;
/** Values longer than this are clipped inside the audit event (lib/db/audit.ts mirrors it in SQL). */
export const AUDIT_VALUE_CLIP_LENGTH = 400;

/** The configured admin credentials (publish, draft) that must never appear in a log or a reason. */
function configuredSecrets(): string[] {
  return [process.env.FOODSWIPE_ADMIN_SECRET, process.env.FOODSWIPE_ADMIN_DRAFT_SECRET]
    .filter((s): s is string => typeof s === "string" && s.length >= 8);
}

/** True when `text` contains a configured admin credential verbatim. */
export function containsConfiguredSecret(text: string): boolean {
  return configuredSecrets().some((secret) => text.includes(secret));
}

// NUL and other control characters (not tab / newline): PostgreSQL rejects NUL in text and none belong in a note.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Validate an optional reason: undefined/null/blank -> null, a string of at most 1000 chars -> trimmed. */
export function cleanReason(value: unknown): { ok: true; reason: string | null } | { ok: false; message: string } {
  if (value === undefined || value === null) return { ok: true, reason: null };
  if (typeof value !== "string") return { ok: false, message: "auditReason must be a string." };
  const t = value.replace(CONTROL_CHARS, "").trim();
  if (t.length > MAX_REASON_LENGTH) return { ok: false, message: `auditReason must be at most ${MAX_REASON_LENGTH} characters.` };
  // The reason is free text a person typed. Refuse the one thing that must never be written to a log: a
  // configured admin credential pasted into it by mistake.
  if (containsConfiguredSecret(value)) return { ok: false, message: "auditReason must not contain a credential." };
  return { ok: true, reason: t || null };
}

/** Event shape returned by the audit read API. */
export interface AdminEventView {
  id: string;
  seq: number;
  occurredAt: string;
  action: string;
  category: AuditCategory | null;
  resourceType: string;
  resourceId: string;
  relatedResourceType: string | null;
  relatedResourceId: string | null;
  actorIdentity: string;
  authScope: string;
  actorAssurance: string;
  requestId: string;
  changes: Record<string, { from?: unknown; to?: unknown }>;
  details: Record<string, unknown>;
  reason: string | null;
}

/**
 * Pull the optional `auditReason` (a human-supplied note, stored in the event's `reason`) out of a JSON
 * body so the strict body validators, which reject unknown fields, never see it.
 */
export function splitAuditReason(body: unknown): { ok: true; body: unknown; reason: string | null } | { ok: false; message: string } {
  if (!body || typeof body !== "object" || Array.isArray(body) || !("auditReason" in body)) {
    return { ok: true, body, reason: null };
  }
  const { auditReason, ...rest } = body as Record<string, unknown>;
  const cleaned = cleanReason(auditReason);
  return cleaned.ok ? { ok: true, body: rest, reason: cleaned.reason } : cleaned;
}

/** For routes without a body of their own (hide, restore, clear): an optional `{ "auditReason": "..." }`. */
export async function readOptionalReason(req: Request): Promise<{ ok: true; reason: string | null } | { ok: false; message: string }> {
  let text = "";
  try {
    text = await req.text();
  } catch {
    return { ok: true, reason: null };
  }
  if (!text.trim()) return { ok: true, reason: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "Invalid JSON body." };
  }
  const split = splitAuditReason(parsed);
  return split.ok ? { ok: true, reason: split.reason } : split;
}
