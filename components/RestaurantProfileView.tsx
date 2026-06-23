"use client";

import type { MotionStyle } from "framer-motion";
import type { Restaurant } from "@/lib/types";
import { cuisineEmoji } from "@/lib/emoji";
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
}: {
  restaurant: Restaurant;
  /** Scroll-linked motion style for the hero (in-feed card only). */
  heroStyle?: MotionStyle;
  /** "page" = standalone route; "feed" = full-bleed hero for the scrollable feed card. */
  variant?: "page" | "feed";
}) {
  const poster = cuisineEmoji(r.cuisineTags);
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
      </div>
    </>
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
