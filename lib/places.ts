import type { PlacePhoto } from "@/lib/types";

/**
 * Server-only Google Places (New) helper for restaurant identity photos.
 *
 * IMPORTANT: this module is server-only. It reads `GOOGLE_MAPS_API_KEY` and must
 * never be imported into a Client Component — only the photo route handler
 * (`app/api/restaurants/[id]/photo/route.ts`) imports it. (`server-only` isn't a
 * dependency of this project, so the boundary is kept by convention + review.)
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

// --- Minimal shapes of the Places (New) responses we actually read ---
interface AuthorAttribution {
  displayName?: string;
  uri?: string;
}
interface PlaceDetailsPhoto {
  name?: string;
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
 * Resolve the first Google Place Photo for a Place ID, or `null` if anything is
 * missing or fails (no API key, no Place ID, place/photo not found, quota or
 * network error). NEVER throws — callers degrade to the placeholder hero.
 *
 * Two minimal, field-masked calls per render (nothing cached, per Google policy):
 *   1) Place Details (New) -> the first photo's `name` + `authorAttributions`.
 *   2) Place Photo (New) media with `skipHttpRedirect=true` -> an ephemeral
 *      `photoUri` (so the API key never leaks via a redirect `Location`).
 */
export async function getPlacePhoto(placeId: string): Promise<PlacePhoto | null> {
  const key = apiKey();
  if (!key) return null;
  if (typeof placeId !== "string" || placeId.trim().length === 0) return null;
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
    if (!detailsRes.ok) return null;

    const details = (await detailsRes.json()) as PlaceDetailsResponse;
    const first = details.photos?.find(
      (p) => typeof p?.name === "string" && p.name.length > 0,
    );
    if (!first?.name) return null;

    // 2) Place Photo (New) media — ephemeral URL, no redirect (key stays server-side).
    const mediaUrl =
      `${PLACES_BASE}/${first.name}/media` +
      `?maxWidthPx=${MAX_WIDTH_PX}&skipHttpRedirect=true`;
    const mediaRes = await fetch(mediaUrl, {
      method: "GET",
      headers: { "X-Goog-Api-Key": key },
      cache: "no-store",
    });
    if (!mediaRes.ok) return null;

    const media = (await mediaRes.json()) as PhotoMediaResponse;
    const photoUri = safePhotoUri(media.photoUri);
    if (!photoUri) return null;

    return { photoUri, attributions: cleanAttributions(first.authorAttributions) };
  } catch {
    // Network / quota / parse failure — degrade silently to the placeholder hero.
    return null;
  }
}
