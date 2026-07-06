import type { ScoredRestaurant } from "@/lib/types";
import type { ClientHeroMedia } from "@/lib/clientHeroMedia";
import { priceLabel } from "@/lib/options";
import { cuisineIcon } from "@/lib/emoji";
import { getMarketShortName } from "@/lib/markets";
import HeroMedia from "@/components/HeroMedia";
import MaterialIcon from "@/components/MaterialIcon";

/**
 * Lightweight peek preview shown behind the active feed card. Identity only —
 * hero (Place Photo -> logo -> neutral fallback) + name/neighborhood/cuisine/price
 * and compact status badges. Deliberately does NOT render the profile body or
 * review videos, so background cards never trigger video fetches. The active card
 * lives inside SwipeDeck's nested SwipeCard; this component is only the next-card
 * preview behind it.
 */
export default function RestaurantCard({
  scored,
  heroMedia,
}: {
  scored: ScoredRestaurant;
  heroMedia?: ClientHeroMedia | null;
}) {
  const r = scored.restaurant;
  const poster = cuisineIcon(r.cuisineTags);
  const trending = r.trendScore >= 75;
  const topChoice = r.vibeScore >= 90;

  return (
    <article className="absolute inset-0 overflow-hidden rounded-[28px] bg-ink-2 ring-1 ring-white/10">
      {/* Identity hero: Google Place Photo -> logo -> FoodSwipe placeholder */}
      <HeroMedia
        restaurantId={r.id}
        name={r.name}
        posterIcon={poster}
        fallbackMode="neutral"
        eager
        heroMedia={heroMedia}
      />

      {/* Scrims for legibility */}
      <div className="crave-gradient pointer-events-none absolute inset-0 z-10" />

      <div className="absolute inset-x-0 bottom-6 z-20 px-4">
        {(trending || topChoice) && (
          <div className="mb-2 flex max-w-full flex-wrap gap-1.5">
            {trending && (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-chili/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-cream shadow-lg backdrop-blur-md ring-1 ring-white/15">
                <MaterialIcon name="trending_up" className="text-[14px]" />
                <span className="truncate">Trending in {getMarketShortName(r.market)}</span>
              </span>
            )}
            {topChoice && (
              <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-bold uppercase text-saffron shadow-lg backdrop-blur-md ring-1 ring-white/15">
                <MaterialIcon name="stars" filled className="text-[14px]" />
                <span className="truncate">Top choice</span>
              </span>
            )}
          </div>
        )}
        <h2 className="font-display text-[40px] font-black leading-none tracking-tight text-white drop-shadow-lg">
          {r.name}
        </h2>
        <p className="mt-1.5 text-lg text-tan">
          {r.neighborhood}
          {r.cuisineTags[0] && (
            <>
              {" • "}
              <span className="capitalize">{r.cuisineTags[0]}</span>
            </>
          )}
          {" • "}
          <span className="font-semibold text-saffron">{priceLabel(r.priceLevel)}</span>
        </p>
      </div>
    </article>
  );
}
