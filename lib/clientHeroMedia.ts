import type { PlacePhoto } from "@/lib/types";

export interface ClientHeroMedia {
  restaurantId: string;
  photo: PlacePhoto | null;
  logoUrl: string | null;
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
    photo: normalizePhoto(data.photo),
    logoUrl: typeof data.logoUrl === "string" && data.logoUrl.length > 0 ? data.logoUrl : null,
    status: typeof data.status === "string" ? data.status : undefined,
    httpStatus: typeof data.httpStatus === "number" ? data.httpStatus : undefined,
    googleStatus: typeof data.googleStatus === "string" ? data.googleStatus : undefined,
  };
}

export function heroMediaImageUrl(media: ClientHeroMedia | null | undefined): string | null {
  return media?.photo?.photoUri ?? media?.logoUrl ?? null;
}

function normalizePhoto(value: unknown): PlacePhoto | null {
  const photo = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const photoUri = typeof photo.photoUri === "string" ? photo.photoUri : "";
  if (photoUri.length === 0) return null;
  return {
    photoUri,
    attributions: Array.isArray(photo.attributions)
      ? photo.attributions.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const attribution = item as Record<string, unknown>;
          const displayName =
            typeof attribution.displayName === "string" ? attribution.displayName : "";
          if (displayName.trim().length === 0) return [];
          return [{
            displayName,
            uri: typeof attribution.uri === "string" ? attribution.uri : undefined,
          }];
        })
      : [],
  };
}
