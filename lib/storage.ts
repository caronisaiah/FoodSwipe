"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type {
  BroadCuisine,
  Craving,
  Dietary,
  ManualVideoEntry,
  PriceLevel,
  SwipeDirection,
  UserPreferences,
  Vibe,
} from "./types";
import { normalizeVideo } from "./video";
import { isAsianChoice } from "./cuisineGroups";
import type { Market } from "./markets";
import {
  addFavorite, removeFavorite, undoFavorite, selectFavorites, selectSeen, restartMarket, recordSwipe,
  type FavoriteRemoval,
} from "./discoveryState";
import {
  getDiscoverySnapshot, INITIAL_DISCOVERY, refreshDiscovery, subscribeDiscovery, updateDiscovery,
} from "./discoveryStorage";

/**
 * Client-side persistence for MVP v0, built on `useSyncExternalStore` so that
 * localStorage is treated as the external store it is: correct SSR snapshots,
 * automatic re-render on change, and in-sync across every hook instance + tab.
 * These hooks are the single seam to swap for a real API/db later.
 */

const PREFS_KEY = "foodswipe.preferences.v1";
const MANUAL_VIDEOS_KEY = "foodswipe.manualVideos.v1";

export const DEFAULT_PREFERENCES: UserPreferences = {
  location: "Washington, DC",
  maxDistanceMiles: 5,
  budget: 3,
  cravings: [],
  broadCuisines: [],
  vibes: [],
  dietary: [],
};

// Stable fallback references — required so server/empty snapshots don’t loop.
const EMPTY_MANUAL: ManualVideoEntry[] = [];

/*
  Runtime normalization. localStorage is untrusted (old schema, partial writes,
  user tampering) so we never blindly cast it to our domain types. These coerce
  whatever is stored into a known-good shape, falling back field-by-field.
*/
function asStringArray<T extends string>(v: unknown): T[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as T[]) : [];
}

export function normalizePreferences(v: unknown): UserPreferences {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const distance = [1, 3, 5, 10].includes(o.maxDistanceMiles as number)
    ? (o.maxDistanceMiles as 1 | 3 | 5 | 10)
    : DEFAULT_PREFERENCES.maxDistanceMiles;
  const budget = [1, 2, 3, 4].includes(o.budget as number)
    ? (o.budget as PriceLevel)
    : DEFAULT_PREFERENCES.budget;
  const broadCuisines = asStringArray<BroadCuisine>(o.broadCuisines)
    .filter((value, index, all) => value === "asian" && all.indexOf(value) === index);
  let cravings = asStringArray<Craving>(o.cravings);
  // "All Asian" and specific Asian choices are exclusive. A record holding both (hand-edited
  // or from a bug) resolves to the broad choice, which already covered the specifics.
  if (broadCuisines.length > 0) cravings = cravings.filter((value) => !isAsianChoice(value));
  return {
    location:
      typeof o.location === "string" ? o.location : DEFAULT_PREFERENCES.location,
    maxDistanceMiles: distance,
    budget,
    cravings,
    // Older records have no such field; unknown values are dropped, known ones deduped.
    broadCuisines,
    vibes: asStringArray<Vibe>(o.vibes),
    dietary: asStringArray<Dietary>(o.dietary),
  };
}

function normalizeManualVideos(v: unknown): ManualVideoEntry[] {
  if (!Array.isArray(v)) return EMPTY_MANUAL;
  const out: ManualVideoEntry[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (typeof r.restaurantId !== "string" || r.restaurantId.trim() === "") {
      continue;
    }
    // normalizeVideo validates, cleans, and enforces the legal-safe invariants
    // (or drops the entry) — the single seam for untrusted stored data.
    const video = normalizeVideo(r.video);
    if (video) out.push({ restaurantId: r.restaurantId, video });
  }
  return out;
}

// Cache parsed values per key so getSnapshot returns a STABLE reference until
// the underlying string actually changes (useSyncExternalStore requirement).
const snapshotCache = new Map<string, { raw: string | null; value: unknown }>();

function readCached<T>(
  key: string,
  fallback: T,
  normalize?: (parsed: unknown) => T,
): T {
  if (typeof window === "undefined") return fallback;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return fallback;
  }
  const cached = snapshotCache.get(key);
  if (cached && cached.raw === raw) return cached.value as T;
  let value: T;
  try {
    if (raw == null) value = fallback;
    else {
      const parsed: unknown = JSON.parse(raw);
      value = normalize ? normalize(parsed) : (parsed as T);
    }
  } catch {
    value = fallback;
  }
  snapshotCache.set(key, { raw, value });
  return value;
}

function writeJSON<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    // Nudge every hook instance in this tab to re-read (cross-tab uses 'storage').
    window.dispatchEvent(new CustomEvent(`foodswipe:${key}`));
  } catch {
    // storage full / blocked — fail silently; app keeps working from cache
  }
}

function useStoredValue<T>(
  key: string,
  fallback: T,
  normalize?: (parsed: unknown) => T,
): T {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined") return () => {};
      window.addEventListener(`foodswipe:${key}`, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(`foodswipe:${key}`, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    [key],
  );
  const getSnapshot = useCallback(
    () => readCached(key, fallback, normalize),
    [key, fallback, normalize],
  );
  const getServerSnapshot = useCallback(() => fallback, [fallback]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Onboarding preferences. setPreferences persists immediately. */
export function usePreferences() {
  const preferences = useStoredValue(
    PREFS_KEY,
    DEFAULT_PREFERENCES,
    normalizePreferences,
  );
  const setPreferences = useCallback(
    (next: UserPreferences | ((prev: UserPreferences) => UserPreferences)) => {
      const resolved =
        typeof next === "function"
          ? (next as (prev: UserPreferences) => UserPreferences)(
              readCached(PREFS_KEY, DEFAULT_PREFERENCES, normalizePreferences),
            )
          : next;
      writeJSON(PREFS_KEY, resolved);
    },
    [],
  );
  return { preferences, setPreferences };
}

function useDiscoveryState() {
  return useSyncExternalStore(subscribeDiscovery, getDiscoverySnapshot, () => INITIAL_DISCOVERY);
}

/** Device-local favorites, ordered newest first. */
export function useFavorites() {
  const { state, status, error } = useDiscoveryState();
  const favorites = useMemo(() => selectFavorites(state), [state]);
  return {
    status,
    error,
    favorites,
    retry: refreshDiscovery,
    saveFavorite: saveRestaurantFavorite,
    removeFavorite: removeRestaurantFavorite,
    undoRemoveFavorite,
  };
}

function saveRestaurantFavorite(restaurantId: string) {
  const at = Date.now();
  return updateDiscovery((state) => addFavorite(state, restaurantId, at));
}

function removeRestaurantFavorite(restaurantId: string) {
  return updateDiscovery((state) => removeFavorite(state, restaurantId));
}

function undoRemoveFavorite(receipt: FavoriteRemoval) {
  return updateDiscovery((state) => undoFavorite(state, receipt));
}

export function useDiscoveryHistory(market: Market | null) {
  const { state, status, error } = useDiscoveryState();
  const seenIds = useMemo(() => market ? selectSeen(state, market) : [], [market, state]);

  const swipe = useCallback((restaurantId: string, direction: SwipeDirection) => {
    if (!market) return Promise.resolve(false);
    const at = Date.now();
    return updateDiscovery((current) => recordSwipe(current, market, restaurantId, direction, at));
  }, [market]);

  const restart = useCallback(() => {
    if (!market) return Promise.resolve();
    return updateDiscovery((current) => restartMarket(current, market));
  }, [market]);

  return { seenIds, status, error, retry: refreshDiscovery, recordSwipe: swipe, restart };
}

/**
 * Videos attached manually via the internal admin/demo tool (`/admin/videos`).
 * Persisted in localStorage (no server db in v1). Pass a restaurantId to scope
 * the returned `entries`/`videos` to one restaurant.
 */
export function useManualVideos(restaurantId?: string) {
  const all = useStoredValue(
    MANUAL_VIDEOS_KEY,
    EMPTY_MANUAL,
    normalizeManualVideos,
  );

  const entries = useMemo(
    () =>
      restaurantId ? all.filter((e) => e.restaurantId === restaurantId) : all,
    [all, restaurantId],
  );

  const videos = useMemo(() => entries.map((e) => e.video), [entries]);

  const addManualVideo = useCallback((entry: ManualVideoEntry) => {
    const prev = readCached(MANUAL_VIDEOS_KEY, EMPTY_MANUAL, normalizeManualVideos);
    writeJSON(MANUAL_VIDEOS_KEY, [...prev, entry]);
  }, []);

  const removeManualVideo = useCallback((videoId: string) => {
    const prev = readCached(MANUAL_VIDEOS_KEY, EMPTY_MANUAL, normalizeManualVideos);
    writeJSON(
      MANUAL_VIDEOS_KEY,
      prev.filter((e) => e.video.id !== videoId),
    );
  }, []);

  const clearManualVideos = useCallback(
    () => writeJSON(MANUAL_VIDEOS_KEY, EMPTY_MANUAL),
    [],
  );

  return {
    entries,
    videos,
    addManualVideo,
    removeManualVideo,
    clearManualVideos,
  };
}
