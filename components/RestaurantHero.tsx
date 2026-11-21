"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { motion, type MotionStyle } from "framer-motion";
import type { PriceLevel, Video } from "@/lib/types";
import { normalizeClientHeroMedia, type ClientHeroMedia } from "@/lib/clientHeroMedia";
import type { PlacePhoto } from "@/lib/placePhoto";
import { useRestaurantGallery } from "@/lib/useRestaurantGallery";
import { presentedIndex } from "@/lib/galleryState";
import { heroFallbackKind } from "@/lib/heroFallback";
import { addTouch, isTap, moveTap, startTap, type TapTrace } from "@/lib/tapGesture";
import PlacePhotoAttribution, { usePlacePhotoImage } from "@/components/PlacePhotoAttribution";
import { GalleryButtons, GalleryIndicator } from "@/components/PhotoGalleryControls";
import { priceLabel } from "@/lib/options";
import { getMarketShortName } from "@/lib/markets";
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
  market,
  heroStyle,
  variant = "page",
  feedHeroFullscreen = false,
  badges,
  heroMedia,
}: {
  restaurantId: string;
  fallbackVideo: Video;
  posterEmoji: string;
  name: string;
  neighborhood: string;
  distanceMiles: number;
  priceLevel: PriceLevel;
  /** Names the origin the distance is measured from. */
  market?: string;
  /** Optional motion style (opacity/scale) for the scroll-linked fade. Omitted on
   *  the standalone route -> hero is static. */
  heroStyle?: MotionStyle;
  /** "page" = inset rounded hero (standalone route); "feed" = full-bleed hero.
   *  `feedHeroFullscreen` makes the feed hero fill the first card viewport. */
  variant?: "page" | "feed" | "profile";
  /** Feed-only: make the hero occupy the card's first scroll viewport. */
  feedHeroFullscreen?: boolean;
  /** Compact status/ranking badges shown above the restaurant name. */
  badges?: ReactNode;
  /** Feed deck can provide in-memory media so preview/active use the same URL. */
  heroMedia?: ClientHeroMedia | null;
}) {
  const [fetched, setFetched] = useState<ClientHeroMedia | null>(null);
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
  const isFeed = variant === "feed";
  // Profile v2: a bounded, photograph-led frame. The name and facts live in the page, not over the photo.
  const isProfile = variant === "profile";

  // The photo on screen is one of the gallery's photos; the hero is photo 1. Each photo
  // goes through the same load rules as before, and its credit appears only with it.
  const heroPhoto = media?.photo ?? null;
  // More photos are offered only once the hero's own image has really loaded.
  const heroLoadKey = heroPhoto ? `${restaurantId}|${heroPhoto.googleMapsUri}` : null;
  const [heroLoadedKey, setHeroLoadedKey] = useState<string | null>(null);
  const gallery = useRestaurantGallery({
    restaurantId,
    hero: heroPhoto,
    heroDisplayed: heroLoadKey !== null && heroLoadedKey === heroLoadKey,
    galleryCount: media?.galleryCount ?? 0,
  });
  const target = gallery.current ?? heroPhoto;
  // A hero the deck has already fetched and decoded appears with no loading frame; any other photo waits for its image.
  const targetImage = usePlacePhotoImage(target, Boolean(media?.preloaded) && target !== null && target.googleMapsUri === heroPhoto?.googleMapsUri);
  const targetPhoto = targetImage.photo;
  if (heroLoadKey !== null && heroLoadedKey !== heroLoadKey && targetImage.displayed?.googleMapsUri === heroPhoto?.googleMapsUri) {
    setHeroLoadedKey(heroLoadKey);
  }

  // The last photo that actually loaded stays on screen, with its own credit, while the
  // next one loads, so a slow photo never leaves a blank area or a mismatched credit.
  // `reveals` counts the photos shown for this restaurant: only the first (the hero arriving) may fade in.
  const [held, setHeld] = useState<{ restaurantId: string; photo: PlacePhoto; reveals: number } | null>(null);
  if (targetImage.displayed && (held?.restaurantId !== restaurantId || held.photo.googleMapsUri !== targetImage.displayed.googleMapsUri)) {
    setHeld({ restaurantId, photo: targetImage.displayed, reveals: (held?.restaurantId === restaurantId ? held.reveals : 0) + 1 });
  }
  const heldPhoto = held?.restaurantId === restaurantId ? held.photo : null;
  const shownHeld = !targetImage.displayed && heldPhoto && heldPhoto.googleMapsUri !== target?.googleMapsUri ? heldPhoto : null;
  const credited = targetImage.displayed ?? shownHeld;
  // Position, indicator and announcement follow the photo on screen (and its credit), not the requested one.
  const shownIndex = presentedIndex(gallery.photos, credited, gallery.index);
  const announcement = gallery.phase === "ready" && gallery.canStep && credited
    ? `Photo ${shownIndex + 1} of ${gallery.photos.length}`
    : gallery.announcement;

  // A photo that fails to load leaves the gallery instead of leaving a gap.
  if (targetImage.phase === "failed" && target && gallery.phase === "ready") gallery.drop(target.googleMapsUri);

  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const logoSrc = media?.logoUrl !== failedLogoUrl ? media?.logoUrl : null;
  // Until the photograph is on screen a stable neutral surface stays put. A logo or the "unavailable" surface
  // appears only when there is no photograph to wait for (none exists, or it really failed); a photograph that is
  // merely slow never turns into a logo that is replaced a moment later.
  const resolved = media !== null;
  const fallbackKind = heroFallbackKind({
    resolved,
    photoPending: Boolean(targetPhoto),
    displayed: Boolean(targetImage.displayed) || Boolean(shownHeld),
    hasLogo: Boolean(logoSrc),
  });
  const interactive = gallery.canStep || gallery.offerMore;
  const count = gallery.confirmedCount;
  const imageLabel = gallery.canStep
    ? `${name} restaurant photo ${gallery.index + 1} of ${count}`
    : `${name} restaurant photo`;

  // Tap the photograph for the next photo. A press that drifts, lasts, uses a second finger
  // or is taken over by the browser (scroll, pinch) is a different gesture and does nothing.
  const tapRef = useRef<TapTrace | null>(null);
  const pointerHandlers = interactive ? {
    onPointerDown(event: ReactPointerEvent) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (tapRef.current && tapRef.current.pointerId !== event.pointerId) {
        tapRef.current = addTouch(tapRef.current);
        return;
      }
      tapRef.current = startTap(event.pointerId, event.clientX, event.clientY, event.timeStamp);
    },
    onPointerMove(event: ReactPointerEvent) {
      if (tapRef.current) tapRef.current = moveTap(tapRef.current, event.pointerId, event.clientX, event.clientY);
    },
    onPointerUp(event: ReactPointerEvent) {
      const trace = tapRef.current;
      tapRef.current = null;
      if (trace && isTap(trace, event.pointerId, event.clientX, event.clientY, event.timeStamp)) gallery.step(1);
    },
    onPointerCancel() { tapRef.current = null; },
  } : undefined;

  return (
    <div className={isFeed && feedHeroFullscreen ? "flex h-full min-h-0 flex-col" : undefined}>
      <motion.div
        style={heroStyle}
        className={
          variant === "feed"
            ? feedHeroFullscreen
              ? "relative min-h-0 w-full flex-1 overflow-hidden"
              : "relative aspect-[4/5] w-full overflow-hidden"
            : isProfile
              ? "profile-photo relative w-full overflow-hidden"
              : "relative mx-4 mt-1 aspect-[4/5] overflow-hidden rounded-[28px] ring-1 ring-white/10"
        }
      >
        {!isProfile && <FeedHeroBackdrop />}
        {isProfile && fallbackKind !== "none" && (
          <ProfileFallback
            name={name}
            kind={fallbackKind}
            logoSrc={logoSrc}
            onLogoError={() => logoSrc && setFailedLogoUrl(logoSrc)}
          />
        )}
        {isFeed && fallbackKind === "neutral" && <FeedHeroFallback label={`Loading ${name} photo`} />}
        {!isProfile && fallbackKind === "logo" && logoSrc && (
          <LogoCard src={logoSrc} name={name} eager={isFeed} onError={() => setFailedLogoUrl(logoSrc)} />
        )}
        {!isProfile && fallbackKind === "unavailable" && (isFeed
          ? <FeedHeroFallback label={`${name} image unavailable`} />
          : <VideoEmbed video={fallbackVideo} posterEmoji={posterEmoji} fill />)}
        {shownHeld && (
          // eslint-disable-next-line @next/next/no-img-element -- already-loaded Google photo kept on screen (with its own credit) while the next one loads; loaded directly from Google, never rehosted.
          <img
            key={shownHeld.photoUri}
            src={shownHeld.photoUri}
            alt={gallery.canStep ? `${name} restaurant photo ${shownIndex + 1} of ${count}` : `${name} restaurant photo`}
            draggable={isFeed ? false : undefined}
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover"
            decoding="async"
          />
        )}
        {targetPhoto && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- Google's Place
                Photo is an ephemeral URL that must be loaded directly from Google
                and never downloaded/rehosted. next/image would proxy it through
                /_next/image (effectively caching/rehosting), which Google's policy
                forbids, so a plain <img> is the correct, legal-safe choice here. */}
            <img
              key={targetImage.key}
              {...targetImage.imageProps}
              src={targetPhoto.photoUri}
              alt={imageLabel}
              draggable={isFeed ? false : undefined}
              className="gallery-photo absolute inset-0 h-full w-full object-cover"
              data-shown={targetImage.displayed && held?.reveals === 1 ? "" : undefined}
              loading={isFeed ? "eager" : "lazy"}
              fetchPriority={isFeed && gallery.index === 0 ? "high" : "auto"}
              decoding="async"
            />
          </>
        )}

        {/* Tap target for the next photo. It sits under every control and the text. */}
        {interactive && <div className="absolute inset-0" {...pointerHandlers} />}

        {!isProfile && <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 p-4 pt-16 ${
            isFeed ? "swipe-hero-shade" : "bg-gradient-to-t from-black/85 to-transparent"
          }`}
        >
          {badges && <div className="swipe-hero-badges mb-2 flex max-w-full flex-wrap gap-1.5">{badges}</div>}
          {gallery.canStep && <GalleryIndicator count={count} index={shownIndex} />}
          <h1 className={isFeed ? "swipe-hero-title" : "font-display text-3xl font-bold leading-tight text-white drop-shadow"}>
            {name}
          </h1>
          <p className={`mt-1 flex flex-wrap items-center gap-x-2 text-sm ${isFeed ? "swipe-hero-meta" : "text-white/85"}`}>
            {neighborhood.trim() && (
              <>
                <span className="inline-flex items-center gap-1">
                  <MaterialIcon name="location_on" className="text-[15px]" /> {neighborhood}
                </span>
                <span aria-hidden>·</span>
              </>
            )}
            <span>{distanceMiles.toFixed(1)} mi from {market ? `${getMarketShortName(market)} center` : "center"}</span>
            <span aria-hidden>·</span>
            <span className="font-semibold text-saffron">{priceLabel(priceLevel)}</span>
          </p>
        </div>}
        {isProfile && gallery.canStep && (
          <div className="profile-photo-count" aria-hidden>
            <GalleryIndicator count={count} index={shownIndex} />
          </div>
        )}

        <GalleryButtons
          name={name}
          phase={gallery.phase}
          canStep={gallery.canStep}
          offerMore={gallery.offerMore}
          onStep={gallery.step}
        />
      </motion.div>
      {targetPhoto && (
        <div className={isFeed ? "swipe-credit-band" : isProfile ? "profile-credit" : "mx-4 mt-1"} data-pending={credited ? undefined : ""}>
          {credited && <PlacePhotoAttribution photo={credited} subject={name} media={isFeed} light={isProfile} />}
        </div>
      )}
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
    </div>
  );
}

/** The profile's photo frame before a photograph: neutral while it loads, then a logo or "unavailable" only if there is none. */
function ProfileFallback({ name, kind, logoSrc, onLogoError }: {
  name: string;
  kind: "neutral" | "logo" | "unavailable";
  logoSrc: string | null | undefined;
  onLogoError: () => void;
}) {
  return (
    <div className="profile-photo-absent" role="img" aria-label={kind === "unavailable" || kind === "logo" ? `${name} photo unavailable` : `Loading ${name} photo`}>
      {kind === "logo" && logoSrc && (
        <span className="profile-photo-logo">
          {/* eslint-disable-next-line @next/next/no-img-element -- the logo loads directly from Logo.dev and is never rehosted. */}
          <img src={logoSrc} alt="" referrerPolicy="no-referrer" onError={onLogoError} />
        </span>
      )}
      {kind === "unavailable" && <><MaterialIcon name="restaurant" /><span>Photo unavailable</span></>}
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
