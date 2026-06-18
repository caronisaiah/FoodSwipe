import Link from "next/link";
import type { Restaurant } from "@/lib/types";
import { cuisineEmoji } from "@/lib/emoji";
import TagPill from "@/components/TagPill";
import RestaurantHero from "@/components/RestaurantHero";
import RestaurantVideos from "@/components/RestaurantVideos";
import GoThere from "@/components/GoThere";
import MetricBadge, { formatCount } from "@/components/MetricBadge";
import SaveButton from "@/components/SaveButton";

/**
 * Restaurant profile — styled like a "creator profile" for the restaurant:
 * a hero clip, the hype metrics, dish highlights, what it's best for, and the
 * stack of source videos (each properly attributed, never rehosted).
 */
export default function RestaurantProfile({ restaurant: r }: { restaurant: Restaurant }) {
  const poster = cuisineEmoji(r.cuisineTags);
  // Distinct emojis from the cuisine tags so carousel clips don't all look alike.
  const clipPosters = [...new Set(r.cuisineTags.map((t) => cuisineEmoji([t])))];
  const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${r.name} ${r.address}`,
  )}`;

  return (
    <div className="no-scrollbar flex-1 overflow-y-auto pb-10">
      {/* Top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-ink/70 px-4 py-3 backdrop-blur-lg">
        <Link
          href="/feed"
          aria-label="Back to feed"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg text-cream ring-1 ring-inset ring-white/15 transition hover:bg-white/20"
        >
          ←
        </Link>
        <SaveButton restaurantId={r.id} />
      </div>

      {/* Hero — real Google Place Photo when available, else the placeholder/video.
          A Place Photo replaces the video as the hero, which also removes the old
          "videos[0] shown as both hero and first review clip" duplication. */}
      <RestaurantHero
        restaurantId={r.id}
        fallbackVideo={r.videos[0]}
        posterEmoji={poster}
        name={r.name}
        neighborhood={r.neighborhood}
        distanceMiles={r.distanceMiles}
        priceLevel={r.priceLevel}
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

        {/* The hype (social proof) */}
        <Section title="The hype">
          <div className="grid grid-cols-3 gap-2">
            <MetricBadge icon="🎬" value={formatCount(r.videoCount)} label="videos" />
            <MetricBadge icon="🆕" value={r.recentVideoCount} label="recent" />
            <MetricBadge
              icon="🔥"
              value={r.trendScore}
              label="trend"
              accentClassName="text-coral"
            />
            <MetricBadge
              icon="✨"
              value={r.vibeScore}
              label="vibe"
              accentClassName="text-pink"
            />
            <MetricBadge
              icon="❤️"
              value={formatCount(r.saveCount)}
              label="saves"
              accentClassName="text-mint"
            />
          </div>
          <p className="mt-3 text-sm leading-relaxed text-haze">{r.reasonText}</p>
        </Section>

        {/* Dish highlights */}
        <Section title="What to order">
          <ul className="grid gap-2">
            {r.dishHighlights.map((dish) => (
              <li
                key={dish}
                className="flex items-center gap-2 rounded-2xl bg-surface px-3.5 py-2.5 text-sm text-cream ring-1 ring-inset ring-white/5"
              >
                <span aria-hidden>🍴</span>
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
    </div>
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
