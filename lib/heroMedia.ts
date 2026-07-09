import { getPlacePhoto, getPlacePhotoByOrdinal, type PlacePhotoStatus } from "@/lib/places";
import { logoUrl } from "@/lib/logos";
import type { PlacePhoto } from "@/lib/types";

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

  const result = await getPlacePhoto(placeId);
  return {
    tier: result.photo ? "photo" : logo ? "logo" : "placeholder",
    photo: result.photo,
    logoUrl: logo,
    photoStatus: result.status,
    httpStatus: result.httpStatus,
    googleStatus: result.googleStatus,
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
    const selected = await getPlacePhotoByOrdinal(sourcePlaceId, ordinal);
    if (selected.photo) {
      return {
        tier: "photo",
        photo: selected.photo,
        logoUrl: logo,
        photoStatus: selected.status,
        httpStatus: selected.httpStatus,
        googleStatus: selected.googleStatus,
      };
    }
  }

  return resolveHeroMedia({
    googlePlaceId: input.googlePlaceId,
    websiteDomain: input.websiteDomain,
  });
}
