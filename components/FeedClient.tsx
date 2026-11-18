"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getMarketDisplayName, type Market } from "@/lib/markets";
import { useDiscoveryCatalogue } from "@/lib/useDiscoveryCatalogue";
import { rankRestaurants } from "@/lib/recommendations";
import { usePreferences, useFavorites, useDiscoveryHistory } from "@/lib/storage";
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
export default function FeedClient({ market }: { market: Market | null }) {
  const { preferences } = usePreferences();
  const { favorites } = useFavorites();
  const { status: storageStatus, seenIds, recordSwipe, restart, retry: retryStorage } = useDiscoveryHistory(market);
  const { catalogue, retry } = useDiscoveryCatalogue(market);
  const [deckCycle, setDeckCycle] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const entryTrackedRef = useRef(false);

  const deck = useMemo(
    () => catalogue.status === "ready" ? rankRestaurants(catalogue.restaurants, preferences) : [],
    [catalogue, preferences],
  );

  const captureFeedStarted = useCallback(
    (startReason: "entry" | "restart") => {
      captureFoodSwipeEvent("foodswipe_feed_started", {
        market: market ?? "unknown",
        restaurantCount: deck.length,
        startReason,
      });
    },
    [deck, market],
  );

  useEffect(() => {
    if (storageStatus !== "ready" || catalogue.status !== "ready" || entryTrackedRef.current) return;
    entryTrackedRef.current = true;
    captureFeedStarted("entry");
  }, [captureFeedStarted, catalogue.status, storageStatus]);

  const handleSwipe = useCallback(
    async (restaurantId: string, direction: "left" | "right") => {
      const feedIndex = deck.findIndex((item) => item.restaurant.id === restaurantId);
      const scored = feedIndex >= 0 ? deck[feedIndex] : undefined;

      if (!scored) return false;

      let addedFavorite;
      try {
        addedFavorite = await recordSwipe(restaurantId, direction);
      } catch {
        const { name } = scored.restaurant;
        setActionError(direction === "right" ? `Couldn’t save ${name}.` : `Couldn’t skip ${name}.`);
        return false;
      }

      const context = restaurantAnalyticsContext(
        scored.restaurant,
        "feed",
        feedIndex + 1,
      );
      captureFoodSwipeEvent("restaurant_swiped", { ...context, direction });
      if (addedFavorite) {
        captureFoodSwipeEvent("restaurant_saved", {
          ...context,
          saveSource: "swipe",
        });
      }
      return true;
    },
    [deck, recordSwipe],
  );

  const handleReset = useCallback(async () => {
    try {
      await restart();
      setDeckCycle((cycle) => cycle + 1);
      captureFeedStarted("restart");
    } catch {
      setActionError("Couldn’t start over.");
    }
  }, [captureFeedStarted, restart]);

  const handleStorageRetry = async () => {
    await retryStorage();
    setActionError(null);
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-ink">
      {/* Full-bleed discovery canvas — hero first, profile details below on scroll */}
      {!market || catalogue.status === "error" || (catalogue.status === "ready" && deck.length === 0) ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <p role="status" className="font-display text-xl font-bold text-cream">
            {!market ? "Choose a discovery market in Tune." : catalogue.status === "error"
              ? `Restaurants couldn’t load for ${getMarketDisplayName(market)}.`
              : `No curated restaurants in ${getMarketDisplayName(market)} yet.`}
          </p>
          {market && catalogue.status === "error" && (
            <button type="button" onClick={retry} className="rounded-full border border-line px-4 py-2 text-cream">
              Retry
            </button>
          )}
        </div>
      ) : actionError || storageStatus === "error" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <p role="alert" className="font-display text-xl font-bold text-cream">
            {actionError ?? "Couldn’t access swipe history or favorites on this device."}
          </p>
          <button type="button" onClick={() => void handleStorageRetry()} className="rounded-full border border-line px-4 py-2 text-cream">
            Retry
          </button>
        </div>
      ) : storageStatus === "ready" && catalogue.status === "ready" ? (
        <SwipeDeck
          deck={deck}
          deckCycle={deckCycle}
          swipedIds={seenIds}
          onSwipe={handleSwipe}
          savedCount={favorites.length}
          onReset={handleReset}
        />
      ) : (
        <div role="status" className="shimmer absolute inset-0">
          <span className="sr-only">Loading restaurants for {getMarketDisplayName(market)}…</span>
        </div>
      )}

      {/* Top app bar — floats over the hero. */}
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
        <Link
          href="/map"
          prefetch={false}
          aria-label="Discover restaurants on the map"
          className="pointer-events-auto flex h-10 items-center gap-1 rounded-full bg-black/45 px-2 text-xs font-semibold text-saffron"
        >
          <MaterialIcon name="map" className="text-[21px]" /> Map
        </Link>
      </div>
    </div>
  );
}
