"use client";

import { useMemo } from "react";
import { RESTAURANTS } from "@/lib/seed/restaurants";
import { rankRestaurants } from "@/lib/recommendations";
import { usePreferences, useSwipes, useHydrated } from "@/lib/storage";
import SwipeDeck from "@/components/SwipeDeck";

/**
 * Owns the swipe feed. Ranks the full deck (memoised on preferences) and lets
 * SwipeDeck filter out anything already swiped. We wait for hydration before
 * rendering the deck so returning users don't see already-swiped cards flash by.
 */
export default function FeedClient() {
  const hydrated = useHydrated();
  const { preferences } = usePreferences();
  const { recordSwipe, resetSwipes, savedIds, swipedIds } = useSwipes();

  const deck = useMemo(
    () => rankRestaurants(RESTAURANTS, preferences),
    [preferences],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-4">
      <header className="mb-3 flex shrink-0 items-center justify-between">
        <div>
          <p className="font-display text-xl font-bold leading-none">
            <span className="text-gradient">Food</span>
            <span className="text-cream">Swipe</span>
          </p>
          <p className="mt-1 text-xs text-haze">📍 {preferences.location}</p>
        </div>
        <span className="rounded-full bg-white/8 px-3 py-1 text-xs font-medium text-haze ring-1 ring-inset ring-white/10">
          {RESTAURANTS.length} spots
        </span>
      </header>

      <div className="min-h-0 flex-1">
        {hydrated ? (
          <SwipeDeck
            deck={deck}
            swipedIds={swipedIds}
            onSwipe={recordSwipe}
            savedCount={savedIds.length}
            onReset={resetSwipes}
          />
        ) : (
          // Card-shaped shimmer so the very first paint already reads as a card.
          <div className="flex h-full w-full flex-col overflow-hidden rounded-[28px] ring-1 ring-white/10">
            <div className="shimmer basis-[46%] shrink-0 sm:basis-[54%]" />
            <div className="flex flex-1 flex-col gap-3 p-4">
              <div className="shimmer h-6 w-2/3 rounded-lg" />
              <div className="shimmer h-3 w-1/2 rounded" />
              <div className="shimmer h-3 w-3/4 rounded" />
              <div className="shimmer mt-auto h-10 w-full rounded-2xl" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
