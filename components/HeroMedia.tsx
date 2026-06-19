"use client";

import { useEffect, useState } from "react";
import type { PlacePhoto } from "@/lib/types";

/**
 * Shared restaurant hero media — the legal-safe identity ladder used by the feed
 * card: Google Place Photo → Logo.dev logo card → FoodSwipe placeholder. Fetches
 * `/api/restaurants/[id]/photo` ONCE per mount; give it `key={id}` at the call
 * site so a new restaurant remounts with fresh state.
 *
 * Token-safe: the logo URL is built server-side and arrives in the JSON response,
 * so this client component never imports `lib/logos` or touches `LOGODEV_TOKEN`.
 * Images load directly from Google / Logo.dev — never downloaded, cropped, or
 * rehosted. A YouTube thumbnail is never used here. Fills its `relative` parent.
 */
interface PhotoApiResponse {
  photo?: PlacePhoto | null;
  logoUrl?: string | null;
}

export default function HeroMedia({
  restaurantId,
  name,
  posterEmoji,
}: {
  restaurantId: string;
  name: string;
  posterEmoji: string;
}) {
  const [photo, setPhoto] = useState<PlacePhoto | null>(null);
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/restaurants/${restaurantId}/photo`);
        const data = (await res.json()) as PhotoApiResponse;
        const p = data.photo;
        const nextPhoto: PlacePhoto | null =
          p && typeof p.photoUri === "string" && p.photoUri.length > 0
            ? {
                photoUri: p.photoUri,
                attributions: Array.isArray(p.attributions) ? p.attributions : [],
              }
            : null;
        const nextLogo =
          typeof data.logoUrl === "string" && data.logoUrl.length > 0
            ? data.logoUrl
            : null;
        if (!cancelled) {
          setPhoto(nextPhoto);
          setLogoSrc(nextLogo);
          setResolved(true);
        }
      } catch {
        if (!cancelled) {
          setPhoto(null);
          setLogoSrc(null);
          setResolved(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  // Tier 1 — Google Place Photo.
  if (photo) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- Google's ephemeral
            Place Photo URL must load directly from Google (never downloaded/rehosted);
            next/image would proxy it through /_next/image, which the policy forbids. */}
        <img
          src={photo.photoUri}
          alt={`${name} — photo via Google`}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
        <PhotoAttribution attributions={photo.attributions} />
      </>
    );
  }

  // Tier 2 — brand logo on a clean centered card.
  if (resolved && logoSrc && !logoFailed) {
    return (
      <div className="absolute inset-0">
        <div
          className="absolute inset-0 bg-gradient-to-b from-[#1a160f] to-[#0b0b0d]"
          aria-hidden
        />
        <div className="absolute inset-0 flex items-center justify-center p-10">
          <div className="flex aspect-square w-1/2 max-w-[180px] items-center justify-center rounded-3xl bg-white p-6 shadow-2xl shadow-black/40 ring-1 ring-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element -- the logo loads
                directly from Logo.dev's CDN; never downloaded/cropped/rehosted, so a
                plain object-contain <img> is the correct, policy-safe choice here. */}
            <img
              src={logoSrc}
              alt={`${name} logo`}
              className="h-full w-full object-contain"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setLogoFailed(true)}
            />
          </div>
        </div>
      </div>
    );
  }

  // Tier 3 — FoodSwipe placeholder (on-brand gradient + cuisine glyph). Also the
  // loading state, so the card never flashes black.
  return (
    <div className="absolute inset-0">
      <div
        className="absolute inset-0 bg-gradient-to-br from-[#2a1c10] via-[#0e0e12] to-[#1a0f14]"
        aria-hidden
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-7xl opacity-80 drop-shadow-lg" aria-hidden>
          {posterEmoji}
        </span>
      </div>
    </div>
  );
}

/**
 * Required Google Place Photo attribution (shown wherever the photo appears).
 * Top-right, clear of the top-left "Trending" badge and the centered action rail.
 */
function PhotoAttribution({
  attributions,
}: {
  attributions: PlacePhoto["attributions"];
}) {
  const items = attributions.filter((a) => a.displayName.trim().length > 0);
  return (
    <span className="absolute right-3 top-3 z-20 inline-flex max-w-[60%] items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md ring-1 ring-white/15">
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
                    className="underline decoration-white/40 underline-offset-2"
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
