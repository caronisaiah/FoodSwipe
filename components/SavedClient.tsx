"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SavedRestaurant } from "@/lib/types";
import { useSwipes, useHydrated } from "@/lib/storage";
import { priceLabel } from "@/lib/options";
import { cuisineIcon } from "@/lib/emoji";
import TagPill from "@/components/TagPill";
import HeroMedia from "@/components/HeroMedia";
import MaterialIcon from "@/components/MaterialIcon";
import {
  captureFoodSwipeEvent,
  restaurantAnalyticsContext,
} from "@/lib/analytics";

async function loadSavedRestaurants(savedIds: string[], signal: AbortSignal) {
  // A malformed legacy entry counts as unavailable without blocking other saves.
  const ids = savedIds.filter((id) => id.length > 0 && id.length <= 256);
  const restaurants: SavedRestaurant[] = [];
  for (let start = 0; start < ids.length; start += 25) {
    const query = new URLSearchParams(ids.slice(start, start + 25).map((id) => ["id", id]));
    const response = await fetch(`/api/restaurants/saved?${query}`, { signal });
    if (!response.ok) throw new Error("Saved details couldn’t load.");
    const data = await response.json() as { restaurants?: SavedRestaurant[] };
    if (!Array.isArray(data.restaurants)) throw new Error("Missing saved restaurant details.");
    restaurants.push(...data.restaurants);
  }
  return new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
}

/** Global saved restaurants (right swipes), newest first. */
export default function SavedClient() {
  const isLoaded = useHydrated();
  const { savedIds, removeSwipe } = useSwipes();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    ids: string[]; attempt: number; restaurants: Map<string, SavedRestaurant> | null;
  }>();

  useEffect(() => {
    if (!savedIds.length) return;
    const controller = new AbortController();
    void loadSavedRestaurants(savedIds, controller.signal).then(
      (restaurants) => {
        if (!controller.signal.aborted) setResult({ ids: savedIds, attempt, restaurants });
      },
      () => {
        if (!controller.signal.aborted) setResult({ ids: savedIds, attempt, restaurants: null });
      },
    );
    return () => controller.abort();
  }, [savedIds, attempt]);

  const current = result?.attempt === attempt && savedIds.every((id) => result.ids.includes(id)) ? result : null;
  const loading = !isLoaded || (savedIds.length > 0 && !current);
  const error = Boolean(savedIds.length && current?.restaurants === null);
  const saved = savedIds
    .map((id) => current?.restaurants?.get(id))
    .filter((restaurant): restaurant is SavedRestaurant => Boolean(restaurant));
  const missing = savedIds.length - saved.length;

  const removeSavedRestaurant = (restaurant: SavedRestaurant) => {
    // Every rendered item came from savedIds, so this is a real saved -> unsaved
    // transition rather than a generic persistence notification.
    removeSwipe(restaurant.id);
    captureFoodSwipeEvent("restaurant_unsaved", {
      ...restaurantAnalyticsContext(restaurant, "saved"),
      unsaveSource: "saved_list",
    });
  };

  return (
    <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-8 pt-6">
      <header className="mb-5">
        <h1 className="font-display text-3xl font-bold text-cream">Saved</h1>
        <p className="mt-1 text-sm text-tan">
          {loading ? "Loading…" : saved.length > 0
            ? `${saved.length} ${saved.length === 1 ? "spot" : "spots"} you're into`
            : savedIds.length === 0 ? "Right-swipe a spot to save it here." : null}
        </p>
      </header>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-24 rounded-3xl" />
          ))}
        </div>
      ) : error ? (
        <div className="space-y-3 text-tan">
          <p role="status">Saved restaurant details couldn’t load. Your saves are still stored on this device.</p>
          <button className="rounded-full border border-line px-4 py-2" type="button" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      ) : savedIds.length === 0 ? (
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
        <>
          {missing > 0 && (
            <p role="status" className="mb-4 text-sm text-tan">
              {missing === 1 ? "One saved restaurant is" : `${missing} saved restaurants are`} currently unavailable.
              {" "}Your saves are still stored on this device.
            </p>
          )}
          <ul className="space-y-3">
            {saved.map((r) => (
              <li
                key={r.id}
                className="flex items-stretch gap-3 rounded-3xl bg-surface p-3 ring-1 ring-inset ring-white/5"
              >
                {/* Identity image when available -> logo -> placeholder + cuisine icon */}
                <Link
                  href={`/restaurants/${encodeURIComponent(r.id)}`}
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
                  <Link href={`/restaurants/${encodeURIComponent(r.id)}`} className="min-w-0">
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
                  onClick={() => removeSavedRestaurant(r)}
                  aria-label={`Remove ${r.name} from saved`}
                  className="shrink-0 self-start rounded-full p-2 text-haze transition hover:bg-white/10 hover:text-saffron"
                >
                  <MaterialIcon name="close" className="text-xl" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
