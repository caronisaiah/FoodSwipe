"use client";

import { useEffect, useState } from "react";
import type { PlacePhoto } from "@/lib/types";
import type { ClientHeroMedia } from "@/lib/clientHeroMedia";
import MaterialIcon from "@/components/MaterialIcon";

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
  posterIcon,
  compact = false,
  fallbackMode = "icon",
  eager = false,
  heroMedia,
}: {
  restaurantId: string;
  name: string;
  /** Material Symbols icon name shown on the placeholder (see lib/emoji cuisineIcon). */
  posterIcon: string;
  /** Smaller logo tile + placeholder glyph, for thumbnail-sized uses (e.g. Saved). */
  compact?: boolean;
  /** Feed cards use a calm neutral fallback so real-photo loads never flash an icon. */
  fallbackMode?: "icon" | "neutral";
  /** Hint the browser to start loading visible/next-card imagery promptly. */
  eager?: boolean;
  /** Feed deck can provide in-memory media so preview/active use the same URL. */
  heroMedia?: ClientHeroMedia | null;
}) {
  const [fetchedPhoto, setFetchedPhoto] = useState<PlacePhoto | null>(null);
  const [fetchedLogoSrc, setFetchedLogoSrc] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string | null>(null);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (heroMedia !== undefined) return;
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
          setFetchedPhoto(nextPhoto);
          setFetchedLogoSrc(nextLogo);
          setResolved(true);
        }
      } catch {
        if (!cancelled) {
          setFetchedPhoto(null);
          setFetchedLogoSrc(null);
          setResolved(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, heroMedia]);

  const controlledMedia =
    heroMedia !== undefined && heroMedia?.restaurantId === restaurantId ? heroMedia : null;
  const rawPhoto = heroMedia !== undefined ? controlledMedia?.photo ?? null : fetchedPhoto;
  const rawLogoSrc =
    heroMedia !== undefined ? controlledMedia?.logoUrl ?? null : fetchedLogoSrc;
  const mediaResolved = heroMedia !== undefined ? controlledMedia !== null : resolved;
  const photo = rawPhoto?.photoUri === failedPhotoUrl ? null : rawPhoto;
  const logoSrc = rawLogoSrc && rawLogoSrc !== failedLogoUrl ? rawLogoSrc : null;

  // Tier 1 — Google Place Photo.
  if (photo) {
    return (
      <>
        {fallbackMode === "neutral" && <NeutralMediaBackdrop />}
        {/* eslint-disable-next-line @next/next/no-img-element -- Google's ephemeral
            Place Photo URL must load directly from Google (never downloaded/rehosted);
            next/image would proxy it through /_next/image, which the policy forbids. */}
        <img
          src={photo.photoUri}
          alt={`${name} — photo via Google`}
          className="absolute inset-0 h-full w-full object-cover"
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedPhotoUrl(photo.photoUri)}
        />
        <PhotoAttribution attributions={photo.attributions} />
      </>
    );
  }

  // Tier 2 — brand logo on a clean centered card.
  if (mediaResolved && logoSrc) {
    return (
      <div className="absolute inset-0">
        <div
          className="absolute inset-0 bg-gradient-to-b from-[#1a160f] to-[#0b0b0d]"
          aria-hidden
        />
        <div className={`absolute inset-0 flex items-center justify-center ${compact ? "p-2.5" : "p-10"}`}>
          <div
            className={`flex aspect-square items-center justify-center bg-white shadow-2xl shadow-black/40 ring-1 ring-white/10 ${
              compact ? "w-4/5 rounded-xl p-2" : "w-1/2 max-w-[180px] rounded-3xl p-6"
            }`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the logo loads
                directly from Logo.dev's CDN; never downloaded/cropped/rehosted, so a
                plain object-contain <img> is the correct, policy-safe choice here. */}
            <img
              src={logoSrc}
              alt={`${name} logo`}
              className="h-full w-full object-contain"
              loading={eager ? "eager" : "lazy"}
              fetchPriority={eager ? "high" : "auto"}
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setFailedLogoUrl(logoSrc)}
            />
          </div>
        </div>
      </div>
    );
  }

  // Tier 3 — FoodSwipe placeholder. Warm, food-toned, clearly NOT near-black, so a
  // card is always content-rich even with no Google/Logo.dev keys. Also the loading
  // state, so the card never flashes black.
  return (
    <div className="absolute inset-0">
      <div
        className="absolute inset-0 bg-[radial-gradient(120%_80%_at_30%_18%,#6b431a_0%,transparent_55%),radial-gradient(110%_90%_at_82%_88%,#5a1633_0%,transparent_55%),linear-gradient(160deg,#2a2012_0%,#1a1622_55%,#0e0e12_100%)]"
        aria-hidden
      />
      {fallbackMode === "icon" ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <MaterialIcon
            name={posterIcon}
            className={`text-white/30 drop-shadow-[0_10px_30px_rgba(0,0,0,0.55)] ${
              compact ? "text-[40px]" : "text-[128px]"
            }`}
          />
        </div>
      ) : (
        <div
          className="absolute inset-0 bg-[linear-gradient(110deg,transparent_0%,rgba(255,255,255,0.05)_45%,transparent_70%)] opacity-70"
          aria-hidden
        />
      )}
    </div>
  );
}

function NeutralMediaBackdrop() {
  return (
    <div
      className="absolute inset-0 bg-[radial-gradient(120%_80%_at_22%_12%,rgba(255,192,130,0.2)_0%,transparent_52%),radial-gradient(105%_85%_at_82%_86%,rgba(214,4,47,0.14)_0%,transparent_50%),linear-gradient(155deg,#171515_0%,#101014_58%,#0b0b0d_100%)]"
      aria-hidden
    />
  );
}

/**
 * Required Google Place Photo attribution (shown wherever the photo appears).
 * Kept compact for small preview cards; omitted when Google returns no author.
 */
function PhotoAttribution({
  attributions,
}: {
  attributions: PlacePhoto["attributions"];
}) {
  const items = attributions.filter((a) => a.displayName.trim().length > 0);
  if (items.length === 0) return null;

  return (
    <span className="absolute right-3 top-3 z-20 inline-flex max-w-[60%] items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-md ring-1 ring-white/15">
      <MaterialIcon name="photo_camera" className="text-[13px]" />
      <span className="truncate">
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
      </span>
    </span>
  );
}
