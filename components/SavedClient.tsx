"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Restaurant } from "@/lib/types";
import { useSwipes, useHydrated } from "@/lib/storage";
import { priceLabel } from "@/lib/options";
import { cuisineIcon } from "@/lib/emoji";
import TagPill from "@/components/TagPill";
import HeroMedia from "@/components/HeroMedia";
import MaterialIcon from "@/components/MaterialIcon";

/** Saved restaurants (right swipes), newest first. */
export default function SavedClient({
  seedRestaurants,
}: {
  seedRestaurants: Restaurant[];
}) {
  const isLoaded = useHydrated();
  const { savedIds, removeSwipe } = useSwipes();
  const seedById = useMemo(
    () => new Map(seedRestaurants.map((r) => [r.id, r])),
    [seedRestaurants],
  );

  // Server decides whether seed saved IDs may resolve. In production content mode
  // seedRestaurants is empty, so stale seed-only localStorage IDs stay hidden.
  const [byId, setById] = useState<Map<string, Restaurant>>(seedById);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/restaurants");
        const data = (await res.json()) as { restaurants?: Restaurant[] };
        if (!cancelled && Array.isArray(data.restaurants)) {
          setById(new Map(data.restaurants.map((r) => [r.id, r])));
        }
      } catch {
        // Keep the server-provided fallback map; production mode provides none.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saved = savedIds
    .map((id) => byId.get(id) ?? seedById.get(id))
    .filter((r): r is Restaurant => Boolean(r));

  return (
    <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-8 pt-6">
      <header className="mb-5">
        <h1 className="font-display text-3xl font-bold text-cream">Saved</h1>
        <p className="mt-1 text-sm text-tan">
          {isLoaded
            ? saved.length > 0
              ? `${saved.length} ${saved.length === 1 ? "spot" : "spots"} you're into`
              : "Right-swipe a spot to save it here."
            : "Loading…"}
        </p>
      </header>

      {!isLoaded ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-24 rounded-3xl" />
          ))}
        </div>
      ) : saved.length === 0 ? (
        <div className="mt-20 flex flex-col items-center gap-4 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface ring-1 ring-inset ring-line">
            <MaterialIcon name="bookmark" className="text-3xl text-saffron" />
          </span>
          <p className="max-w-[14rem] text-tan">
            Nothing saved yet. Find spots you love in the feed.
          </p>
          <Link
            href="/feed"
            className="rounded-full bg-brand-gradient px-6 py-3 font-semibold text-saffron-ink shadow-lg shadow-saffron/20"
          >
            Start swiping →
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {saved.map((r) => (
            <li
              key={r.id}
              className="flex items-stretch gap-3 rounded-3xl bg-surface p-3 ring-1 ring-inset ring-white/5"
            >
              {/* Identity image when available -> logo -> placeholder + cuisine icon */}
              <Link
                href={`/restaurants/${r.id}`}
                aria-label={`Open ${r.name}`}
                className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl ring-1 ring-inset ring-white/5"
              >
                <HeroMedia
                  key={r.id}
                  compact
                  restaurantId={r.id}
                  name={r.name}
                  posterIcon={cuisineIcon(r.cuisineTags)}
                />
              </Link>

              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <Link href={`/restaurants/${r.id}`} className="min-w-0">
                  <h2 className="truncate font-display text-lg font-semibold text-cream">
                    {r.name}
                  </h2>
                </Link>
                <p className="flex items-center gap-1 truncate text-xs text-tan">
                  <MaterialIcon name="location_on" className="text-[14px] text-haze" />
                  {r.neighborhood} ·{" "}
                  <span className="font-semibold text-saffron">{priceLabel(r.priceLevel)}</span>
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {r.cuisineTags.slice(0, 2).map((t) => (
                    <TagPill key={t} variant="cuisine">
                      {t}
                    </TagPill>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => removeSwipe(r.id)}
                aria-label={`Remove ${r.name} from saved`}
                className="shrink-0 self-start rounded-full p-2 text-haze transition hover:bg-white/10 hover:text-saffron"
              >
                <MaterialIcon name="close" className="text-xl" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
