/** Fresh metadata for one specific Google photo. Never persist any of these fields. */
export interface PlacePhoto {
  sourceProvider: "google_places";
  photoUri: string;
  /** Opens this individual photo in Google Maps. */
  googleMapsUri: string;
  attributions: { displayName: string; uri?: string; photoUri?: string }[];
}

export type AttributionFailure = "missing-photo-source" | "invalid-photo-attributions";

/** Only author profile/avatar fields may use Google's scheme-relative form. */
export function safeHttpsUrl(value: unknown, allowSchemeRelative = false): string | undefined {
  if (typeof value !== "string" || /[\s\p{Cc}\\]/u.test(value)) return undefined;

  const absolute = allowSchemeRelative && value.startsWith("//") ? "https:" + value : value;
  // URL alone also accepts malformed forms such as https:host and https:///host.
  if (!/^https:\/\/[^/]/i.test(absolute)) return undefined;
  try {
    const url = new URL(absolute);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return undefined;
    for (const parameter of url.searchParams.keys()) {
      if (["key", "x-goog-api-key"].includes(parameter.toLowerCase())) return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

type PhotoMetadata = Omit<PlacePhoto, "photoUri">;

export function readPhotoMetadata(source: unknown, authors: unknown):
  | { ok: true; metadata: PhotoMetadata }
  | { ok: false; status: AttributionFailure } {
  const googleMapsUri = safeHttpsUrl(source);
  if (!googleMapsUri) return { ok: false, status: "missing-photo-source" };
  if (!Array.isArray(authors)) return { ok: false, status: "invalid-photo-attributions" };

  const attributions: PlacePhoto["attributions"] = [];
  for (const author of authors) {
    if (!author || typeof author.displayName !== "string" || !author.displayName.trim()) {
      return { ok: false, status: "invalid-photo-attributions" };
    }

    const credit: PlacePhoto["attributions"][number] = { displayName: author.displayName.trim() };
    for (const field of ["uri", "photoUri"] as const) {
      if (author[field] === undefined) continue;
      const url = safeHttpsUrl(author[field], true);
      if (!url) return { ok: false, status: "invalid-photo-attributions" };
      credit[field] = url;
    }
    attributions.push(credit);
  }

  return { ok: true, metadata: { sourceProvider: "google_places", googleMapsUri, attributions } };
}

/** Validate the public DTO at the client boundary, including during a rolling release. */
export function normalizePlacePhoto(value: unknown): PlacePhoto | null {
  if (!value || typeof value !== "object") return null;
  const photo = value as Record<string, unknown>;
  if (photo.sourceProvider !== "google_places") return null;
  const photoUri = safeHttpsUrl(photo.photoUri);
  const result = readPhotoMetadata(photo.googleMapsUri, photo.attributions);
  return photoUri && result.ok ? { ...result.metadata, photoUri } : null;
}
