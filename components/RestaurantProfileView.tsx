"use client";

import type { Ref } from "react";
import type { MotionStyle } from "framer-motion";
import type { Restaurant } from "@/lib/types";
import type { ClientHeroMedia } from "@/lib/clientHeroMedia";
import { cuisineEmoji } from "@/lib/emoji";
import { getMarketShortName } from "@/lib/markets";
import { priceLabel } from "@/lib/options";
import TagPill from "@/components/TagPill";
import RestaurantHero from "@/components/RestaurantHero";
import { firstReviewHref, useRestaurantProfileVideos } from "@/components/RestaurantVideos";
import CreatorReviews from "@/components/CreatorReviews";
import GoThere from "@/components/GoThere";
import MaterialIcon from "@/components/MaterialIcon";
import {
  captureFoodSwipeEvent,
  restaurantAnalyticsContext,
} from "@/lib/analytics";
import { useVisibleOnce } from "@/lib/useVisibleOnce";

/**
 * Reusable restaurant profile: hero plus the D3 polished module stack. Shared by
 * the standalone detail page and the in-feed scrollable card.
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
  const profileVideos = useRestaurantProfileVideos({
    restaurantId: r.id,
    seedVideos: r.videos,
  });
  const reviewHref = firstReviewHref(profileVideos.videos.map((item) => item.video));
  const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${r.name} ${r.address}`,
  )}`;
  const primaryCuisine = r.cuisineTags[0];
  const topTags = [
    ...r.cuisineTags.map((tag) => ({ tag, variant: "cuisine" as const })),
    ...r.vibeTags.map((tag) => ({ tag, variant: "vibe" as const })),
    ...r.dietaryTags.map((tag) => ({ tag, variant: "dietary" as const })),
    ...r.bestFor
      .filter((tag) => !r.vibeTags.includes(tag))
      .map((tag) => ({ tag, variant: "vibe" as const })),
  ];
  const hasReason = r.reasonText.trim().length > 0;
  const analyticsContext = restaurantAnalyticsContext(
    r,
    isFeed ? "feed" : "standalone_profile",
  );
  const profileEngagedRef = useVisibleOnce<HTMLElement>(() => {
    captureFoodSwipeEvent("profile_engaged", analyticsContext);
  });
  const whyLikeRef = useVisibleOnce<HTMLElement>(() => {
    captureFoodSwipeEvent("profile_depth_reached", {
      ...analyticsContext,
      milestone: "why_like",
    });
  });
  const whatToOrderRef = useVisibleOnce<HTMLElement>(() => {
    captureFoodSwipeEvent("profile_depth_reached", {
      ...analyticsContext,
      milestone: "what_to_order",
    });
  });
  const goThereRef = useVisibleOnce<HTMLElement>(() => {
    captureFoodSwipeEvent("profile_depth_reached", {
      ...analyticsContext,
      milestone: "go_there",
    });
  });
  const hero = (
    <RestaurantHero
      restaurantId={r.id}
      fallbackVideo={r.videos[0]}
      posterEmoji={poster}
      name={r.name}
      neighborhood={r.neighborhood}
      distanceMiles={r.distanceMiles}
      priceLevel={r.priceLevel}
      market={r.market}
      heroStyle={heroStyle}
      variant={variant}
      feedHeroFullscreen={feedHeroFullscreen}
      badges={isFeed ? <HeroStatusBadges restaurant={r} /> : null}
      heroMedia={heroMedia}
    />
  );

  return (
    <>
      {isFeed ? (
        <section
          aria-label={`${r.name} hero`}
          className="swipe-hero-section h-full min-h-full w-full flex-none overflow-hidden"
        >
          {hero}
        </section>
      ) : (
        hero
      )}

      <div className={`profile-body bg-ink-2 px-4 pt-[26px] ${isFeed ? "swipe-profile-body" : "pb-7"}`}>
        <header ref={profileEngagedRef} className="mb-4">
          <h2 className="font-display text-[26px] font-black leading-[1.05] tracking-normal text-cream">
            {r.name}
          </h2>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-tan">
            {r.neighborhood.trim() && (
              <>
                <span>{r.neighborhood}</span>
                <span aria-hidden>·</span>
              </>
            )}
            {primaryCuisine && (
              <>
                <span className="capitalize">{primaryCuisine}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <span className="font-semibold text-saffron">{priceLabel(r.priceLevel)}</span>
          </p>
        </header>

        {topTags.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-1.5">
            {topTags.map(({ tag, variant: tagVariant }) => (
              <TagPill key={`${tagVariant}-${tag}`} variant={tagVariant}>
                {tag}
              </TagPill>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {profileVideos.videos.length > 0 && (
            <section aria-labelledby="swipe-reviews-title">
              <h3 id="swipe-reviews-title">Creator reviews</h3>
              <CreatorReviews items={profileVideos.videos} analytics={analyticsContext} tone="dark" />
            </section>
          )}

          {hasReason && (
            <ProfileModule title="Why you'll like it" analyticsRef={whyLikeRef}>
              <p className="text-[15px] leading-[1.6] text-tan">{r.reasonText}</p>
            </ProfileModule>
          )}

          {r.dishHighlights.length > 0 && (
            <ProfileModule title="What to order" analyticsRef={whatToOrderRef}>
              <ul className="grid gap-2">
                {r.dishHighlights.map((dish) => (
                  <li
                    key={dish}
                    className="flex items-center gap-2.5 rounded-xl bg-black/30 px-3.5 py-3 text-[15px] text-cream ring-1 ring-inset ring-white/5"
                  >
                    <MaterialIcon name="restaurant_menu" className="text-[18px] text-saffron" />
                    <span>{dish}</span>
                  </li>
                ))}
              </ul>
            </ProfileModule>
          )}

          {r.bestFor.length > 0 && (
            <ProfileModule title="Best for">
              <div className="flex flex-wrap gap-1.5">
                {r.bestFor.map((b) => (
                  <TagPill key={b} variant="vibe">
                    {b}
                  </TagPill>
                ))}
              </div>
            </ProfileModule>
          )}

          <GoThere
            directionsUrl={directionsUrl}
            websiteDomain={r.websiteDomain}
            reviewsHref={reviewHref}
            analyticsContext={analyticsContext}
            sectionRef={goThereRef}
          />

        </div>
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

function ProfileModule({
  title,
  children,
  analyticsRef,
}: {
  title: string;
  children: React.ReactNode;
  analyticsRef?: Ref<HTMLElement>;
}) {
  return (
    <section
      ref={analyticsRef}
      className="profile-module rounded-[24px] bg-surface px-4 py-[18px] pb-5 ring-1 ring-inset ring-white/5"
    >
      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.25em] text-haze">
        {title}
      </h3>
      {children}
    </section>
  );
}
