"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getMarketDisplayName, type Market } from "@/lib/markets";
import { useDiscoveryCatalogue } from "@/lib/useDiscoveryCatalogue";
import { rankRestaurants } from "@/lib/recommendations";
import { usePreferences, useFavorites, useDiscoveryHistory } from "@/lib/storage";
import { describeStorageFailure, type StorageNotice } from "@/lib/storageErrors";
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
  const {
    status: storageStatus, error: storageError, seenIds, recordSwipe, restart, retry: retryStorage,
  } = useDiscoveryHistory(market);
  const { catalogue, retry } = useDiscoveryCatalogue(market);
  const [deckCycle, setDeckCycle] = useState(0);
  const [actionError, setActionError] = useState<StorageNotice | null>(null);
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
      } catch (error) {
        setActionError(describeStorageFailure(error, direction === "right" ? "save" : "skip", scored.restaurant.name));
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
    } catch (error) {
      setActionError(describeStorageFailure(error, "restart"));
    }
  }, [captureFeedStarted, restart]);

  const handleStorageRetry = async () => {
    await retryStorage();
    setActionError(null);
  };

  const storageNotice = actionError ?? (storageStatus === "error"
    ? describeStorageFailure(storageError ?? { reason: "read-failed", operation: "read" }, "load")
    : null);

  return (
    <div className="swipe-screen relative min-h-0 flex-1 overflow-hidden bg-ink">
      {/* Top bar — floats over the media. Tune at left, wordmark, market and Map at right. */}
      <div className="swipe-bar pointer-events-none absolute inset-x-0 top-0 z-40">
        <Link
          href="/"
          aria-label="Tune your preferences"
          className="swipe-bar-button pointer-events-auto justify-self-start"
        >
          <MaterialIcon name="tune" />
        </Link>
        <h1 className="swipe-wordmark">FoodSwipe</h1>
        <div className="swipe-bar-end">
          <Link
            href="/map"
            prefetch={false}
            aria-label="Discover restaurants on the map"
            className="swipe-bar-button swipe-bar-map pointer-events-auto"
          >
            <MaterialIcon name="map" />
            <span>Map</span>
          </Link>
        </div>
        {market && <p className="swipe-market">{getMarketDisplayName(market)}</p>}
      </div>
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
      ) : storageNotice ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <p role="alert" className="font-display text-xl font-bold text-cream">
            {storageNotice.message}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {storageNotice.retry && (
              <button type="button" onClick={() => void handleStorageRetry()} className="rounded-full border border-line px-4 py-2 text-cream">
                Retry
              </button>
            )}
            {storageNotice.reload && (
              <button type="button" onClick={() => window.location.reload()} className="rounded-full border border-line px-4 py-2 text-cream">
                Reload
              </button>
            )}
          </div>
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

    </div>
  );
}
