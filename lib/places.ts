import "server-only";
import { readPhotoMetadata, safeHttpsUrl, type AttributionFailure, type PlacePhoto } from "@/lib/placePhoto";

/**
 * Server-only Google Places (New) helper for restaurant identity photos.
 *
 * The server-only boundary keeps GOOGLE_MAPS_API_KEY out of client bundles.
 * Client components consume the DTO via the photo routes.
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
 *  - Eligible photos carry their individual Maps link and validated author list.
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
  | AttributionFailure
  | "no-photos"
  | "invalid-photo-ordinal"
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
  /**
   * Upper bound (0-3) on the distinct, eligible photos this place offers, counted
   * from the Details metadata already fetched. It costs no extra request and does
   * not prove each photo's media will resolve; the gallery response is authoritative.
   */
  galleryCount?: number;
}

// --- Minimal shapes of the Places (New) responses we actually read ---
interface PlaceDetailsPhoto {
  name?: unknown;
  widthPx?: unknown;
  heightPx?: unknown;
  googleMapsUri?: unknown;
  authorAttributions?: unknown;
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

const PHOTO_MASK = "photos.name,photos.googleMapsUri,photos.authorAttributions";

async function fetchPhotoDetails(id: string, key: string, includeDimensions = false) {
  return fetch(`${PLACES_BASE}/places/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": includeDimensions ? PHOTO_MASK + ",photos.widthPx,photos.heightPx" : PHOTO_MASK,
    },
    cache: "no-store",
    redirect: "error",
  });
}

/** Preserve Google's positions, including unusable slots in an admin gallery. */
async function readPhotoList(response: Response): Promise<(PlaceDetailsPhoto | null)[]> {
  const details = await response.json();
  return Array.isArray(details?.photos) ? details.photos : [];
}

/** The most photos a public gallery ever shows, and how far into Google's list it looks. */
export const GALLERY_MAX_PHOTOS = 3;
const DETAILS_PHOTO_WINDOW = 10;

type InspectedPhoto =
  | { ok: true; reference: string; resourceName: string; metadata: Omit<PlacePhoto, "photoUri"> }
  | { ok: false; status: PlacePhotoStatus };

/** Validate one Details entry's resource, source link and credits without any media request. */
function inspectDetailsPhoto(photo: PlaceDetailsPhoto | null | undefined, id: string): InspectedPhoto {
  const segments = typeof photo?.name === "string" ? photo.name.split("/") : [];
  const [places, place, photos, reference] = segments;
  if (segments.length !== 4 || places !== "places" || place !== id || photos !== "photos" ||
      !reference || reference === "." || reference === "..") {
    return { ok: false, status: "invalid-photo-ordinal" };
  }
  const result = readPhotoMetadata(photo?.googleMapsUri, photo?.authorAttributions);
  if (!result.ok) return { ok: false, status: result.status };
  return { ok: true, reference, resourceName: `places/${id}/photos/${reference}`, metadata: result.metadata };
}

/** Request one fresh, ephemeral image URL for an already validated photo. */
async function fetchPhotoMedia(
  id: string,
  reference: string,
  metadata: Omit<PlacePhoto, "photoUri">,
  key: string,
): Promise<PlacePhotoResult> {
  const mediaUrl = `${PLACES_BASE}/places/${encodeURIComponent(id)}/photos/${encodeURIComponent(reference)}/media` +
    `?maxWidthPx=${MAX_WIDTH_PX}&skipHttpRedirect=true`;
  const mediaRes = await fetch(mediaUrl, {
    method: "GET",
    headers: { "X-Goog-Api-Key": key },
    cache: "no-store",
    redirect: "error",
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
  const photoUri = safeHttpsUrl(media?.photoUri);
  if (!photoUri) return { photo: null, status: "photo-media-failed" };
  return { status: "ok", photo: { ...metadata, photoUri } };
}

/** Resolve the resource, image and attribution from the same Details entry. */
async function resolveDetailsPhoto(
  photo: PlaceDetailsPhoto | null | undefined,
  id: string,
  key: string,
): Promise<PlacePhotoResult> {
  const inspected = inspectDetailsPhoto(photo, id);
  if (!inspected.ok) return { photo: null, status: inspected.status };
  return fetchPhotoMedia(id, inspected.reference, inspected.metadata, key);
}

interface EligiblePhoto {
  /** 1-based position in Google's list. */
  ordinal: number;
  reference: string;
  metadata: Omit<PlacePhoto, "photoUri">;
}

/**
 * Distinct photos with a valid resource, source link and credits, in Google's order.
 * Identity is the photo resource name; a second entry that repeats the resource or
 * the same Maps link is a duplicate. Metadata only: nothing here touches the network.
 */
function eligiblePhotos(photos: (PlaceDetailsPhoto | null)[], id: string): EligiblePhoto[] {
  const seenResources = new Set<string>();
  const seenSources = new Set<string>();
  const eligible: EligiblePhoto[] = [];
  photos.slice(0, DETAILS_PHOTO_WINDOW).forEach((photo, index) => {
    const inspected = inspectDetailsPhoto(photo, id);
    if (!inspected.ok) return;
    if (seenResources.has(inspected.resourceName) || seenSources.has(inspected.metadata.googleMapsUri)) return;
    seenResources.add(inspected.resourceName);
    seenSources.add(inspected.metadata.googleMapsUri);
    eligible.push({ ordinal: index + 1, reference: inspected.reference, metadata: inspected.metadata });
  });
  return eligible;
}

async function resolvePlacePhoto(placeId: string, ordinal?: number): Promise<PlacePhotoResult> {
  const key = apiKey();
  if (!key) return { photo: null, status: "missing-api-key" };
  const id = typeof placeId === "string" ? placeId.trim() : "";
  if (!id) return { photo: null, status: "missing-google-place-id" };

  try {
    const detailsRes = await fetchPhotoDetails(id, key);
    if (!detailsRes.ok) {
      return {
        photo: null, status: "place-details-failed", httpStatus: detailsRes.status,
        googleStatus: await safeGoogleError(detailsRes),
      };
    }
    const photos = await readPhotoList(detailsRes);
    if (!photos.length) return { photo: null, status: "no-photos", galleryCount: 0 };
    const galleryCount = Math.min(GALLERY_MAX_PHOTOS, eligiblePhotos(photos, id).length);
    if (ordinal !== undefined) {
      return { ...(await resolveDetailsPhoto(photos[ordinal - 1], id, key)), galleryCount };
    }
    const first = photos.find((p) => typeof p?.name === "string" && p.name.length > 0);
    if (!first) return { photo: null, status: "no-photos", galleryCount };
    return { ...(await resolveDetailsPhoto(first, id, key)), galleryCount };
  } catch {
    return { photo: null, status: "error" };
  }
}

/** The established result shape, without the gallery count added in Phase 13B. */
function withoutGalleryCount({ galleryCount: _count, ...result }: PlacePhotoResult): PlacePhotoResult {
  void _count;
  return result;
}

export async function getPlacePhoto(placeId: string): Promise<PlacePhotoResult> {
  return withoutGalleryCount(await resolvePlacePhoto(placeId));
}

export async function getPlacePhotoByOrdinal(placeId: string, ordinal: number): Promise<PlacePhotoResult> {
  return withoutGalleryCount(await getPlacePhotoByOrdinalWithGalleryCount(placeId, ordinal));
}

/** Same lookup as `getPlacePhoto`, plus `galleryCount` taken from the same Details response. */
export function getPlacePhotoWithGalleryCount(placeId: string): Promise<PlacePhotoResult> {
  return resolvePlacePhoto(placeId);
}

export function getPlacePhotoByOrdinalWithGalleryCount(placeId: string, ordinal: number): Promise<PlacePhotoResult> {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 10) {
    return Promise.resolve({ photo: null, status: "invalid-photo-ordinal" });
  }
  return resolvePlacePhoto(placeId, ordinal);
}

/* -------------------------------------------------------------------------- */
/* Public gallery (Phase 13B)                                                 */
/* -------------------------------------------------------------------------- */

export interface PlaceGalleryResult {
  /** At most three distinct photos, each with its own source link and credits. */
  photos: PlacePhoto[];
  /** Upper bound on eligible photos for this place (0-3), from Details metadata. */
  galleryCount: number;
  /** Source link of the hero this gallery is built around, so a caller can check it
   *  is still the hero it is showing. Null when the place has no eligible photo. */
  heroSourceUri: string | null;
  /** True when `photos[0]` is the hero, with its own fresh image. */
  includesHero: boolean;
  /**
   * True only when the caller asked for `skipHero`: the hero was left out on purpose
   * and never requested. Together with `includesHero`:
   *   includesHero true                      the hero is `photos[0]`;
   *   includesHero false, heroSkipped true   intentional omission, nothing failed;
   *   includesHero false, heroSkipped false  the hero's image could not be resolved
   *                                          (or the place has no eligible photo).
   */
  heroSkipped: boolean;
  status: PlacePhotoStatus;
  httpStatus?: number;
  googleStatus?: string;
}

/**
 * Resolve up to three distinct photos for one place: the hero first, then the next
 * eligible photos in Google's order. One Details request plus at most one media
 * request per photo (two when `skipHero` is set, because the caller already holds
 * the hero). A photo whose media fails is dropped rather than replaced, so the
 * number of upstream requests never grows. Each photo keeps the source link and
 * credits from its own Details entry; nothing is persisted.
 *
 * @param heroOrdinal 1-based ordinal of the approved hero, or null for none.
 */
export async function getPlaceGallery(
  placeId: string,
  options: { heroOrdinal?: number | null; skipHero?: boolean } = {},
): Promise<PlaceGalleryResult> {
  const empty = (status: PlacePhotoStatus, extra: Partial<PlaceGalleryResult> = {}): PlaceGalleryResult => ({
    photos: [], galleryCount: 0, heroSourceUri: null, includesHero: false, heroSkipped: false, status, ...extra,
  });
  const key = apiKey();
  if (!key) return empty("missing-api-key");
  const id = typeof placeId === "string" ? placeId.trim() : "";
  if (!id) return empty("missing-google-place-id");

  try {
    const detailsRes = await fetchPhotoDetails(id, key);
    if (!detailsRes.ok) {
      return empty("place-details-failed", {
        httpStatus: detailsRes.status, googleStatus: await safeGoogleError(detailsRes),
      });
    }
    const list = await readPhotoList(detailsRes);
    if (!list.length) return empty("no-photos");
    const eligible = eligiblePhotos(list, id);
    if (!eligible.length) {
      // Nothing usable: report why the first entry was rejected, as the single-photo path does.
      const first = inspectDetailsPhoto(list.find((p) => p) ?? null, id);
      return empty(first.ok ? "no-photos" : first.status);
    }

    // The approved hero if it is usable, otherwise the first usable photo.
    const ordinal = options.heroOrdinal;
    const hero = (typeof ordinal === "number" ? eligible.find((p) => p.ordinal === ordinal) : undefined) ?? eligible[0];
    const extras = eligible.filter((p) => p !== hero).slice(0, GALLERY_MAX_PHOTOS - 1);
    const wanted = options.skipHero ? extras : [hero, ...extras];
    const galleryCount = Math.min(GALLERY_MAX_PHOTOS, eligible.length);

    const results = await Promise.all(wanted.map(async (photo): Promise<PlacePhotoResult> => {
      try {
        return await fetchPhotoMedia(id, photo.reference, photo.metadata, key);
      } catch {
        return { photo: null, status: "photo-media-failed" };
      }
    }));
    const photos = results.flatMap((r) => (r.photo ? [r.photo] : []));
    const failed = results.find((r) => !r.photo);
    const includesHero = !options.skipHero && Boolean(results[0]?.photo);
    return {
      photos,
      galleryCount,
      heroSourceUri: hero.metadata.googleMapsUri,
      includesHero,
      heroSkipped: options.skipHero === true,
      // Partial results are still "ok"; a status only describes a gallery with nothing to show.
      status: photos.length > 0 || (options.skipHero && !failed) ? "ok" : (failed?.status ?? "no-photos"),
      ...(photos.length ? {} : { httpStatus: failed?.httpStatus, googleStatus: failed?.googleStatus }),
    };
  } catch {
    return empty("error");
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
  googleMapsUri: string | null;
  attributions: PlacePhoto["attributions"];
  hasAttribution: boolean;
  heuristicFlags: PlacePhotoCandidateHeuristicFlags;
  sourceProvider: "google_places";
  relationship: "exact_location";
  status: PlacePhotoStatus;
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
  photo: PlaceDetailsPhoto | null,
  index: number,
  id: string,
  key: string,
): Promise<PlacePhotoCandidate> {
  const widthPx = positiveInt(photo?.widthPx);
  const heightPx = positiveInt(photo?.heightPx);
  const ratio = aspectRatio(widthPx, heightPx);
  let result: PlacePhotoResult;
  try {
    result = await resolveDetailsPhoto(photo, id, key);
  } catch {
    result = { photo: null, status: "photo-media-failed" };
  }

  // A media outage can leave valid credits in Details. Preserve those for the reviewer.
  let metadata: Omit<PlacePhoto, "photoUri"> | null = result.photo;
  if (!metadata && result.status === "photo-media-failed") {
    const details = readPhotoMetadata(photo?.googleMapsUri, photo?.authorAttributions);
    if (details.ok) metadata = details.metadata;
  }
  const attributions = metadata?.attributions ?? [];
  return {
    ordinal: index + 1,
    widthPx,
    heightPx,
    aspectRatio: ratio,
    attributions,
    hasAttribution: attributions.length > 0,
    heuristicFlags: heuristicFlags(widthPx, heightPx, ratio),
    sourceProvider: "google_places",
    relationship: "exact_location",
    photoUri: result.photo?.photoUri ?? null,
    googleMapsUri: metadata?.googleMapsUri ?? null,
    status: result.status,
    httpStatus: result.httpStatus,
    googleStatus: result.googleStatus,
  };
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
    const detailsRes = await fetchPhotoDetails(id, key, true);
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

    const photos = (await readPhotoList(detailsRes)).slice(0, requestedCount);
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
      photos.map((photo, index) => resolvePhotoCandidate(photo, index, id, key)),
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
