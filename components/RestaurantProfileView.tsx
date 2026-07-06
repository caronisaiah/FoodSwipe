"use client";

import { useCallback, useState } from "react";
import type { MotionStyle } from "framer-motion";
import type { PlacePhoto, Restaurant } from "@/lib/types";
import type { ClientHeroMedia } from "@/lib/clientHeroMedia";
import { cuisineEmoji } from "@/lib/emoji";
import { getMarketShortName } from "@/lib/markets";
import TagPill from "@/components/TagPill";
import RestaurantHero from "@/components/RestaurantHero";
import RestaurantVideos from "@/components/RestaurantVideos";
import GoThere from "@/components/GoThere";
import MetricBadge, { formatCount } from "@/components/MetricBadge";
import MaterialIcon from "@/components/MaterialIcon";

/**
 * Reusable restaurant-profile body (hero + tags + hype + dishes + best-for +
 * review videos + go-there). Fully client-renderable from a `Restaurant`, so it
 * is shared by BOTH the standalone `/restaurants/[id]` page (via
 * `RestaurantProfile`) and the in-feed scrollable feed card (`SwipeDeck`). Each
 * caller supplies its own chrome (page top bar vs feed-card actions); this is just
 * the content. Pass `variant="feed"` for the full-bleed hero on the feed card.
 */
export default function RestaurantProfileView({
  restaurant: r,
  heroStyle,
  variant = "page",
  feedHeroFullscreen = false,
  heroMedia,
}: {
  restaurant: Restaurant;
  /** Scroll-linked motion style for the hero (in-feed card only). */
  heroStyle?: MotionStyle;
  /** "page" = standalone route; "feed" = full-bleed hero for the scrollable feed card. */
  variant?: "page" | "feed";
  /** Feed-only: hero fills the first card viewport before profile content begins. */
  feedHeroFullscreen?: boolean;
  /** Feed deck can provide in-memory media so preview/active use the same URL. */
  heroMedia?: ClientHeroMedia | null;
}) {
  const isFeed = variant === "feed";
  const poster = cuisineEmoji(r.cuisineTags);
  const [photoAttributions, setPhotoAttributions] = useState<PlacePhoto["attributions"]>([]);
  const updatePhotoAttributions = useCallback(
    (items: PlacePhoto["attributions"]) => setPhotoAttributions(items),
    [],
  );
  // Distinct emojis from the cuisine tags so carousel clips don't all look alike.
  const clipPosters = [...new Set(r.cuisineTags.map((t) => cuisineEmoji([t])))];
  // DB-published restaurants carry neutral-zero metrics (no fabricated social
  // proof) — only show the "hype" numbers when there's real data behind them.
  const hasHype =
    r.videoCount > 0 || r.saveCount > 0 || r.trendScore > 0 || r.vibeScore > 0;
  const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${r.name} ${r.address}`,
  )}`;

  return (
    <>
      {/* Hero — real Google Place Photo when available, else logo card, else placeholder */}
      <RestaurantHero
        restaurantId={r.id}
        fallbackVideo={r.videos[0]}
        posterEmoji={poster}
        name={r.name}
        neighborhood={r.neighborhood}
        distanceMiles={r.distanceMiles}
        priceLevel={r.priceLevel}
        heroStyle={heroStyle}
        variant={variant}
        feedHeroFullscreen={feedHeroFullscreen}
        badges={isFeed ? <HeroStatusBadges restaurant={r} /> : null}
        onPhotoAttributions={isFeed ? updatePhotoAttributions : undefined}
        heroMedia={heroMedia}
      />

      <div className="space-y-7 px-4 pt-6">
        {/* Tags */}
        <div className="flex flex-wrap gap-1.5">
          {r.cuisineTags.map((t) => (
            <TagPill key={t} variant="cuisine">
              {t}
            </TagPill>
          ))}
          {r.vibeTags.map((t) => (
            <TagPill key={t} variant="vibe">
              {t}
            </TagPill>
          ))}
          {r.dietaryTags.map((t) => (
            <TagPill key={t} variant="dietary">
              {t}
            </TagPill>
          ))}
        </div>

        {/* The hype (social proof) — only when there's real data; DB-published
            restaurants have neutral-zero metrics and show just the reason. */}
        <Section title={hasHype ? "The hype" : "Why you'll like it"}>
          {hasHype && (
            <div className="grid grid-cols-3 gap-2">
              <MetricBadge icon="🎬" value={formatCount(r.videoCount)} label="videos" />
              <MetricBadge icon="🆕" value={r.recentVideoCount} label="recent" />
              <MetricBadge
                icon="🔥"
                value={r.trendScore}
                label="trend"
                accentClassName="text-saffron"
              />
              <MetricBadge
                icon="✨"
                value={r.vibeScore}
                label="vibe"
                accentClassName="text-saffron-soft"
              />
              <MetricBadge
                icon="❤️"
                value={formatCount(r.saveCount)}
                label="saves"
                accentClassName="text-chili-soft"
              />
            </div>
          )}
          <p className={`${hasHype ? "mt-3 " : ""}text-sm leading-relaxed text-haze`}>
            {r.reasonText}
          </p>
        </Section>

        {/* Dish highlights */}
        <Section title="What to order">
          <ul className="grid gap-2">
            {r.dishHighlights.map((dish) => (
              <li
                key={dish}
                className="flex items-center gap-2 rounded-2xl bg-surface px-3.5 py-2.5 text-sm text-cream ring-1 ring-inset ring-white/5"
              >
                <MaterialIcon name="restaurant_menu" className="text-[18px] text-saffron" />
                {dish}
              </li>
            ))}
          </ul>
        </Section>

        {/* Best for */}
        <Section title="Best for">
          <div className="flex flex-wrap gap-1.5">
            {r.bestFor.map((b) => (
              <TagPill key={b} variant="vibe">
                {b}
              </TagPill>
            ))}
          </div>
        </Section>

        {/* Source videos (client — merges seed + manually-added demo clips) */}
        <RestaurantVideos
          restaurantId={r.id}
          seedVideos={r.videos}
          posters={clipPosters}
        />

        {/* External links — client so "Reviews" reflects merged seed + manual */}
        <GoThere
          restaurantId={r.id}
          seedVideos={r.videos}
          directionsUrl={directionsUrl}
        />

        {isFeed && <PhotoCreditRow attributions={photoAttributions} />}
      </div>
    </>
  );
}

function HeroStatusBadges({ restaurant: r }: { restaurant: Restaurant }) {
  const badges: { key: string; icon: string; label: string; tone: "hot" | "soft" }[] = [];
  if (r.trendScore >= 75) {
    badges.push({
      key: "trending",
      icon: "trending_up",
      label: `Trending in ${getMarketShortName(r.market)}`,
      tone: "hot",
    });
  }
  if (r.vibeScore >= 90) {
    badges.push({ key: "top-choice", icon: "stars", label: "Top choice", tone: "soft" });
  }
  if (badges.length === 0) return null;

  return (
    <>
      {badges.map((badge) => (
        <span
          key={badge.key}
          className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase text-cream shadow-lg backdrop-blur-md ring-1 ring-white/15 ${
            badge.tone === "hot"
              ? "bg-chili/85 tracking-wider"
              : "bg-black/45 text-saffron"
          }`}
        >
          <MaterialIcon name={badge.icon} filled={badge.key === "top-choice"} className="text-[14px]" />
          <span className="truncate">{badge.label}</span>
        </span>
      ))}
    </>
  );
}

function PhotoCreditRow({ attributions }: { attributions: PlacePhoto["attributions"] }) {
  const items = attributions.filter((a) => a.displayName.trim().length > 0);
  if (items.length === 0) return null;

  return (
    <p className="border-t border-white/10 pt-3 text-[11px] leading-relaxed text-haze">
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
              className="underline decoration-haze/40 underline-offset-2 hover:text-tan hover:decoration-tan"
            >
              {a.displayName}
            </a>
          ) : (
            a.displayName
          )}
        </span>
      ))}{" "}
      via Google
    </p>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5">
        <h2 className="font-display text-lg font-semibold text-cream">{title}</h2>
        {hint && <p className="text-xs text-haze">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
