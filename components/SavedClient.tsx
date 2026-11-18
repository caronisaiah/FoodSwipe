"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SavedRestaurant } from "@/lib/types";
import { useFavorites } from "@/lib/storage";
import type { FavoriteRemoval } from "@/lib/discoveryState";
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
  const ids = savedIds.filter((id) => id.length > 0 && id.length <= 256 && !id.includes("\0"));
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

/** Global favorites, newest first. */
export default function SavedClient() {
  const { status, favorites, removeFavorite, undoRemoveFavorite, retry: retryStorage } = useFavorites();
  const savedIds = favorites.map(({ restaurantId }) => restaurantId);
  // IndexedDB returns fresh objects even when a tab only changed discovery history.
  const savedIdsJSON = JSON.stringify(savedIds);
  const [undo, setUndo] = useState<{ receipt: FavoriteRemoval; name: string } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [restoring, setRestoring] = useState(false);
  const undoButton = useRef<HTMLButtonElement>(null);
  const focusUndo = useRef(false);

  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    ids: string[]; attempt: number; restaurants: Map<string, SavedRestaurant> | null;
  }>();

  useEffect(() => {
    if (undo && focusUndo.current) undoButton.current?.focus();
  }, [undo]);

  useEffect(() => {
    const ids = JSON.parse(savedIdsJSON) as string[];
    if (!ids.length) return;
    const controller = new AbortController();
    void loadSavedRestaurants(ids, controller.signal).then(
      (restaurants) => {
        if (!controller.signal.aborted) setResult({ ids, attempt, restaurants });
      },
      () => {
        if (!controller.signal.aborted) setResult({ ids, attempt, restaurants: null });
      },
    );
    return () => controller.abort();
  }, [savedIdsJSON, attempt]);

  const current = result?.attempt === attempt && savedIds.every((id) => result.ids.includes(id)) ? result : null;
  const loading = status === "loading" || (status === "ready" && savedIds.length > 0 && !current);
  const error = Boolean(savedIds.length && current?.restaurants === null);
  const saved = savedIds
    .map((id) => current?.restaurants?.get(id))
    .filter((restaurant): restaurant is SavedRestaurant => Boolean(restaurant));
  const missing = savedIds.length - saved.length;

  const removeSavedRestaurant = async (restaurant: SavedRestaurant, focus: boolean) => {
    try {
      const receipt = await removeFavorite(restaurant.id);
      if (!receipt) return;
      focusUndo.current = focus;
      setUndo({ receipt, name: restaurant.name });
      setFeedback("");
      captureFoodSwipeEvent("restaurant_unsaved", {
        ...restaurantAnalyticsContext(restaurant, "saved"),
        unsaveSource: "saved_list",
      });
    } catch {
      setFeedback(`Couldn’t remove ${restaurant.name} from Saved.`);
    }
  };

  const restore = async () => {
    if (!undo || restoring) return;
    setRestoring(true);
    try {
      const restored = await undoRemoveFavorite(undo.receipt);
      setUndo((current) => current === undo ? null : current);
      setFeedback(restored ? `Restored ${undo.name} to Saved.` : "That removal can no longer be undone.");
    } catch {
      setFeedback(`Couldn’t restore ${undo.name} to Saved.`);
    } finally {
      setRestoring(false);
    }
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

      {undo && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-tan">
          <p role="status">Removed {undo.name} from Saved.</p>
          <button type="button" ref={undoButton} onClick={() => void restore()} disabled={restoring || status !== "ready"}
            className="rounded-full border border-line px-4 py-2 text-cream">
            Undo
          </button>
        </div>
      )}
      {feedback && <p role="status" className="mb-4 text-sm text-tan">{feedback}</p>}
      {status === "error" ? (
        <div className="space-y-3 text-tan">
          <p role="alert">Couldn’t access favorites on this device.</p>
          <button className="rounded-full border border-line px-4 py-2" type="button" onClick={() => void retryStorage()}>
            Retry
          </button>
        </div>
      ) : loading ? (
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
                  onClick={(event) => void removeSavedRestaurant(r, event.currentTarget === document.activeElement)}
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
