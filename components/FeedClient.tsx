"use client";

import { useCallback, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import Link from "next/link";
import { RESTAURANTS, getRestaurantById } from "@/lib/seed/restaurants";
import { rankRestaurants } from "@/lib/recommendations";
import { usePreferences, useSwipes, useHydrated } from "@/lib/storage";
import SwipeDeck from "@/components/SwipeDeck";
import ProfileSheet from "@/components/ProfileSheet";
import MaterialIcon from "@/components/MaterialIcon";

/**
 * Owns the swipe feed. Ranks the full deck (memoised on preferences) and lets
 * SwipeDeck filter out anything already swiped. The whole screen is an
 * edge-to-edge discovery canvas (Stitch direction): the deck fills it, and the
 * top app bar floats over the hero as a glassy overlay. We wait for hydration
 * before rendering the deck so returning users don't see already-swiped cards.
 */
export default function FeedClient() {
  const hydrated = useHydrated();
  const { preferences } = usePreferences();
  const { recordSwipe, resetSwipes, savedIds, swipedIds } = useSwipes();

  // In-feed profile overlay: which restaurant's profile sheet is open (if any).
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const openProfile = useCallback((id: string) => setActiveProfileId(id), []);
  const closeProfile = useCallback(() => setActiveProfileId(null), []);
  const activeRestaurant = activeProfileId
    ? (getRestaurantById(activeProfileId) ?? null)
    : null;

  const deck = useMemo(
    () => rankRestaurants(RESTAURANTS, preferences),
    [preferences],
  );

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-ink">
      {/* Full-bleed discovery canvas */}
      {hydrated ? (
        <SwipeDeck
          deck={deck}
          swipedIds={swipedIds}
          onSwipe={recordSwipe}
          onOpenProfile={openProfile}
          paused={activeRestaurant !== null}
          savedCount={savedIds.length}
          onReset={resetSwipes}
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

      {/* In-feed profile overlay (feed stays mounted behind it) */}
      <AnimatePresence>
        {activeRestaurant && (
          <ProfileSheet restaurant={activeRestaurant} onClose={closeProfile} />
        )}
      </AnimatePresence>
    </div>
  );
}
