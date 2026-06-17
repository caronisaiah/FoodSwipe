import Link from "next/link";
import type { Restaurant } from "@/lib/types";
import { priceLabel } from "@/lib/options";
import { cuisineEmoji } from "@/lib/emoji";
import TagPill from "@/components/TagPill";
import VideoEmbed from "@/components/VideoEmbed";
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

      {/* Hero clip */}
      <div className="relative mx-4 mt-1 aspect-[4/5] overflow-hidden rounded-[28px] ring-1 ring-white/10">
        <VideoEmbed video={r.videos[0]} posterEmoji={poster} fill />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-4 pt-16">
          <h1 className="font-display text-3xl font-bold leading-tight text-white drop-shadow">
            {r.name}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-white/85">
            <span>📍 {r.neighborhood}</span>
            <span aria-hidden>·</span>
            <span>{r.distanceMiles.toFixed(1)} mi away</span>
            <span aria-hidden>·</span>
            <span className="font-semibold text-mint">{priceLabel(r.priceLevel)}</span>
          </p>
        </div>
      </div>

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
