"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { motion, type MotionStyle } from "framer-motion";
import type { PriceLevel, Video } from "@/lib/types";
import { normalizeClientHeroMedia, type ClientHeroMedia } from "@/lib/clientHeroMedia";
import PlacePhotoAttribution, { usePlacePhotoImage } from "@/components/PlacePhotoAttribution";
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
  badges,
  heroMedia,
  onScrollToProfile,
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
  /** Compact status/ranking badges shown above the restaurant name. */
  badges?: ReactNode;
  /** Feed deck can provide in-memory media so preview/active use the same URL. */
  heroMedia?: ClientHeroMedia | null;
  /** Feed-only affordance: scroll the card below the hero. */
  onScrollToProfile?: () => void;
}) {
  const [fetched, setFetched] = useState<ClientHeroMedia | null>(null);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (heroMedia !== undefined) return;
    const controller = new AbortController();
    async function load() {
      let data: unknown = null;
      try {
        const response = await fetch(`/api/restaurants/${encodeURIComponent(restaurantId)}/photo`, { signal: controller.signal });
        if (response.ok) data = await response.json();
      } catch {
        // The existing media ladder handles failed lookups.
      }
      if (!controller.signal.aborted) setFetched(normalizeClientHeroMedia(restaurantId, data));
    }
    void load();
    return () => controller.abort();
  }, [restaurantId, heroMedia]);

  const candidate = heroMedia === undefined ? fetched : heroMedia;
  const media = candidate?.restaurantId === restaurantId ? candidate : null;
  const image = usePlacePhotoImage(media?.photo);
  const photo = image.photo;
  const logoSrc = media?.logoUrl !== failedLogoUrl ? media?.logoUrl : null;
  const isFeed = variant === "feed";

  return (
    <div className={isFeed && feedHeroFullscreen ? "flex h-full min-h-0 flex-col" : undefined}>
      <motion.div
        style={heroStyle}
        className={
          variant === "feed"
            ? feedHeroFullscreen
              ? "relative min-h-0 w-full flex-1 overflow-hidden"
              : "relative aspect-[4/5] w-full overflow-hidden"
            : "relative mx-4 mt-1 aspect-[4/5] overflow-hidden rounded-[28px] ring-1 ring-white/10"
        }
      >
        {isFeed && <FeedHeroBackdrop />}
        {photo ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- Google's Place
                Photo is an ephemeral URL that must be loaded directly from Google
                and never downloaded/rehosted. next/image would proxy it through
                /_next/image (effectively caching/rehosting), which Google's policy
                forbids, so a plain <img> is the correct, legal-safe choice here. */}
            <img
              key={image.key}
              {...image.imageProps}
              src={photo.photoUri}
              alt={`${name} restaurant photo`}
              draggable={isFeed ? false : undefined}
              className="absolute inset-0 h-full w-full object-cover"
              loading={isFeed ? "eager" : "lazy"}
              fetchPriority={isFeed ? "high" : "auto"}
              decoding="async"
            />
          </>
        ) : logoSrc ? (
          <LogoCard
            src={logoSrc}
            name={name}
            eager={isFeed}
            onError={() => setFailedLogoUrl(logoSrc)}
          />
        ) : isFeed ? (
          <FeedHeroFallback label={media ? `${name} image unavailable` : `Loading ${name} photo`} />
        ) : (
          <VideoEmbed video={fallbackVideo} posterEmoji={posterEmoji} fill />
        )}

        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-4 pt-16 ${
            isFeed ? "pb-20" : ""
          }`}
        >
          {badges && <div className="mb-2 flex max-w-full flex-wrap gap-1.5">{badges}</div>}
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

        {isFeed && onScrollToProfile && (
          <button
            type="button"
            onClick={onScrollToProfile}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Scroll for ${name}'s full profile`}
            className="absolute inset-x-0 bottom-4 z-20 mx-auto flex w-fit flex-col items-center gap-1 border-0 bg-transparent px-3 py-1 text-white/85 opacity-70 transition hover:opacity-95 active:scale-95"
          >
            <span className="bounce-subtle flex flex-col items-center gap-1">
              <MaterialIcon name="keyboard_arrow_up" className="text-[22px] text-white/75" />
              <span className="text-[11px] font-bold uppercase tracking-[0.25em]">
                Swipe up for the full profile
              </span>
            </span>
          </button>
        )}
      </motion.div>
      {image.displayed && (
        <div className={isFeed
          ? "max-h-[32%] shrink-0 overflow-y-auto bg-ink-2 px-3"
          : "mx-4 mt-1"}>
          <PlacePhotoAttribution photo={image.displayed} subject={name} />
        </div>
      )}
    </div>
  );
}

function FeedHeroFallback({ label }: { label: string }) {
  return (
    <div className="absolute inset-0" aria-label={label} role="img">
      <FeedHeroBackdrop />
      <div
        className="absolute inset-0 bg-[linear-gradient(110deg,transparent_0%,rgba(255,255,255,0.06)_45%,transparent_70%)] opacity-70"
        aria-hidden
      />
    </div>
  );
}

function FeedHeroBackdrop() {
  return (
    <div
      className="absolute inset-0 bg-[radial-gradient(130%_90%_at_18%_8%,rgba(255,192,130,0.22)_0%,transparent_48%),radial-gradient(100%_80%_at_82%_82%,rgba(214,4,47,0.16)_0%,transparent_48%),linear-gradient(155deg,#181616_0%,#101014_55%,#0a0a0c_100%)]"
      aria-hidden
    />
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
  eager = false,
}: {
  src: string;
  name: string;
  eager?: boolean;
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
            draggable={eager ? false : undefined}
            alt={`${name} logo`}
            className="h-full w-full object-contain"
            loading={eager ? "eager" : "lazy"}
            fetchPriority={eager ? "high" : "auto"}
            decoding="async"
            referrerPolicy="no-referrer"
            onError={onError}
          />
        </div>
      </div>
    </div>
  );
}
