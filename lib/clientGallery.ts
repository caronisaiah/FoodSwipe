import { normalizePlacePhoto, safeHttpsUrl, type PlacePhoto } from "./placePhoto";

/** Most photos a restaurant ever shows, the hero included. */
export const GALLERY_MAX_PHOTOS = 3;

/** The validated body of `GET /api/restaurants/[id]/photo?gallery=1&skipHero=1`. */
export interface GalleryExtras {
  photos: PlacePhoto[];
  /** Source link of the hero the server built this gallery around. */
  heroSourceUri: string | null;
}

/**
 * Validate the gallery response at the client boundary. Every photo must pass the same
 * check as a hero, so a photo without a valid source link, credits or image is dropped
 * here and can never be shown without them.
 */
export function normalizeGalleryResponse(value: unknown): GalleryExtras | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.photos)) return null;
  const photos: PlacePhoto[] = [];
  for (const candidate of body.photos) {
    const photo = normalizePlacePhoto(candidate);
    if (photo) photos.push(photo);
  }
  return { photos, heroSourceUri: safeHttpsUrl(body.heroSourceUri) ?? null };
}

/**
 * The extra photos to show after `hero`, or null when the response was built around a
 * different hero than the one on screen. Identity is the photo's own Maps link, never its
 * ephemeral image URL. The hero is never repeated and the total never exceeds three.
 */
export function extrasForHero(hero: PlacePhoto, response: GalleryExtras): PlacePhoto[] | null {
  if (response.heroSourceUri !== hero.googleMapsUri) return null;
  const seen = new Set([hero.googleMapsUri]);
  const extras: PlacePhoto[] = [];
  for (const photo of response.photos) {
    if (seen.has(photo.googleMapsUri)) continue;
    seen.add(photo.googleMapsUri);
    extras.push(photo);
    if (extras.length === GALLERY_MAX_PHOTOS - 1) break;
  }
  return extras;
}

/**
 * Session memory for fetched extras. Image URLs are ephemeral, so entries expire and
 * nothing here is ever written to storage.
 */
export function createGalleryCache(now: () => number, ttlMs = 15 * 60_000, maxEntries = 24) {
  const entries = new Map<string, { at: number; value: GalleryExtras }>();
  return {
    get(restaurantId: string): GalleryExtras | undefined {
      const entry = entries.get(restaurantId);
      if (!entry) return undefined;
      if (now() - entry.at > ttlMs) {
        entries.delete(restaurantId);
        return undefined;
      }
      return entry.value;
    },
    set(restaurantId: string, value: GalleryExtras) {
      entries.delete(restaurantId);
      entries.set(restaurantId, { at: now(), value });
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
    },
    delete(restaurantId: string) {
      entries.delete(restaurantId);
    },
    size: () => entries.size,
  };
}
