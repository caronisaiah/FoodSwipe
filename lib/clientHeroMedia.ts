import { normalizePlacePhoto, type PlacePhoto } from "@/lib/placePhoto";

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
    photo: normalizePlacePhoto(data.photo),
    logoUrl: typeof data.logoUrl === "string" && data.logoUrl.length > 0 ? data.logoUrl : null,
    status: typeof data.status === "string" ? data.status : undefined,
    httpStatus: typeof data.httpStatus === "number" ? data.httpStatus : undefined,
    googleStatus: typeof data.googleStatus === "string" ? data.googleStatus : undefined,
  };
}

export function heroMediaImageUrl(media: ClientHeroMedia | null | undefined): string | null {
  return media?.photo?.photoUri ?? media?.logoUrl ?? null;
}
