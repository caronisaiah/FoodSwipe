"use client";

import Link from "next/link";
import { useState } from "react";
import type { ScoredRestaurant } from "@/lib/types";
import { priceLabel } from "@/lib/options";
import { cuisineEmoji } from "@/lib/emoji";
import { formatCount } from "@/components/MetricBadge";
import HeroMedia from "@/components/HeroMedia";

interface RestaurantCardProps {
  scored: ScoredRestaurant;
  /** Interactive top card shows the action rail + CTA; peek cards don't. */
  interactive?: boolean;
  /** Save (right-swipe) trigger, wired by the deck on the top card only. */
  onSave?: () => void;
}

/**
 * The swipe card (v1.8): a full-bleed restaurant-identity image with a glassy
 * right-side action rail, a bottom scrim carrying honest signals (name, cuisine,
 * price, food hook, review-clip count, save count), and a saffron "View Profile"
 * CTA. No faked ratings; no video chrome. Gestures live in SwipeDeck; this is the
 * card surface it drives.
 */
export default function RestaurantCard({
  scored,
  interactive = true,
  onSave,
}: RestaurantCardProps) {
  const r = scored.restaurant;
  const poster = cuisineEmoji(r.cuisineTags);
  const trending = r.trendScore >= 75; // honest: derived from the seeded trend score
  const topChoice = r.vibeScore >= 90; // honest: derived from the seeded vibe score
  const clipCount = r.videos.length;
  const hook = r.dishHighlights.slice(0, 3).join(" · ");
  const [copied, setCopied] = useState(false);

  async function shareProfile() {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/restaurants/${r.id}`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: r.name, text: `${r.name} — ${r.neighborhood}, DC`, url });
        return;
      }
    } catch {
      return; // user dismissed the native share sheet
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — nothing else to do
    }
  }

  return (
    <article className="relative h-full w-full overflow-hidden rounded-[28px] bg-ink-2 ring-1 ring-white/10 shadow-2xl shadow-black/60">
      {/* Identity hero: Google Place Photo -> logo -> FoodSwipe placeholder */}
      <HeroMedia key={r.id} restaurantId={r.id} name={r.name} posterEmoji={poster} />

      {/* Top scrim so badges stay legible over bright photos */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-black/55 to-transparent" />

      {/* Trending badge (top-left) */}
      {trending && (
        <span className="absolute left-4 top-4 z-20 inline-flex items-center gap-1 rounded-full bg-[#e31837] px-3 py-1 text-xs font-bold tracking-wide text-white shadow-lg shadow-black/30">
          <span aria-hidden>📈</span> TRENDING IN DC
        </span>
      )}

      {/* Right action rail — interactive top card only */}
      {interactive && (
        <div
          className="absolute right-3 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-3"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <RailButton label="Save" accent onClick={() => onSave?.()}>
            <span aria-hidden>♥</span>
          </RailButton>
          <RailButton label={copied ? "Link copied" : "Share"} onClick={shareProfile}>
            <span aria-hidden>{copied ? "✓" : "↗"}</span>
          </RailButton>
          <Link
            href={`/restaurants/${r.id}`}
            aria-label="More info"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-xl text-white ring-1 ring-white/20 backdrop-blur-md transition hover:bg-white/20 active:scale-90"
          >
            <span aria-hidden>ⓘ</span>
          </Link>
        </div>
      )}

      {/* Bottom scrim */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-2/3 bg-gradient-to-t from-black/92 via-black/55 to-transparent" />

      {/* Bottom info */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2.5 p-5">
        {topChoice && (
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-xs font-semibold text-[#f0c84f] ring-1 ring-[#f0c84f]/30 backdrop-blur-md">
            <span aria-hidden>★</span> Top Choice
          </span>
        )}

        <h2 className="font-display text-3xl font-extrabold leading-tight text-white drop-shadow-lg">
          {r.name}
        </h2>

        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-white/85">
          <span>📍 {r.neighborhood}</span>
          <span aria-hidden className="text-white/40">·</span>
          <span className="capitalize">{r.cuisineTags[0]}</span>
          <span aria-hidden className="text-white/40">·</span>
          <span className="font-semibold text-[#ffb86f]">{priceLabel(r.priceLevel)}</span>
          <span aria-hidden className="text-white/40">·</span>
          <span>{r.distanceMiles.toFixed(1)} mi</span>
        </p>

        {hook && (
          <p className="truncate text-sm text-white/75">
            <span className="text-[#ffb86f]">🍴 </span>
            {hook}
          </p>
        )}

        {/* Honest signal chips — NO fake star rating */}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Chip>
            ▶ {clipCount} review {clipCount === 1 ? "clip" : "clips"}
          </Chip>
          <Chip>♥ {formatCount(r.saveCount)} saved</Chip>
        </div>

        {/* View Profile CTA */}
        {interactive && (
          <Link
            href={`/restaurants/${r.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            className="mt-1 flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#ff9900] to-[#e31837] py-3.5 text-center text-base font-bold text-[#241200] shadow-lg shadow-[#ff9900]/25 transition active:scale-[0.98]"
          >
            <span aria-hidden>🍴</span> View Profile
          </Link>
        )}
      </div>
    </article>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white/90 ring-1 ring-white/15 backdrop-blur-md">
      {children}
    </span>
  );
}

function RailButton({
  children,
  label,
  onClick,
  accent = false,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex h-12 w-12 items-center justify-center rounded-full text-xl backdrop-blur-md ring-1 transition active:scale-90 ${
        accent
          ? "bg-[#ff9900]/20 text-[#ff9900] ring-[#ff9900]/40 hover:bg-[#ff9900]/30"
          : "bg-white/10 text-white ring-white/20 hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  );
}
