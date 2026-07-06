"use client";

import { useEffect, useState } from "react";
import { motion, type MotionStyle } from "framer-motion";
import type { PlacePhoto, PriceLevel, Video } from "@/lib/types";
import { priceLabel } from "@/lib/options";
import VideoEmbed from "@/components/VideoEmbed";
import MaterialIcon from "@/components/MaterialIcon";

/**
 * Profile hero — three honest fallback tiers:
 *   1. Google Place Photo — when the restaurant has a `googlePlaceId` and the
 *      photo fetch succeeds. Loaded directly from Google, never rehosted.
 *   2. Brand logo card — when there's no usable photo but a known `websiteDomain`.
 *      Loaded directly from Logo.dev's CDN (object-contain, never stretched).
 *   3. FoodSwipe placeholder — the video-style poster, also used if the logo errors.
 *
 * Self-contained: both the photo URL and the logo URL come from a single
 * `/api/restaurants/[id]/photo` fetch (the route builds `logoUrl` server-side, so
 * the token never reaches the client). This makes the hero — and the profile body
 * that contains it — fully client-renderable, so it works inside the in-feed
 * scrollable card as well as the standalone /restaurants/[id] page. A YouTube
 * thumbnail is NEVER used as a restaurant hero.
 */
interface PhotoApiResponse {
  photo?: PlacePhoto | null;
  logoUrl?: string | null;
}

export default function RestaurantHero({
  restaurantId,
  fallbackVideo,
  posterEmoji,
  name,
  neighborhood,
  distanceMiles,
  priceLevel,
  heroStyle,
  variant = "page",
  feedHeroFullscreen = false,
}: {
  restaurantId: string;
  fallbackVideo: Video;
  posterEmoji: string;
  name: string;
  neighborhood: string;
  distanceMiles: number;
  priceLevel: PriceLevel;
  /** Optional motion style (opacity/scale) for the scroll-linked fade. Omitted on
   *  the standalone route -> hero is static. */
  heroStyle?: MotionStyle;
  /** "page" = inset rounded hero (standalone route); "feed" = full-bleed hero.
   *  `feedHeroFullscreen` makes the feed hero fill the first card viewport. */
  variant?: "page" | "feed";
  /** Feed-only: make the hero occupy the card's first scroll viewport. */
  feedHeroFullscreen?: boolean;
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

  // Logo tier: only once the fetch resolved with no photo, a logo URL exists, and
  // the logo image hasn't errored out.
  const showLogo = !photo && resolved && Boolean(logoSrc) && !logoFailed;

  return (
    <motion.div
      style={heroStyle}
      className={
        variant === "feed"
          ? feedHeroFullscreen
            ? "relative h-full min-h-full w-full overflow-hidden"
            : "relative aspect-[4/5] w-full overflow-hidden"
          : "relative mx-4 mt-1 aspect-[4/5] overflow-hidden rounded-[28px] ring-1 ring-white/10"
      }
    >
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
      ) : showLogo && logoSrc ? (
        <LogoCard src={logoSrc} name={name} onError={() => setLogoFailed(true)} />
      ) : (
        <VideoEmbed video={fallbackVideo} posterEmoji={posterEmoji} fill />
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-4 pt-16">
        <h1 className="font-display text-3xl font-bold leading-tight text-white drop-shadow">
          {name}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-white/85">
          <span className="inline-flex items-center gap-1">
            <MaterialIcon name="location_on" className="text-[15px]" /> {neighborhood}
          </span>
          <span aria-hidden>·</span>
          <span>{distanceMiles.toFixed(1)} mi away</span>
          <span aria-hidden>·</span>
          <span className="font-semibold text-saffron">{priceLabel(priceLevel)}</span>
        </p>
      </div>
    </motion.div>
  );
}

/**
 * Brand-logo fallback: a premium, centered logo on a clean dark card. The logo
 * keeps its aspect ratio (object-contain) inside a padded light tile so any logo
 * — light or dark — stays legible; it is NEVER stretched or cropped full-bleed.
 * Loaded directly from Logo.dev (never downloaded/rehosted); on error the caller
 * falls back to the FoodSwipe placeholder.
 */
function LogoCard({
  src,
  name,
  onError,
}: {
  src: string;
  name: string;
  onError: () => void;
}) {
  return (
    <div className="absolute inset-0">
      <div
        className="absolute inset-0 bg-gradient-to-b from-[#17171f] to-[#0b0b0f]"
        aria-hidden
      />
      <div className="absolute inset-0 flex items-center justify-center p-8">
        <div className="flex aspect-square w-[55%] max-w-[200px] items-center justify-center rounded-3xl bg-white p-6 shadow-2xl shadow-black/40 ring-1 ring-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element -- the logo is loaded
              directly from Logo.dev's CDN and never downloaded/cropped/rehosted;
              next/image would proxy it through /_next/image, so a plain <img> with
              object-contain is the correct, policy-safe choice here. */}
          <img
            src={src}
            alt={`${name} logo`}
            className="h-full w-full object-contain"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={onError}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Required Google Place Photo attribution. Google's policy: if a photo has author
 * attributions, they must be shown wherever the image appears.
 */
function PhotoAttribution({
  attributions,
}: {
  attributions: PlacePhoto["attributions"];
}) {
  const items = attributions.filter((a) => a.displayName.trim().length > 0);
  return (
    <span className="absolute left-3 top-3 z-10 inline-flex max-w-[80%] items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md ring-1 ring-white/15">
      <MaterialIcon name="photo_camera" className="text-[13px]" />
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
                    onPointerDown={(e) => e.stopPropagation()}
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
