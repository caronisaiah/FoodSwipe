"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Restaurant } from "@/lib/types";
import { rankRestaurants } from "@/lib/recommendations";
import { usePreferences, useSwipes, useHydrated } from "@/lib/storage";
import SwipeDeck from "@/components/SwipeDeck";
import MaterialIcon from "@/components/MaterialIcon";
import {
  captureFoodSwipeEvent,
  restaurantAnalyticsContext,
} from "@/lib/analytics";

/**
 * Owns the swipe feed. Ranks the full deck (memoised on preferences) and lets
 * SwipeDeck filter out anything already swiped. The whole screen is an
 * edge-to-edge discovery canvas (Stitch direction): the deck fills it, and the
 * top app bar floats over the hero as a glassy overlay. We wait for hydration
 * before rendering the deck so returning users don't see already-swiped cards.
 */
export default function FeedClient({
  initialRestaurants,
}: {
  initialRestaurants: Restaurant[];
}) {
  const hydrated = useHydrated();
  const { preferences } = usePreferences();
  const { recordSwipe, resetSwipes, savedIds, swipedIds } = useSwipes();

  // Server decides whether seed fallback is allowed for this deployment. In
  // production mode this starts empty and the API must provide DB-published rows.
  const [restaurants, setRestaurants] = useState<Restaurant[]>(initialRestaurants);
  const [restaurantsSettled, setRestaurantsSettled] = useState(false);
  const [deckCycle, setDeckCycle] = useState(0);
  const entryTrackedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/restaurants");
        const data = (await res.json()) as { restaurants?: Restaurant[] };
        if (!cancelled && Array.isArray(data.restaurants)) {
          setRestaurants(data.restaurants);
        }
      } catch {
        // Keep the server-provided initial list. In production content mode that
        // is intentionally empty rather than a seed fallback.
      } finally {
        if (!cancelled) setRestaurantsSettled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const deck = useMemo(
    () => rankRestaurants(restaurants, preferences),
    [restaurants, preferences],
  );

  const captureFeedStarted = useCallback(
    (startReason: "entry" | "restart") => {
      captureFoodSwipeEvent("foodswipe_feed_started", {
        market: deck[0]?.restaurant.market ?? "unknown",
        restaurantCount: deck.length,
        startReason,
      });
    },
    [deck],
  );

  useEffect(() => {
    if (!hydrated || !restaurantsSettled || entryTrackedRef.current) return;
    entryTrackedRef.current = true;
    captureFeedStarted("entry");
  }, [captureFeedStarted, hydrated, restaurantsSettled]);

  const handleSwipe = useCallback(
    (restaurantId: string, direction: "left" | "right") => {
      const feedIndex = deck.findIndex((item) => item.restaurant.id === restaurantId);
      const scored = feedIndex >= 0 ? deck[feedIndex] : undefined;

      recordSwipe(restaurantId, direction);
      if (!scored) return;

      const context = restaurantAnalyticsContext(
        scored.restaurant,
        "feed",
        feedIndex + 1,
      );
      captureFoodSwipeEvent("restaurant_swiped", { ...context, direction });
      if (direction === "right") {
        captureFoodSwipeEvent("restaurant_saved", {
          ...context,
          saveSource: "swipe",
        });
      }
    },
    [deck, recordSwipe],
  );

  const handleReset = useCallback(() => {
    resetSwipes();
    setDeckCycle((cycle) => cycle + 1);
    captureFeedStarted("restart");
  }, [captureFeedStarted, resetSwipes]);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-ink">
      {/* Full-bleed discovery canvas — hero first, profile details below on scroll */}
      {hydrated ? (
        <SwipeDeck
          deck={deck}
          deckCycle={deckCycle}
          swipedIds={swipedIds}
          onSwipe={handleSwipe}
          savedCount={savedIds.length}
          onReset={handleReset}
        />
      ) : (
        <div className="shimmer absolute inset-0" />
      )}

      {/* Top app bar — floats over the hero (tune · FoodSwipe · notifications) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center justify-between bg-gradient-to-b from-black/70 via-black/25 to-transparent px-4 py-3">
        <Link
          href="/"
          aria-label="Tune your preferences"
          className="pointer-events-auto flex h-10 w-10 items-center justify-center text-saffron/90 transition active:scale-90"
        >
          <MaterialIcon name="tune" className="text-[26px]" />
        </Link>
        <h1 className="font-display text-3xl font-black italic tracking-tighter text-saffron drop-shadow-[0_0_12px_rgba(255,192,130,0.35)]">
          FoodSwipe
        </h1>
        {/* Decorative only — no notifications feature yet, so it is not a button. */}
        <span className="flex h-10 w-10 items-center justify-center text-saffron/90">
          <MaterialIcon name="notifications" className="text-[26px]" />
        </span>
      </div>
    </div>
  );
}
