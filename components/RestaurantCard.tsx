import Link from "next/link";
import type { ScoredRestaurant } from "@/lib/types";
import { priceLabel } from "@/lib/options";
import { cuisineEmoji } from "@/lib/emoji";
import { formatCount } from "@/components/MetricBadge";
import TagPill from "@/components/TagPill";
import VideoEmbed from "@/components/VideoEmbed";

interface RestaurantCardProps {
  scored: ScoredRestaurant;
  /** Hide the profile link (e.g. when the card sits behind the top one). */
  interactive?: boolean;
}

/**
 * The swipe card. Visual hierarchy: immersive video up top, a content sheet
 * below where the restaurant's "personality" reads at a glance. Purely
 * presentational — gestures + skip/save live in SwipeDeck.
 */
export default function RestaurantCard({
  scored,
  interactive = true,
}: RestaurantCardProps) {
  const r = scored.restaurant;
  const poster = cuisineEmoji(r.cuisineTags);
  const trending = r.trendScore >= 75;
  const reasons = scored.matchReasons.slice(0, 3);

  return (
    <article className="flex h-full w-full flex-col overflow-hidden rounded-[28px] bg-ink-2 ring-1 ring-white/10 shadow-2xl shadow-black/60">
      {/* --- Video (immersive, the emotional center of the card) --- */}
      {/* Slightly shorter on small phones so the content sheet never clips. */}
      <div className="relative basis-[50%] shrink-0 sm:basis-[56%]">
        <VideoEmbed video={r.videos[0]} posterEmoji={poster} fill />
        {/* freshness / trend indicator (top-right, mirrors the platform badge) */}
        <span
          className={`absolute right-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-white/15 backdrop-blur-md ${
            trending ? "bg-coral text-ink" : "bg-black/55 text-white"
          }`}
        >
          {trending ? (
            <>🔥 Trending this week</>
          ) : (
            <>🎬 {r.recentVideoCount} recent videos</>
          )}
        </span>
      </div>

      {/* --- Content sheet --- */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
        {/* name + meta */}
        <div>
          <h2 className="line-clamp-2 font-display text-2xl font-bold leading-tight text-cream">
            {r.name}
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-haze">
            <span>📍 {r.neighborhood}</span>
            <span aria-hidden>·</span>
            <span>{r.distanceMiles.toFixed(1)} mi</span>
            <span aria-hidden>·</span>
            <span className="font-semibold text-mint">{priceLabel(r.priceLevel)}</span>
          </p>
        </div>

        {/* tags — kept to a few meaningful ones, not a wall of pills */}
        <div className="flex flex-wrap gap-1.5">
          {r.cuisineTags.slice(0, 2).map((t) => (
            <TagPill key={t} variant="cuisine">
              {t}
            </TagPill>
          ))}
          {r.vibeTags.slice(0, 1).map((t) => (
            <TagPill key={t} variant="vibe">
              {t}
            </TagPill>
          ))}
          {r.dietaryTags.slice(0, 1).map((t) => (
            <TagPill key={t} variant="dietary">
              {t}
            </TagPill>
          ))}
        </div>

        {/* dish highlights */}
        <p className="truncate text-sm text-cream/90">
          <span className="text-haze">🍴 Try: </span>
          {r.dishHighlights.slice(0, 3).join(" · ")}
        </p>

        {/* why this matches you */}
        <div className="rounded-2xl bg-surface/70 p-3 ring-1 ring-inset ring-white/5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-coral">
            Why this matches you
          </p>
          {reasons.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {reasons.map((reason) => (
                <span
                  key={reason}
                  className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-cream/90"
                >
                  {reason}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 line-clamp-2 text-sm text-cream/85">{r.reasonText}</p>
          )}
        </div>

        {/* footer: social proof + profile link */}
        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="text-xs text-haze">
            ❤️ {formatCount(r.saveCount)} saves · 🎬 {formatCount(r.videoCount)} videos
          </span>
          {interactive && (
            <Link
              href={`/restaurants/${r.id}`}
              className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 transition hover:bg-white/20"
            >
              View profile →
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
