import type { ScoredRestaurant } from "@/lib/types";
import { priceLabel } from "@/lib/options";
import { cuisineIcon } from "@/lib/emoji";
import { getMarketShortName } from "@/lib/markets";
import HeroMedia from "@/components/HeroMedia";
import MaterialIcon from "@/components/MaterialIcon";

/**
 * Lightweight peek preview shown behind the active feed card. Identity only —
 * hero (Place Photo -> logo -> placeholder) + name/neighborhood/cuisine/price and
 * an optional Trending badge. Deliberately does NOT render the profile body or
 * review videos, so background cards never trigger video fetches. The active card
 * is the scrollable profile (see SwipeDeck → RestaurantProfileView).
 */
export default function RestaurantCard({ scored }: { scored: ScoredRestaurant }) {
  const r = scored.restaurant;
  const poster = cuisineIcon(r.cuisineTags);
  const trending = r.trendScore >= 75;

  return (
    <article className="absolute inset-0 overflow-hidden rounded-[28px] bg-ink-2 ring-1 ring-white/10">
      {/* Identity hero: Google Place Photo -> logo -> FoodSwipe placeholder */}
      <HeroMedia restaurantId={r.id} name={r.name} posterIcon={poster} />

      {/* Scrims for legibility */}
      <div className="crave-gradient pointer-events-none absolute inset-0 z-10" />

      {trending && (
        <span className="absolute left-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-chili/90 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-cream shadow-lg backdrop-blur-md">
          <MaterialIcon name="trending_up" className="text-[16px]" /> Trending in {getMarketShortName(r.market)}
        </span>
      )}

      <div className="absolute inset-x-0 bottom-6 z-20 px-4">
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
