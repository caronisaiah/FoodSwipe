"use client";

import Link from "next/link";
import { useState } from "react";
import type { ScoredRestaurant } from "@/lib/types";
import { priceLabel } from "@/lib/options";
import { cuisineIcon } from "@/lib/emoji";
import { formatCount } from "@/components/MetricBadge";
import HeroMedia from "@/components/HeroMedia";
import MaterialIcon from "@/components/MaterialIcon";

interface RestaurantCardProps {
  scored: ScoredRestaurant;
  /** Interactive top card shows the action rail + affordance; peek cards don't. */
  interactive?: boolean;
  /** Save (right-swipe) trigger, wired by the deck on the top card only. */
  onSave?: () => void;
}

/**
 * The swipe card (v1.8) — an edge-to-edge TikTok-style discovery canvas matching
 * the Stitch design: full-bleed restaurant-identity hero, crave scrim, top-left
 * Trending badge, bottom info block (name, neighborhood · cuisine · price, an
 * italic "Famous for…" hook, and honest chips), a glassy right action rail, and a
 * tap-for-profile affordance. Real signals only — no faked star rating, no video
 * chrome. Fills its slot via `absolute inset-0` (never a `height:100%` chain).
 */
export default function RestaurantCard({
  scored,
  interactive = true,
  onSave,
}: RestaurantCardProps) {
  const r = scored.restaurant;
  const poster = cuisineIcon(r.cuisineTags);
  const trending = r.trendScore >= 75; // honest: derived from the seeded trend score
  const topChoice = r.vibeScore >= 90; // honest: derived from the seeded vibe score
  const clipCount = r.videos.length;
  const dishes = r.dishHighlights;
  const famousFor =
    dishes.length >= 2 ? `${dishes[0]} and ${dishes[1]}` : (dishes[0] ?? "");
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
    <article className="absolute inset-0 overflow-hidden bg-ink-2">
      {/* Identity hero: Google Place Photo -> logo -> FoodSwipe placeholder */}
      <HeroMedia key={r.id} restaurantId={r.id} name={r.name} posterIcon={poster} />

      {/* Crave scrim for legibility */}
      <div className="crave-gradient pointer-events-none absolute inset-0 z-10" />

      {/* Trending badge — below the floating top app bar */}
      {trending && (
        <div className="absolute left-4 top-20 z-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#d6042f]/90 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[#ffe7e5] shadow-lg backdrop-blur-md">
            <MaterialIcon name="trending_up" className="text-[16px]" /> Trending in DC
          </span>
        </div>
      )}

      {/* Right action rail */}
      {interactive && (
        <div
          className="absolute right-4 bottom-28 z-30 flex flex-col items-center gap-5"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <RailItem icon="favorite" label={formatCount(r.saveCount)} onClick={() => onSave?.()} />
          <RailItem icon="bookmark" label="Save" onClick={() => onSave?.()} />
          <RailItem
            icon={copied ? "check" : "share"}
            label={copied ? "Copied" : "Share"}
            onClick={shareProfile}
          />
          <RailItem icon="info" label="Info" href={`/restaurants/${r.id}`} />
        </div>
      )}

      {/* Bottom content overlay (kept clear of the rail with a max width) */}
      <div className="absolute inset-x-0 bottom-24 z-20 px-4">
        <div className="flex max-w-[76%] flex-col">
          {topChoice && (
            <div className="mb-1 flex items-center gap-1.5 text-[#f0c84f]">
              <MaterialIcon name="stars" filled className="text-[20px]" />
              <span className="text-sm font-bold">Top Choice</span>
            </div>
          )}

          <h2 className="font-display text-[44px] font-black leading-none text-white drop-shadow-lg">
            {r.name}
          </h2>

          <p className="mt-1.5 text-lg text-[#dbc2ad]">
            {r.neighborhood} • <span className="capitalize">{r.cuisineTags[0]}</span> •{" "}
            <span className="font-semibold text-[#ffc082]">{priceLabel(r.priceLevel)}</span>
          </p>

          {famousFor && (
            <p className="mt-1 text-sm italic text-[#dbc2ad]/80">
              Famous for {famousFor.toLowerCase()}
            </p>
          )}

          {/* Honest signal chips — NO fake star rating */}
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip>
              <MaterialIcon name="play_circle" className="text-[18px] text-[#ffc082]" />{" "}
              {clipCount} review {clipCount === 1 ? "clip" : "clips"}
            </Chip>
            <Chip>
              <MaterialIcon name="favorite" filled className="text-[16px] text-[#ffc082]" />{" "}
              {formatCount(r.saveCount)} saved
            </Chip>
          </div>
        </div>
      </div>

      {/* Tap-for-profile affordance (styled like the Stitch swipe-up hint) */}
      {interactive && (
        <Link
          href={`/restaurants/${r.id}`}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`View ${r.name} profile`}
          className="absolute inset-x-0 bottom-5 z-20 flex flex-col items-center"
        >
          <span className="bounce-subtle flex flex-col items-center gap-2 opacity-70">
            <span aria-hidden className="h-1 w-12 rounded-full bg-white/40" />
            <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/85">
              Tap for profile
            </span>
          </span>
        </Link>
      )}
    </article>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/90 shadow-sm backdrop-blur-md">
      {children}
    </span>
  );
}

/** A glassy rail action: a Material icon in a circle with a small label beneath. */
function RailItem({
  icon,
  label,
  onClick,
  href,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const circle =
    "flex h-[52px] w-[52px] items-center justify-center rounded-full border border-white/10 bg-white/5 text-white backdrop-blur-md drop-shadow-[0_4px_6px_rgba(0,0,0,0.5)] transition active:scale-90 hover:bg-white/10";
  const glyph = <MaterialIcon name={icon} className="text-[26px]" />;
  return (
    <div className="flex flex-col items-center gap-1">
      {href ? (
        <Link href={href} aria-label={label} className={circle}>
          {glyph}
        </Link>
      ) : (
        <button type="button" onClick={onClick} aria-label={label} className={circle}>
          {glyph}
        </button>
      )}
      <span className="text-[11px] font-bold tracking-tight text-white/90 drop-shadow">
        {label}
      </span>
    </div>
  );
}
