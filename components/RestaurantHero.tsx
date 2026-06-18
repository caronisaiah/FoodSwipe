"use client";

import { useEffect, useState } from "react";
import type { PlacePhoto, PriceLevel, Video } from "@/lib/types";
import { priceLabel } from "@/lib/options";
import VideoEmbed from "@/components/VideoEmbed";

/**
 * Profile hero.
 *
 * Prefers a real Google Place Photo (the restaurant's identity image) when one
 * is available; otherwise falls back to the existing video-style placeholder
 * hero. The photo is fetched fresh from `/api/restaurants/[id]/photo` (server
 * resolves it via Google Places) and is NEVER downloaded, stored, cropped, or
 * rehosted — the browser loads Google's ephemeral image URL directly, and
 * Google's required author attribution is shown on top. A YouTube thumbnail is
 * never used as a restaurant hero: the fallback is always the placeholder/video.
 */
export default function RestaurantHero({
  restaurantId,
  fallbackVideo,
  posterEmoji,
  name,
  neighborhood,
  distanceMiles,
  priceLevel,
}: {
  restaurantId: string;
  fallbackVideo: Video;
  posterEmoji: string;
  name: string;
  neighborhood: string;
  distanceMiles: number;
  priceLevel: PriceLevel;
}) {
  const [photo, setPhoto] = useState<PlacePhoto | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/restaurants/${restaurantId}/photo`);
        const data = (await res.json()) as { photo?: PlacePhoto | null };
        const p = data.photo;
        const next: PlacePhoto | null =
          p && typeof p.photoUri === "string" && p.photoUri.length > 0
            ? {
                photoUri: p.photoUri,
                attributions: Array.isArray(p.attributions) ? p.attributions : [],
              }
            : null;
        if (!cancelled) setPhoto(next);
      } catch {
        if (!cancelled) setPhoto(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  return (
    <div className="relative mx-4 mt-1 aspect-[4/5] overflow-hidden rounded-[28px] ring-1 ring-white/10">
      {photo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- Google's Place
              Photo is an ephemeral URL that must be loaded directly from Google
              and never downloaded/rehosted. next/image would proxy it through
              /_next/image (effectively caching/rehosting), which Google's policy
              forbids, so a plain <img> is the correct, legal-safe choice here. */}
          <img
            src={photo.photoUri}
            alt={`${name} — photo via Google`}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <PhotoAttribution attributions={photo.attributions} />
        </>
      ) : (
        <VideoEmbed video={fallbackVideo} posterEmoji={posterEmoji} fill />
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-4 pt-16">
        <h1 className="font-display text-3xl font-bold leading-tight text-white drop-shadow">
          {name}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-white/85">
          <span>📍 {neighborhood}</span>
          <span aria-hidden>·</span>
          <span>{distanceMiles.toFixed(1)} mi away</span>
          <span aria-hidden>·</span>
          <span className="font-semibold text-mint">{priceLabel(priceLevel)}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * Required Google Place Photo attribution. Google's policy: if a photo has
 * author attributions, they must be shown wherever the image appears. Placed
 * top-left so the name gradient at the bottom never hides it.
 */
function PhotoAttribution({
  attributions,
}: {
  attributions: PlacePhoto["attributions"];
}) {
  const items = attributions.filter((a) => a.displayName.trim().length > 0);
  return (
    <span className="absolute left-3 top-3 z-10 inline-flex max-w-[80%] items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md ring-1 ring-white/15">
      <span aria-hidden>📷</span>
      <span className="truncate">
        {items.length > 0 ? (
          <>
            Photo:{" "}
            {items.map((a, i) => (
              <span key={`${a.displayName}-${i}`}>
                {i > 0 && ", "}
                {a.uri ? (
                  <a
                    href={a.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-white/40 underline-offset-2 hover:decoration-white"
                  >
                    {a.displayName}
                  </a>
                ) : (
                  a.displayName
                )}
              </span>
            ))}{" "}
            via Google
          </>
        ) : (
          "Photo via Google"
        )}
      </span>
    </span>
  );
}
