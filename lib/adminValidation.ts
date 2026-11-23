import type { FieldError } from "@/lib/adminApi";
import { MARKETS, getMarketOrigin, isAllowedMarket, type Market } from "@/lib/markets";
import { CUISINES, DIETARY, VIBES } from "@/lib/vocab";

/**
 * Strict, dependency-free validation for admin candidate writes.
 *
 * The previous behaviour was permissive: unknown fields, bad enums and out-of-range numbers were
 * silently dropped and the request still returned 200, which an automated caller reads as
 * success. Everything here either returns a fully validated value or a list of field errors.
 * Nothing is coerced silently except harmless whitespace trimming and de-duplicating tag lists.
 */
export type Validated<T> = { ok: true; value: T; warnings: AdminWarning[] } | { ok: false; errors: FieldError[] };

export interface AdminWarning {
  code: string;
  field?: string;
  message: string;
}

export const CANDIDATE_CREATE_STATUSES = ["candidate", "needs_review"] as const;
export const CANDIDATE_ALL_STATUSES = ["candidate", "needs_review", "approved", "rejected"] as const;
/** Statuses a draft credential may set. It can never approve or reject. */
export const DRAFT_STATUSES = ["candidate", "needs_review"] as const;

const CREATE_FIELDS = new Set([
  "name", "slug", "status", "market", "googlePlaceId", "websiteDomain", "address", "neighborhood",
  "lat", "lng", "priceLevel", "cuisineTags", "dietaryTags", "vibeTags", "bestFor", "dishHighlights",
  "reasonText", "reviewNotes", "notes",
]);
const PATCH_FIELDS = new Set([...CREATE_FIELDS]);

export interface CandidateWrite {
  name?: string;
  slug?: string | null;
  status?: (typeof CANDIDATE_ALL_STATUSES)[number];
  market?: Market;
  googlePlaceId?: string | null;
  websiteDomain?: string | null;
  address?: string | null;
  neighborhood?: string | null;
  lat?: number | null;
  lng?: number | null;
  priceLevel?: number | null;
  cuisineTags?: string[];
  dietaryTags?: string[];
  vibeTags?: string[];
  bestFor?: string[];
  dishHighlights?: string[];
  reasonText?: string | null;
  reviewNotes?: string | null;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** Strict market check: returns the market or a structured error. Never defaults. */
export function validateMarket(value: unknown, field = "market"): { ok: true; market: Market } | { ok: false; error: FieldError } {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: false, error: { field, code: "market_required", message: `A market is required (one of: ${MARKETS.join(", ")}).` } };
  }
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!isAllowedMarket(normalized)) {
    return { ok: false, error: { field, code: "invalid_market", message: `Invalid market (allowed: ${MARKETS.join(", ")}).` } };
  }
  return { ok: true, market: normalized };
}

export function validateLatLng(lat: unknown, lng: unknown): { ok: true; lat: number; lng: number } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  if (typeof lat !== "number" || !Number.isFinite(lat)) errors.push({ field: "lat", code: "invalid_coordinate", message: "Latitude must be a finite number." });
  else if (lat < -90 || lat > 90) errors.push({ field: "lat", code: "coordinate_out_of_range", message: "Latitude must be between -90 and 90." });
  if (typeof lng !== "number" || !Number.isFinite(lng)) errors.push({ field: "lng", code: "invalid_coordinate", message: "Longitude must be a finite number." });
  else if (lng < -180 || lng > 180) errors.push({ field: "lng", code: "coordinate_out_of_range", message: "Longitude must be between -180 and 180." });
  if (errors.length === 0 && lat === 0 && lng === 0) {
    errors.push({ field: "lat", code: "null_island", message: "0,0 is not a valid restaurant location." });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, lat: lat as number, lng: lng as number };
}

function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Non-blocking: a pin more than ~100 miles from its market's centre is probably the wrong market. */
export function coordinateWarnings(market: Market, lat: number, lng: number): AdminWarning[] {
  const origin = getMarketOrigin(market);
  const miles = haversineMiles(origin.lat, origin.lng, lat, lng);
  return miles > 100
    ? [{ code: "coordinates_far_from_market", field: "lat", message: `These coordinates are about ${Math.round(miles)} miles from the ${market.toUpperCase()} market centre. Check the market and the coordinates.` }]
    : [];
}

function stringField(
  v: unknown, field: string, errors: FieldError[], opts: { max: number; nullable?: boolean },
): string | null | undefined {
  if (v === null) {
    if (opts.nullable) return null;
    errors.push({ field, code: "invalid_value", message: `${field} cannot be null.` });
    return undefined;
  }
  if (typeof v !== "string") {
    errors.push({ field, code: "invalid_type", message: `${field} must be a string.` });
    return undefined;
  }
  const t = v.trim();
  if (t.length > opts.max) {
    errors.push({ field, code: "too_long", message: `${field} must be at most ${opts.max} characters.` });
    return undefined;
  }
  if (t === "") {
    if (opts.nullable) return null;
    errors.push({ field, code: "empty_value", message: `${field} cannot be empty.` });
    return undefined;
  }
  return t;
}

function tagField(
  v: unknown, field: string, vocab: readonly string[], errors: FieldError[],
): string[] | undefined {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
    errors.push({ field, code: "invalid_type", message: `${field} must be an array of strings.` });
    return undefined;
  }
  const cleaned = [...new Set((v as string[]).map((x) => x.trim()).filter(Boolean))];
  if (cleaned.length > 12) {
    errors.push({ field, code: "too_many", message: `${field} accepts at most 12 tags.` });
    return undefined;
  }
  const unknown = cleaned.filter((tag) => !vocab.includes(tag));
  if (unknown.length) {
    errors.push({
      field,
      code: "unknown_tag",
      message: `Unknown ${field} value${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Allowed: ${vocab.join(", ")}.`,
    });
    return undefined;
  }
  return cleaned;
}

function validatePrice(v: unknown, errors: FieldError[]): number | null | undefined {
  if (v === null) return null;
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 4) return v;
  errors.push({ field: "priceLevel", code: "invalid_price", message: "priceLevel must be an integer from 1 to 4, or null to clear it." });
  return undefined;
}

/**
 * Validate a candidate create (`mode: "create"`) or patch (`mode: "patch"`) body.
 * `existing` supplies the candidate's current market/coordinates for patch-time checks.
 */
export function validateCandidateBody(
  body: unknown,
  mode: "create" | "patch",
  context: { existingMarket?: Market; existingLat?: number | null; existingLng?: number | null } = {},
): Validated<CandidateWrite> {
  if (!isRecord(body)) {
    return { ok: false, errors: [{ field: "body", code: "invalid_body", message: "Request body must be a JSON object." }] };
  }
  const errors: FieldError[] = [];
  const warnings: AdminWarning[] = [];
  const allowed = mode === "create" ? CREATE_FIELDS : PATCH_FIELDS;
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      errors.push({
        field: key,
        code: "unknown_field",
        message: key === "source" || key === "id"
          ? `${key} is set by the system and cannot be written.`
          : `Unknown field "${key}".`,
      });
    }
  }
  const out: CandidateWrite = {};

  if ("name" in body) {
    const name = stringField(body.name, "name", errors, { max: 200 });
    if (name) out.name = name;
  } else if (mode === "create") {
    errors.push({ field: "name", code: "required", message: "name is required." });
  }

  if (mode === "create" || "market" in body) {
    const m = validateMarket(body.market);
    if (m.ok) out.market = m.market;
    else errors.push(m.error);
  }

  if ("status" in body) {
    const allowedStatuses = mode === "create" ? CANDIDATE_CREATE_STATUSES : CANDIDATE_ALL_STATUSES;
    if (typeof body.status !== "string" || !(allowedStatuses as readonly string[]).includes(body.status)) {
      errors.push({ field: "status", code: "invalid_status", message: `status must be one of: ${allowedStatuses.join(", ")}.` });
    } else out.status = body.status as (typeof CANDIDATE_ALL_STATUSES)[number];
  }

  if ("slug" in body) {
    const slug = stringField(body.slug, "slug", errors, { max: 80, nullable: true });
    if (slug && !SLUG_RE.test(slug)) errors.push({ field: "slug", code: "invalid_slug", message: "slug must be lowercase letters, digits and single hyphens." });
    else if (slug !== undefined) out.slug = slug;
  }

  if ("googlePlaceId" in body) {
    const id = stringField(body.googlePlaceId, "googlePlaceId", errors, { max: 256, nullable: true });
    if (id && /\s/.test(id)) errors.push({ field: "googlePlaceId", code: "invalid_place_id", message: "googlePlaceId must not contain whitespace." });
    else if (id !== undefined) out.googlePlaceId = id;
  }

  if ("websiteDomain" in body) {
    const domain = stringField(body.websiteDomain, "websiteDomain", errors, { max: 253, nullable: true });
    if (domain && !DOMAIN_RE.test(domain.toLowerCase())) {
      errors.push({ field: "websiteDomain", code: "invalid_domain", message: "websiteDomain must be a bare domain such as example.com (no scheme or path)." });
    } else if (domain !== undefined) out.websiteDomain = domain ? domain.toLowerCase() : null;
  }
  if ("address" in body) {
    const v = stringField(body.address, "address", errors, { max: 300, nullable: true });
    if (v !== undefined) out.address = v;
  }
  if ("neighborhood" in body) {
    const v = stringField(body.neighborhood, "neighborhood", errors, { max: 80, nullable: true });
    if (v !== undefined) out.neighborhood = v;
  }
  if ("reasonText" in body) {
    const v = stringField(body.reasonText, "reasonText", errors, { max: 600, nullable: true });
    if (v !== undefined) out.reasonText = v;
  }
  if ("reviewNotes" in body || "notes" in body) {
    if ("reviewNotes" in body && "notes" in body) {
      errors.push({ field: "notes", code: "conflicting_fields", message: "Send reviewNotes or notes, not both." });
    } else {
      const field = "reviewNotes" in body ? "reviewNotes" : "notes";
      const v = stringField(body[field], field, errors, { max: 4000, nullable: true });
      if (v !== undefined) out.reviewNotes = v;
    }
  }

  if ("priceLevel" in body) {
    const price = validatePrice(body.priceLevel, errors);
    if (price !== undefined) out.priceLevel = price;
  }

  if ("cuisineTags" in body) { const v = tagField(body.cuisineTags, "cuisineTags", CUISINES, errors); if (v) out.cuisineTags = v; }
  if ("dietaryTags" in body) { const v = tagField(body.dietaryTags, "dietaryTags", DIETARY, errors); if (v) out.dietaryTags = v; }
  if ("vibeTags" in body) { const v = tagField(body.vibeTags, "vibeTags", VIBES, errors); if (v) out.vibeTags = v; }
  if ("bestFor" in body) { const v = tagField(body.bestFor, "bestFor", VIBES, errors); if (v) out.bestFor = v; }
  if ("dishHighlights" in body) {
    const arr = body.dishHighlights;
    if (!Array.isArray(arr) || !arr.every((x) => typeof x === "string")) {
      errors.push({ field: "dishHighlights", code: "invalid_type", message: "dishHighlights must be an array of strings." });
    } else {
      const cleaned = [...new Set((arr as string[]).map((x) => x.trim()).filter(Boolean))];
      if (cleaned.length > 20 || cleaned.some((x) => x.length > 80)) {
        errors.push({ field: "dishHighlights", code: "too_long", message: "dishHighlights accepts at most 20 entries of up to 80 characters." });
      } else out.dishHighlights = cleaned;
    }
  }

  // Coordinates travel as a pair: both numbers, or both null to clear, never one alone.
  const hasLat = "lat" in body;
  const hasLng = "lng" in body;
  if (hasLat || hasLng) {
    if (body.lat === null && body.lng === null && mode === "patch") {
      out.lat = null;
      out.lng = null;
    } else if (hasLat !== hasLng || body.lat === null || body.lng === null) {
      errors.push({ field: hasLat ? "lng" : "lat", code: "incomplete_coordinates", message: "Send lat and lng together, as numbers (or both null to clear on update)." });
    } else {
      const ll = validateLatLng(body.lat, body.lng);
      if (ll.ok) {
        out.lat = ll.lat;
        out.lng = ll.lng;
        const market = out.market ?? context.existingMarket;
        if (market) warnings.push(...coordinateWarnings(market, ll.lat, ll.lng));
      } else errors.push(...ll.errors);
    }
  }
  // A market-only correction can make existing coordinates suspicious: surface it, do not block.
  if (mode === "patch" && out.market && !hasLat && !hasLng && context.existingLat != null && context.existingLng != null) {
    warnings.push(...coordinateWarnings(out.market, context.existingLat, context.existingLng));
  }

  if (mode === "patch" && errors.length === 0 && Object.keys(out).length === 0) {
    errors.push({ field: "body", code: "empty_patch", message: "No writable fields were provided." });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out, warnings };
}

/** Same rules for editing an already-published restaurant (publication credential only). */
const PUBLISHED_PATCH_FIELDS = new Set([
  "name", "neighborhood", "address", "websiteDomain", "googlePlaceId", "lat", "lng", "priceLevel",
  "cuisineTags", "dietaryTags", "vibeTags", "bestFor", "dishHighlights", "reasonText", "status",
]);

export interface PublishedWrite extends Omit<CandidateWrite, "status" | "market" | "slug" | "reviewNotes"> {
  status?: "published" | "hidden";
}

export function validatePublishedPatch(body: unknown): Validated<PublishedWrite> {
  if (!isRecord(body)) {
    return { ok: false, errors: [{ field: "body", code: "invalid_body", message: "Request body must be a JSON object." }] };
  }
  const errors: FieldError[] = [];
  for (const key of Object.keys(body)) {
    if (!PUBLISHED_PATCH_FIELDS.has(key)) {
      errors.push({
        field: key,
        code: "unknown_field",
        message: key === "market" || key === "slug" || key === "id" || key === "sourceCandidateId"
          ? `${key} cannot be changed on a published restaurant.`
          : `Unknown field "${key}".`,
      });
    }
  }
  const { status, ...rest } = body as Record<string, unknown>;
  // Reuse the candidate rules for the shared fields (no status, no market/slug/notes here).
  const shared: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) if (PUBLISHED_PATCH_FIELDS.has(k)) shared[k] = v;
  const base = Object.keys(shared).length
    ? validateCandidateBody(shared, "patch")
    : ({ ok: true, value: {}, warnings: [] } as Validated<CandidateWrite>);
  if (!base.ok) errors.push(...base.errors.filter((e) => e.code !== "empty_patch"));
  let out: PublishedWrite = {};
  if (base.ok) {
    const { market, slug, reviewNotes, status: _s, ...ok } = base.value;
    void market; void slug; void reviewNotes; void _s;
    out = ok;
  }
  if (status !== undefined) {
    if (status !== "published" && status !== "hidden") {
      errors.push({ field: "status", code: "invalid_status", message: "status must be published or hidden." });
    } else out.status = status;
  }
  if (errors.length === 0 && Object.keys(out).length === 0) {
    errors.push({ field: "body", code: "empty_patch", message: "No writable fields were provided." });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out, warnings: base.ok ? base.warnings : [] };
}
