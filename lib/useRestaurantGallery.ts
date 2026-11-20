"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { createGalleryCache, extrasForHero, normalizeGalleryResponse } from "./clientGallery";
import { galleryKey, initialGallery, reduceGallery, selectGallery } from "./galleryState";
import type { PlacePhoto } from "./placePhoto";

// Session memory only. Photo URLs are ephemeral, so entries expire and are never persisted.
const sessionCache = createGalleryCache(() => Date.now());

/**
 * One restaurant's photo gallery: the hero it already shows plus up to two more, fetched
 * only when the person first asks for another photo. The same hook serves the Swipe card
 * and the standalone profile.
 */
export function useRestaurantGallery({
  restaurantId,
  hero,
  heroDisplayed,
  galleryCount,
}: {
  restaurantId: string;
  hero: PlacePhoto | null | undefined;
  /** True once the hero's own image has loaded. */
  heroDisplayed: boolean;
  /** Upper bound from the default photo response; never a promise. */
  galleryCount: number;
}) {
  const key = galleryKey(restaurantId, hero);
  const heroId = hero?.googleMapsUri ?? null;
  const [stored, dispatch] = useReducer(reduceGallery, undefined, () => initialGallery(key, heroId));
  // A different restaurant or hero starts from scratch; until that renders, old state is unused.
  if (stored.key !== key || stored.heroId !== heroId) dispatch({ type: "reset", key, heroId });
  const state = stored.key === key && stored.heroId === heroId ? stored : initialGallery(key, heroId);

  const requestRef = useRef<AbortController | null>(null);
  // Leaving the restaurant (or unmounting) cancels a request that is still on its way.
  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, [key]);

  const step = useCallback((direction: 1 | -1) => {
    if (!hero || key === null) return;
    if (state.phase === "ready") {
      dispatch({ type: "step", key, step: direction });
      return;
    }
    const mayRequest = state.phase === "idle" || state.phase === "error";
    // One request at a time: repeated taps while loading do nothing.
    if (!mayRequest || requestRef.current || galleryCount < 2 || !heroDisplayed) return;

    const cached = sessionCache.get(restaurantId);
    if (cached) {
      const extras = extrasForHero(hero, cached);
      if (extras) {
        dispatch({ type: "request", key, step: direction });
        dispatch({ type: "loaded", key, extras });
        return;
      }
      sessionCache.delete(restaurantId);
    }

    const controller = new AbortController();
    requestRef.current = controller;
    dispatch({ type: "request", key, step: direction });
    const url = `/api/restaurants/${encodeURIComponent(restaurantId)}/photo?gallery=1&skipHero=1`;
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`gallery-${response.status}`);
        const body = normalizeGalleryResponse(await response.json());
        if (controller.signal.aborted) return;
        const extras = body ? extrasForHero(hero, body) : null;
        if (!body || !extras) {
          // Built around another hero, or malformed: show the hero alone rather than guess.
          dispatch({ type: "unavailable", key });
          return;
        }
        sessionCache.set(restaurantId, body);
        dispatch({ type: "loaded", key, extras });
      } catch {
        if (!controller.signal.aborted) dispatch({ type: "failed", key });
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
      }
    })();
  }, [galleryCount, hero, heroDisplayed, key, restaurantId, state.phase]);

  const drop = useCallback((id: string) => {
    if (key !== null) dispatch({ type: "drop", key, id });
  }, [key]);

  const selected = selectGallery(state, hero);
  // The button stays (with a spinner) while the photos are on their way.
  const offerMore = (state.phase === "idle" || state.phase === "error" || state.phase === "loading")
    && galleryCount >= 2 && heroDisplayed;
  let announcement = "";
  if (state.phase === "loading") announcement = "Loading more photos.";
  else if (state.phase === "error") announcement = "More photos couldn’t be loaded. Try again.";
  else if (state.phase === "unavailable") announcement = "No more photos are available.";
  else if (state.phase === "ready") {
    announcement = selected.canStep ? `Photo ${selected.index + 1} of ${selected.photos.length}` : "No more photos are available.";
  }

  return { ...selected, phase: state.phase, offerMore, announcement, step, drop };
}
