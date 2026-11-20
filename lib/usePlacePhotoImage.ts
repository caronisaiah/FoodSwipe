"use client";

import { useEffect, useReducer } from "react";
import type { PlacePhoto } from "./placePhoto";
import {
  initialPhotoLoad, PHOTO_PATIENCE_MS, photoLoadKey, reducePhotoLoad, selectPhotoLoad,
} from "./placePhotoLoad";

/**
 * Keeps a directly loaded Google photo and its credit on one load boundary: the
 * credit (`displayed`) exists only once this exact image has loaded. A photo that
 * is slow shows `showFallback` while it keeps loading; one that fails, or belongs
 * to a restaurant that is no longer current, never reaches the screen.
 */
export function usePlacePhotoImage(photo: PlacePhoto | null | undefined) {
  const key = photoLoadKey(photo);
  const [stored, dispatch] = useReducer(reducePhotoLoad, key, initialPhotoLoad);
  // A different photo starts from scratch, and until that renders the old state is not used.
  if (stored.key !== key) dispatch({ type: "reset", key });
  const state = stored.key === key ? stored : initialPhotoLoad(key);

  useEffect(() => {
    if (key === null || state.phase !== "loading") return;
    const timer = setTimeout(() => dispatch({ type: "slow", key }), PHOTO_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [key, state.phase]);

  const { attempted, displayed, showFallback } = selectPhotoLoad(state, photo);
  return {
    photo: attempted,
    displayed,
    showFallback,
    phase: state.phase,
    key,
    imageProps: {
      style: { visibility: displayed ? "visible" as const : "hidden" as const },
      onLoad: () => dispatch({ type: "load", key }),
      onError: () => dispatch({ type: "error", key }),
      referrerPolicy: "no-referrer" as const,
    },
  };
}
