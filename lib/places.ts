import type { PlacePhoto } from "@/lib/types";

/**
 * Server-only Google Places (New) helper for restaurant identity photos.
 *
 * IMPORTANT: this module is server-only. It reads `GOOGLE_MAPS_API_KEY` and must
 * never be imported into a Client Component — only server route handlers import
 * it (`app/api/restaurants/[id]/photo/route.ts` for photos and
 * `app/api/admin/restaurants/candidates/import/google/route.ts` for the admin
 * Text Search import). (`server-only` isn't a dependency of this project, so the
 * boundary is kept by convention + review.)
 *
 * Legal-safe contract (Google Places policies — see README):
 *  - We store ONLY `googlePlaceId` long-term (in the seed). Place IDs are the one
 *    field Google permits caching indefinitely.
 *  - We NEVER cache/persist the photo `name` (Google forbids it — it can expire),
 *    the ephemeral `photoUri`, the image bytes, or the attribution. Every render
 *    fetches fresh (`cache: "no-store"`), and the route sends `Cache-Control:
 *    no-store`.
 *  - We NEVER download / proxy / crop / rehost the bytes. We return Google's
 *    ephemeral `photoUri` (a googleusercontent URL with NO API key in it) and the
 *    browser loads it directly from Google.
 *  - The API key is read here, server-side only, sent via the `X-Goog-Api-Key`
 *    header (never in a URL, never logged), and never returned to a caller.
 *  - Author attribution is returned so the UI can display it wherever the image
 *    is shown, as Google requires.
 */

const PLACES_BASE = "https://places.googleapis.com/v1";
// Enough for a crisp 4:5 mobile hero without pulling an oversized image.
const MAX_WIDTH_PX = 1200;

/**
 * Safe, non-sensitive diagnostic outcome of a photo resolution. Lets the route
 * report *why* `photo` is null without exposing the key or any raw Google body.
 */
export type PlacePhotoStatus =
  | "ok"
  | "missing-api-key"
  | "missing-google-place-id"
  | "place-details-failed"
  | "no-photos"
  | "photo-media-failed"
  | "error";

export interface PlacePhotoResult {
  /** The resolved photo, or null on any non-`ok` status (user-facing fallback). */
  photo: PlacePhoto | null;
  status: PlacePhotoStatus;
  /** Upstream HTTP status from Google (a number only — no body, no secrets). */
  httpStatus?: number;
  /** Google's error enum (e.g. "PERMISSION_DENIED") — never the message text. */
  googleStatus?: string;
}

// --- Minimal shapes of the Places (New) responses we actually read ---
interface AuthorAttribution {
  displayName?: string;
  uri?: string;
}
interface PlaceDetailsPhoto {
  name?: string;
  widthPx?: number;
  heightPx?: number;
  authorAttributions?: AuthorAttribution[];
}
interface PlaceDetailsResponse {
  photos?: PlaceDetailsPhoto[];
}
interface PhotoMediaResponse {
  photoUri?: string;
}

function apiKey(): string | undefined {
  const k = process.env.GOOGLE_MAPS_API_KEY;
  return typeof k === "string" && k.trim().length > 0 ? k.trim() : undefined;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : null;
}

/** Accept only a well-formed https URL for the ephemeral photo (never persisted). */
function safePhotoUri(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Keep only attributions that carry a usable display name; https links only. */
function cleanAttributions(
  raw: AuthorAttribution[] | undefined,
): PlacePhoto["attributions"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => {
      const displayName =
        typeof a.displayName === "string" ? a.displayName.trim() : "";
      let uri: string | undefined;
      if (typeof a.uri === "string") {
        try {
          uri = new URL(a.uri).protocol.startsWith("http") ? a.uri : undefined;
        } catch {
          uri = undefined;
        }
      }
      return { displayName, uri };
    })
    .filter((a) => a.displayName.length > 0);
}

/**
 * Extract ONLY Google's safe error enum (e.g. "PERMISSION_DENIED") from a failed
 * response body. Deliberately ignores `error.message` (which can echo request
 * details / project info) and anything that isn't a short uppercase token.
 */
async function safeGoogleError(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { status?: unknown } };
    const s = body?.error?.status;
    if (typeof s === "string" && /^[A-Z_]{1,40}$/.test(s)) return s;
  } catch {
    // Empty / non-JSON body — nothing safe to report beyond the HTTP status.
  }
  return undefined;
}

/**
 * Resolve the first Google Place Photo for a Place ID. Returns a
 * `PlacePhotoResult` whose `photo` is non-null only on `status: "ok"`; every
 * other status carries `photo: null` (the user-facing fallback) plus a SAFE
 * diagnostic (status string, numeric upstream HTTP status, Google error enum) —
 * never the API key and never a raw Google body. NEVER throws.
 *
 * Two minimal, field-masked calls per render (nothing cached, per Google policy):
 *   1) Place Details (New) -> the first photo's `name` + `authorAttributions`.
 *   2) Place Photo (New) media with `skipHttpRedirect=true` -> an ephemeral
 *      `photoUri` (so the API key never leaks via a redirect `Location`).
 */
export async function getPlacePhoto(placeId: string): Promise<PlacePhotoResult> {
  const key = apiKey();
  if (!key) return { photo: null, status: "missing-api-key" };
  if (typeof placeId !== "string" || placeId.trim().length === 0) {
    return { photo: null, status: "missing-google-place-id" };
  }
  const id = placeId.trim();

  try {
    // 1) Place Details (New) — request ONLY the photo name + attributions.
    const detailsRes = await fetch(
      `${PLACES_BASE}/places/${encodeURIComponent(id)}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "photos.name,photos.authorAttributions",
        },
        cache: "no-store",
      },
    );
    if (!detailsRes.ok) {
      return {
        photo: null,
        status: "place-details-failed",
        httpStatus: detailsRes.status,
        googleStatus: await safeGoogleError(detailsRes),
      };
    }

    const details = (await detailsRes.json()) as PlaceDetailsResponse;
    const first = details.photos?.find(
      (p) => typeof p?.name === "string" && p.name.length > 0,
    );
    if (!first?.name) return { photo: null, status: "no-photos" };

    // 2) Place Photo (New) media — ephemeral URL, no redirect (key stays server-side).
    const mediaUrl =
      `${PLACES_BASE}/${first.name}/media` +
      `?maxWidthPx=${MAX_WIDTH_PX}&skipHttpRedirect=true`;
    const mediaRes = await fetch(mediaUrl, {
      method: "GET",
      headers: { "X-Goog-Api-Key": key },
      cache: "no-store",
    });
    if (!mediaRes.ok) {
      return {
        photo: null,
        status: "photo-media-failed",
        httpStatus: mediaRes.status,
        googleStatus: await safeGoogleError(mediaRes),
      };
    }

    const media = (await mediaRes.json()) as PhotoMediaResponse;
    const photoUri = safePhotoUri(media.photoUri);
    if (!photoUri) return { photo: null, status: "photo-media-failed" };

    return {
      photo: { photoUri, attributions: cleanAttributions(first.authorAttributions) },
      status: "ok",
    };
  } catch {
    // Network / quota / parse failure — degrade to the placeholder hero.
    return { photo: null, status: "error" };
  }
}

/* -------------------------------------------------------------------------- */
/* Exact-location photo candidates (admin-only preview, P2B)                  */
/* -------------------------------------------------------------------------- */

export interface PlacePhotoCandidateHeuristicFlags {
  highResolution: boolean;
  cropFriendly: boolean;
  veryWide: boolean;
  lowResolution: boolean;
  /**
   * We do not download/analyze image bytes in this slice, so logo/text detection
   * is intentionally unknown rather than guessed from metadata.
   */
  possibleLogoOrTextHeavy: "unknown";
}

export interface PlacePhotoCandidate {
  /** 1-based order returned by Google for this exact Place ID. */
  ordinal: number;
  widthPx: number | null;
  heightPx: number | null;
  aspectRatio: number | null;
  /** Ephemeral Google URL resolved at request time. Do not persist. */
  photoUri: string | null;
  attributions: PlacePhoto["attributions"];
  hasAttribution: boolean;
  heuristicFlags: PlacePhotoCandidateHeuristicFlags;
  sourceProvider: "google_places";
  relationship: "exact_location";
  status: "ok" | "photo-media-failed";
  httpStatus?: number;
  googleStatus?: string;
}

export interface PlacePhotoCandidatesResult {
  status: PlacePhotoStatus;
  candidates: PlacePhotoCandidate[];
  requestedCount: number;
  detailsPhotoCount: number;
  resolvedCount: number;
  failedCount: number;
  httpStatus?: number;
  googleStatus?: string;
}

function aspectRatio(widthPx: number | null, heightPx: number | null): number | null {
  if (!widthPx || !heightPx) return null;
  return Number((widthPx / heightPx).toFixed(2));
}

function heuristicFlags(
  widthPx: number | null,
  heightPx: number | null,
  ratio: number | null,
): PlacePhotoCandidateHeuristicFlags {
  return {
    highResolution: Boolean(widthPx && heightPx && widthPx >= 900 && heightPx >= 900),
    cropFriendly: Boolean(ratio && ratio >= 0.55 && ratio <= 1.35),
    veryWide: Boolean(ratio && ratio > 1.75),
    lowResolution: Boolean(widthPx && heightPx && (widthPx < 700 || heightPx < 700)),
    possibleLogoOrTextHeavy: "unknown",
  };
}

async function resolvePhotoCandidate(
  photo: PlaceDetailsPhoto,
  index: number,
  key: string,
): Promise<PlacePhotoCandidate> {
  const widthPx = positiveInt(photo.widthPx);
  const heightPx = positiveInt(photo.heightPx);
  const ratio = aspectRatio(widthPx, heightPx);
  const attributions = cleanAttributions(photo.authorAttributions);
  const base: Omit<PlacePhotoCandidate, "photoUri" | "status" | "httpStatus" | "googleStatus"> = {
    ordinal: index + 1,
    widthPx,
    heightPx,
    aspectRatio: ratio,
    attributions,
    hasAttribution: attributions.length > 0,
    heuristicFlags: heuristicFlags(widthPx, heightPx, ratio),
    sourceProvider: "google_places",
    relationship: "exact_location",
  };

  try {
    const mediaUrl =
      `${PLACES_BASE}/${photo.name}/media` +
      `?maxWidthPx=${MAX_WIDTH_PX}&skipHttpRedirect=true`;
    const mediaRes = await fetch(mediaUrl, {
      method: "GET",
      headers: { "X-Goog-Api-Key": key },
      cache: "no-store",
    });
    if (!mediaRes.ok) {
      return {
        ...base,
        photoUri: null,
        status: "photo-media-failed",
        httpStatus: mediaRes.status,
        googleStatus: await safeGoogleError(mediaRes),
      };
    }

    const media = (await mediaRes.json()) as PhotoMediaResponse;
    const photoUri = safePhotoUri(media.photoUri);
    if (!photoUri) return { ...base, photoUri: null, status: "photo-media-failed" };

    return { ...base, photoUri, status: "ok" };
  } catch {
    return { ...base, photoUri: null, status: "photo-media-failed" };
  }
}

/**
 * Fetch up to ten exact-location Google Place Photo candidates for an admin
 * reviewer. The Google photo `name` is used only inside this function to resolve
 * a fresh `photoUri`, then discarded; callers never receive it and nothing here
 * writes to the database.
 */
export async function getPlacePhotoCandidates(
  placeId: string,
  maxCandidates = 10,
): Promise<PlacePhotoCandidatesResult> {
  const key = apiKey();
  const requestedCount = Math.min(Math.max(Math.trunc(maxCandidates) || 10, 1), 10);
  if (!key) {
    return {
      status: "missing-api-key",
      candidates: [],
      requestedCount,
      detailsPhotoCount: 0,
      resolvedCount: 0,
      failedCount: 0,
    };
  }
  if (typeof placeId !== "string" || placeId.trim().length === 0) {
    return {
      status: "missing-google-place-id",
      candidates: [],
      requestedCount,
      detailsPhotoCount: 0,
      resolvedCount: 0,
      failedCount: 0,
    };
  }
  const id = placeId.trim();

  try {
    const detailsRes = await fetch(
      `${PLACES_BASE}/places/${encodeURIComponent(id)}`,
      {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "photos.name,photos.widthPx,photos.heightPx,photos.authorAttributions",
        },
        cache: "no-store",
      },
    );
    if (!detailsRes.ok) {
      return {
        status: "place-details-failed",
        candidates: [],
        requestedCount,
        detailsPhotoCount: 0,
        resolvedCount: 0,
        failedCount: 0,
        httpStatus: detailsRes.status,
        googleStatus: await safeGoogleError(detailsRes),
      };
    }

    const details = (await detailsRes.json()) as PlaceDetailsResponse;
    const photos = Array.isArray(details.photos)
      ? details.photos
          .filter((p) => typeof p?.name === "string" && p.name.length > 0)
          .slice(0, requestedCount)
      : [];
    if (photos.length === 0) {
      return {
        status: "no-photos",
        candidates: [],
        requestedCount,
        detailsPhotoCount: 0,
        resolvedCount: 0,
        failedCount: 0,
      };
    }

    const candidates = await Promise.all(
      photos.map((photo, index) => resolvePhotoCandidate(photo, index, key)),
    );
    const resolvedCount = candidates.filter((c) => c.status === "ok").length;
    const failedCount = candidates.length - resolvedCount;

    return {
      status: resolvedCount > 0 ? "ok" : "photo-media-failed",
      candidates,
      requestedCount,
      detailsPhotoCount: photos.length,
      resolvedCount,
      failedCount,
    };
  } catch {
    return {
      status: "error",
      candidates: [],
      requestedCount,
      detailsPhotoCount: 0,
      resolvedCount: 0,
      failedCount: 0,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Text Search (New) — admin candidate import (Phase 2)                       */
/* -------------------------------------------------------------------------- */

export type PlacesSearchStatus =
  | "ok"
  | "missing-api-key"
  | "search-failed"
  | "error";

/** A single Text Search result, mapped to only the fields we requested. */
export interface PlaceTextResult {
  placeId: string;
  displayName: string | null;
  formattedAddress: string | null;
  lat: number | null;
  lng: number | null;
  websiteUri: string | null;
  /** Raw Google enum, e.g. "PRICE_LEVEL_MODERATE" — mapped by the caller. */
  googlePriceLevel: string | null;
  primaryType: string | null;
  types: string[];
  // Expiring Google-derived signals used ONLY for the internal review-likelihood
  // score (admin triage). Never displayed to users, never shown in /feed, never
  // treated as FoodSwipe popularity.
  rating: number | null;
  userRatingCount: number | null;
}

export interface PlacesSearchResult {
  status: PlacesSearchStatus;
  results: PlaceTextResult[];
  httpStatus?: number;
  googleStatus?: string;
}

interface RawTextPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  priceLevel?: string;
  websiteUri?: string;
  types?: string[];
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
}

function toTextResult(p: RawTextPlace): PlaceTextResult | null {
  const placeId = typeof p.id === "string" && p.id.trim().length > 0 ? p.id.trim() : null;
  if (!placeId) return null; // a result with no Place ID is useless for review
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  return {
    placeId,
    displayName: str(p.displayName?.text),
    formattedAddress: str(p.formattedAddress),
    lat: num(p.location?.latitude),
    lng: num(p.location?.longitude),
    websiteUri: str(p.websiteUri),
    googlePriceLevel: str(p.priceLevel),
    primaryType: str(p.primaryType),
    types: Array.isArray(p.types)
      ? p.types.filter((t): t is string => typeof t === "string")
      : [],
    rating: num(p.rating),
    userRatingCount:
      typeof p.userRatingCount === "number" && Number.isFinite(p.userRatingCount)
        ? Math.max(0, Math.trunc(p.userRatingCount))
        : null,
  };
}

/**
 * Google Places API (New) Text Search, server-side, for the admin candidate
 * import. Minimal field mask — NO photos, review TEXT, or editorial/generative
 * summaries are requested. `rating` + `userRatingCount` ARE requested, but only
 * to compute the INTERNAL admin-only review-likelihood score (never displayed to
 * users, never used in /feed, never treated as FoodSwipe popularity); they are
 * expiring Google-derived metadata. NEVER throws; returns a safe diagnostic
 * (status + numeric httpStatus + Google error enum) on failure.
 */
export async function searchPlacesText(
  query: string,
  maxResults: number,
): Promise<PlacesSearchResult> {
  const key = apiKey();
  if (!key) return { status: "missing-api-key", results: [] };
  const q = typeof query === "string" ? query.trim() : "";
  if (q.length === 0) return { status: "search-failed", results: [] };
  const max = Math.min(Math.max(Math.trunc(maxResults) || 0, 1), 20);

  try {
    const res = await fetch(`${PLACES_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.location",
          "places.priceLevel",
          "places.websiteUri",
          "places.types",
          "places.primaryType",
          // Expiring signals for the INTERNAL review-likelihood score only.
          "places.rating",
          "places.userRatingCount",
        ].join(","),
      },
      body: JSON.stringify({ textQuery: q, maxResultCount: max }),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        status: "search-failed",
        results: [],
        httpStatus: res.status,
        googleStatus: await safeGoogleError(res),
      };
    }
    const data = (await res.json()) as { places?: RawTextPlace[] };
    const results = Array.isArray(data.places)
      ? data.places
          .map(toTextResult)
          .filter((r): r is PlaceTextResult => r !== null)
      : [];
    return { status: "ok", results };
  } catch {
    return { status: "error", results: [] };
  }
}
