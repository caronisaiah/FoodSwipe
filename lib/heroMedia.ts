import {
  getPlaceGallery,
  getPlacePhotoByOrdinalWithGalleryCount,
  getPlacePhotoWithGalleryCount,
  type PlaceGalleryResult,
  type PlacePhotoStatus,
} from "@/lib/places";
import { logoUrl } from "@/lib/logos";
import type { PlacePhoto } from "@/lib/placePhoto";

/**
 * Server-only shared hero-media resolver — the single source of truth for the
 * three honest hero tiers, reused by BOTH live seed restaurants
 * (`/api/restaurants/[id]/photo`) and review candidates
 * (`/api/admin/restaurants/candidates/[id]/photo`).
 *
 *   1. Google Place Photo  — when a `googlePlaceId` resolves and the key works.
 *      Returns the EPHEMERAL `photoUri` + author attributions. Never persisted,
 *      never proxied/downloaded/rehosted (the browser loads it from Google).
 *   2. Logo.dev brand logo — when there's no photo but a usable `websiteDomain`.
 *      A server-built URL; the browser loads it directly from Logo.dev.
 *   3. Placeholder         — neither available (the caller renders the fallback).
 *
 * IMPORTANT: server-only (reads GOOGLE_MAPS_API_KEY via lib/places and
 * LOGODEV_TOKEN via lib/logos). Never import into a Client Component — the client
 * fetches the route handlers that wrap this, which return the finished URLs only.
 * NEVER throws (getPlacePhoto degrades to a safe diagnostic).
 */

export type HeroMediaTier = "photo" | "logo" | "placeholder";

export interface HeroMedia {
  /** Highest available tier for this restaurant/candidate. */
  tier: HeroMediaTier;
  /** Google Place Photo (ephemeral; never persisted), or null. */
  photo: PlacePhoto | null;
  /** Logo.dev URL (browser loads directly), or null. */
  logoUrl: string | null;
  /** Safe diagnostic from the photo attempt (mirrors getPlacePhoto's status). */
  photoStatus: PlacePhotoStatus;
  /** Upstream Google HTTP status (number only — no body, no secrets). */
  httpStatus?: number;
  /** Google's error enum (e.g. "PERMISSION_DENIED") — never the message text. */
  googleStatus?: string;
  /** Upper bound (0-3) on gallery photos, from the Details response already fetched. */
  galleryCount?: number;
}

/**
 * Resolve the best available hero media for a restaurant or candidate. Mirrors
 * the long-standing behavior of `/api/restaurants/[id]/photo`: when there's no
 * Place ID, no Google call is made and `photoStatus` is "missing-google-place-id"
 * (the logo/placeholder tier carries the hero).
 */
export async function resolveHeroMedia(input: {
  googlePlaceId?: string | null;
  websiteDomain?: string | null;
}): Promise<HeroMedia> {
  // The logo URL is always cheap to build (no network) and serves as the tier-2
  // fallback. The token is read server-side and only the finished URL escapes.
  const logo = logoUrl(input.websiteDomain ?? null);

  const placeId = typeof input.googlePlaceId === "string" ? input.googlePlaceId.trim() : "";
  if (!placeId) {
    return {
      tier: logo ? "logo" : "placeholder",
      photo: null,
      logoUrl: logo,
      photoStatus: "missing-google-place-id",
    };
  }

  const result = await getPlacePhotoWithGalleryCount(placeId);
  return {
    tier: result.photo ? "photo" : logo ? "logo" : "placeholder",
    photo: result.photo,
    logoUrl: logo,
    photoStatus: result.status,
    httpStatus: result.httpStatus,
    googleStatus: result.googleStatus,
    galleryCount: result.galleryCount,
  };
}

/**
 * Prefer an approved exact-location Google photo selection, then fall back to
 * the existing Place Photo -> Logo.dev -> placeholder ladder on any mismatch,
 * stale ordinal, quota/network failure, or missing selection data. Response
 * shape stays identical to `resolveHeroMedia`.
 */
export async function resolveHeroMediaWithSelection(input: {
  googlePlaceId?: string | null;
  websiteDomain?: string | null;
  selectedHero?: {
    sourcePlaceId: string | null;
    selectedPhotoOrdinal: number | null;
  } | null;
}): Promise<HeroMedia> {
  const logo = logoUrl(input.websiteDomain ?? null);
  const placeId = typeof input.googlePlaceId === "string" ? input.googlePlaceId.trim() : "";
  const sourcePlaceId =
    typeof input.selectedHero?.sourcePlaceId === "string"
      ? input.selectedHero.sourcePlaceId.trim()
      : "";
  const ordinal = input.selectedHero?.selectedPhotoOrdinal;

  if (placeId && sourcePlaceId && sourcePlaceId === placeId && typeof ordinal === "number") {
    const selected = await getPlacePhotoByOrdinalWithGalleryCount(sourcePlaceId, ordinal);
    if (selected.photo) {
      return {
        tier: "photo",
        photo: selected.photo,
        logoUrl: logo,
        photoStatus: selected.status,
        httpStatus: selected.httpStatus,
        googleStatus: selected.googleStatus,
        galleryCount: selected.galleryCount,
      };
    }
  }

  return resolveHeroMedia({
    googlePlaceId: input.googlePlaceId,
    websiteDomain: input.websiteDomain,
  });
}

/**
 * Resolve the public gallery: the approved hero first, then up to two more distinct
 * photos. The approved selection counts only when it was approved for this exact
 * Place ID, as for the single hero. `skipHero` omits the hero's media request for a
 * caller that already holds it. Returns the same safe diagnostics as the hero path.
 */
export async function resolveGalleryWithSelection(input: {
  googlePlaceId?: string | null;
  selectedHero?: {
    sourcePlaceId: string | null;
    selectedPhotoOrdinal: number | null;
  } | null;
  skipHero?: boolean;
}): Promise<PlaceGalleryResult> {
  const placeId = typeof input.googlePlaceId === "string" ? input.googlePlaceId.trim() : "";
  const sourcePlaceId =
    typeof input.selectedHero?.sourcePlaceId === "string"
      ? input.selectedHero.sourcePlaceId.trim()
      : "";
  const ordinal = input.selectedHero?.selectedPhotoOrdinal;
  const heroOrdinal =
    placeId && sourcePlaceId === placeId && typeof ordinal === "number" && Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= 10
      ? ordinal
      : null;
  return getPlaceGallery(placeId, { heroOrdinal, skipHero: input.skipHero === true });
}
