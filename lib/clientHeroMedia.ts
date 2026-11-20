import { normalizePlacePhoto, type PlacePhoto } from "@/lib/placePhoto";

export interface ClientHeroMedia {
  restaurantId: string;
  photo: PlacePhoto | null;
  logoUrl: string | null;
  /**
   * Upper bound (0-3) on gallery photos, from the default photo response. It does not
   * promise that many working photos: the gallery request is authoritative.
   */
  galleryCount?: number;
  status?: string;
  httpStatus?: number;
  googleStatus?: string;
}

export function normalizeClientHeroMedia(
  restaurantId: string,
  value: unknown,
): ClientHeroMedia {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    restaurantId,
    photo: normalizePlacePhoto(data.photo),
    logoUrl: typeof data.logoUrl === "string" && data.logoUrl.length > 0 ? data.logoUrl : null,
    galleryCount: normalizeGalleryCount(data.galleryCount),
    status: typeof data.status === "string" ? data.status : undefined,
    httpStatus: typeof data.httpStatus === "number" ? data.httpStatus : undefined,
    googleStatus: typeof data.googleStatus === "string" ? data.googleStatus : undefined,
  };
}

export function heroMediaImageUrl(media: ClientHeroMedia | null | undefined): string | null {
  return media?.photo?.photoUri ?? media?.logoUrl ?? null;
}

/** A whole number from 0 to 3; anything else (including an older server) means no gallery. */
export function normalizeGalleryCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? Math.min(value, 3) : 0;
}
