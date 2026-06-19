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
