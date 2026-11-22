import type { FieldError } from "@/lib/adminApi";
import type { Validated } from "@/lib/adminValidation";

/**
 * Strict validation for video-candidate intake and edits (no database access).
 * The association fields (candidateRestaurantId / restaurantSlug) are validated for SHAPE here and
 * resolved against real records by lib/videoAssociation.
 */
const CREATE_FIELDS = new Set([
  "sourceUrl", "candidateRestaurantId", "restaurantSlug", "proposedRestaurantName", "reviewNotes",
  "creatorHandle", "creatorName", "attributionText", "caption",
]);
const PATCH_FIELDS = new Set([
  "status", "candidateRestaurantId", "restaurantSlug", "proposedRestaurantName", "reviewNotes",
  "creatorHandle", "creatorName", "attributionText", "caption", "matchConfidence", "matchReasons",
]);
const IMMUTABLE = new Set(["sourceUrl", "normalizedSourceUrl", "platform", "platformVideoId", "embedUrl", "legalDisplayStatus", "resolverStatus", "resolverError", "attachedVideoId", "id"]);
export const VIDEO_PATCH_STATUSES = ["needs_review", "approved", "rejected"] as const;
export const DRAFT_VIDEO_STATUSES = ["needs_review"] as const;
const HANDLE_RE = /^@[\p{L}\p{N}._-]{1,100}$/u;

export interface VideoWrite {
  sourceUrl?: string;
  status?: (typeof VIDEO_PATCH_STATUSES)[number];
  candidateRestaurantId?: string | null;
  restaurantSlug?: string | null;
  proposedRestaurantName?: string | null;
  reviewNotes?: string | null;
  creatorHandle?: string | null;
  creatorName?: string | null;
  attributionText?: string | null;
  caption?: string | null;
  matchConfidence?: number | null;
  matchReasons?: string[];
}

function text(v: unknown, field: string, max: number, errors: FieldError[]): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") { errors.push({ field, code: "invalid_type", message: `${field} must be a string or null.` }); return undefined; }
  const t = v.trim();
  if (t.length > max) { errors.push({ field, code: "too_long", message: `${field} must be at most ${max} characters.` }); return undefined; }
  return t === "" ? null : t;
}

export function validateVideoCandidateBody(body: unknown, mode: "create" | "patch"): Validated<VideoWrite> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: [{ field: "body", code: "invalid_body", message: "Request body must be a JSON object." }] };
  }
  const b = body as Record<string, unknown>;
  const errors: FieldError[] = [];
  const allowed = mode === "create" ? CREATE_FIELDS : PATCH_FIELDS;
  for (const key of Object.keys(b)) {
    if (allowed.has(key)) continue;
    errors.push({
      field: key, code: "unknown_field",
      message: IMMUTABLE.has(key) ? `${key} is set by the resolver and cannot be written.` : `Unknown field "${key}".`,
    });
  }
  const out: VideoWrite = {};

  if (mode === "create") {
    const url = typeof b.sourceUrl === "string" ? b.sourceUrl.trim() : "";
    if (!url) errors.push({ field: "sourceUrl", code: "required", message: "A sourceUrl is required." });
    else if (url.length > 2048) errors.push({ field: "sourceUrl", code: "too_long", message: "sourceUrl must be at most 2048 characters." });
    else out.sourceUrl = url;
  }
  if ("status" in b) {
    if (typeof b.status !== "string" || !(VIDEO_PATCH_STATUSES as readonly string[]).includes(b.status)) {
      errors.push({ field: "status", code: "invalid_status", message: `status must be one of: ${VIDEO_PATCH_STATUSES.join(", ")}. "attached" is set only by the attach action.` });
    } else out.status = b.status as VideoWrite["status"];
  }
  for (const key of ["candidateRestaurantId", "restaurantSlug"] as const) {
    if (key in b) {
      if (b[key] === null) out[key] = null;
      else if (typeof b[key] !== "string") errors.push({ field: key, code: "invalid_type", message: `${key} must be a string or null.` });
      else out[key] = (b[key] as string).trim() || null;
    }
  }
  const simple: [keyof VideoWrite, number][] = [["proposedRestaurantName", 200], ["reviewNotes", 4000], ["creatorName", 200], ["attributionText", 300], ["caption", 2000]];
  for (const [key, max] of simple) {
    if (key in b) {
      const v = text(b[key], key, max, errors);
      if (v !== undefined) (out as Record<string, unknown>)[key] = v;
    }
  }
  if ("creatorHandle" in b) {
    const v = text(b.creatorHandle, "creatorHandle", 101, errors);
    if (v && !HANDLE_RE.test(v)) errors.push({ field: "creatorHandle", code: "invalid_handle", message: "creatorHandle must start with @ followed by letters, digits, dots, underscores or hyphens." });
    else if (v !== undefined) out.creatorHandle = v;
  }
  if ("matchConfidence" in b) {
    const v = b.matchConfidence;
    if (v === null) out.matchConfidence = null;
    else if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100) out.matchConfidence = v;
    else errors.push({ field: "matchConfidence", code: "invalid_confidence", message: "matchConfidence must be an integer from 0 to 100, or null." });
  }
  if ("matchReasons" in b) {
    const v = b.matchReasons;
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string") || v.length > 20 || v.some((x) => (x as string).length > 200)) {
      errors.push({ field: "matchReasons", code: "invalid_reasons", message: "matchReasons must be an array of at most 20 strings of up to 200 characters." });
    } else out.matchReasons = v.map((x) => (x as string).trim()).filter(Boolean);
  }
  if (mode === "patch" && errors.length === 0 && Object.keys(out).length === 0) {
    errors.push({ field: "body", code: "empty_patch", message: "No writable fields were provided." });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out, warnings: [] };
}

const CORRECTION_FIELDS = new Set(["creatorHandle", "creatorDisplayName", "attributionText", "auditReason"]);
const CORRECTION_IMMUTABLE = new Set([
  "platform", "sourceUrl", "embedUrl", "thumbnailUrl", "legalDisplayStatus", "sourceType", "matchConfidence",
  "isRealSource", "restaurantId", "restaurantSlug", "status", "id", "caption",
]);

export interface VideoCorrectionWrite {
  creatorHandle?: string;
  creatorDisplayName?: string | null;
  attributionText?: string;
}

/**
 * Strict validation of a correction to a PUBLISHED video. Only the creator handle, creator display name
 * and attribution text can change. Source identity, caption, legal display status and the restaurant are
 * refused by name so a correction can never re-point a video or loosen a display restriction; status
 * changes go through the hide/restore routes. `auditReason` is handled by the route, not stored here.
 */
export function validateVideoCorrection(body: unknown): Validated<VideoCorrectionWrite> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: [{ field: "body", code: "invalid_body", message: "Request body must be a JSON object." }] };
  }
  const b = body as Record<string, unknown>;
  const errors: FieldError[] = [];
  for (const key of Object.keys(b)) {
    if (CORRECTION_FIELDS.has(key)) continue;
    errors.push({
      field: key, code: "unknown_field",
      message: CORRECTION_IMMUTABLE.has(key) ? `${key} cannot be changed on a published video.` : `Unknown field "${key}".`,
    });
  }
  const out: VideoCorrectionWrite = {};
  if ("creatorHandle" in b) {
    const v = b.creatorHandle;
    if (typeof v !== "string" || !HANDLE_RE.test(v.trim())) {
      errors.push({ field: "creatorHandle", code: "invalid_handle", message: "creatorHandle must start with @ followed by letters, digits, dots, underscores or hyphens." });
    } else out.creatorHandle = v.trim();
  }
  if ("creatorDisplayName" in b) {
    const v = text(b.creatorDisplayName, "creatorDisplayName", 200, errors);
    if (v !== undefined) out.creatorDisplayName = v;
  }
  if ("attributionText" in b) {
    const v = text(b.attributionText, "attributionText", 300, errors);
    if (v === null) errors.push({ field: "attributionText", code: "empty_value", message: "attributionText cannot be empty: every video needs visible attribution." });
    else if (v !== undefined) out.attributionText = v;
  }
  if (errors.length === 0 && Object.keys(out).length === 0) {
    errors.push({ field: "body", code: "empty_patch", message: "No correctable fields were provided (creatorHandle, creatorDisplayName, attributionText)." });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out, warnings: [] };
}
