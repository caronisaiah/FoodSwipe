"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type {
  Craving,
  Dietary,
  ManualVideoEntry,
  PriceLevel,
  SwipeAction,
  SwipeDirection,
  UserPreferences,
  Vibe,
} from "./types";
import { normalizeVideo } from "./video";

/**
 * Client-side persistence for MVP v0, built on `useSyncExternalStore` so that
 * localStorage is treated as the external store it is: correct SSR snapshots,
 * automatic re-render on change, and in-sync across every hook instance + tab.
 * These hooks are the single seam to swap for a real API/db later.
 */

const PREFS_KEY = "foodswipe.preferences.v1";
// v2: bumped for the v1.7 launch-demo seed refresh so accumulated swipe history
// (which referenced the pre-refresh restaurant set) starts clean and the full
// refreshed deck reappears. NOTE: saves share this store, so this also resets
// saved restaurants — accepted for the dataset refresh. A future version should
// split seen/swiped from saved/favorites so a refresh needn't clear saves.
const SWIPES_KEY = "foodswipe.swipes.v2";
const MANUAL_VIDEOS_KEY = "foodswipe.manualVideos.v1";

export const DEFAULT_PREFERENCES: UserPreferences = {
  location: "Washington, DC",
  maxDistanceMiles: 5,
  budget: 3,
  cravings: [],
  vibes: [],
  dietary: [],
};

// Stable fallback references — required so server/empty snapshots don't loop.
const EMPTY_SWIPES: SwipeAction[] = [];
const EMPTY_MANUAL: ManualVideoEntry[] = [];

/*
  Runtime normalization. localStorage is untrusted (old schema, partial writes,
  user tampering) so we never blindly cast it to our domain types. These coerce
  whatever is stored into a known-good shape, falling back field-by-field.
*/
function asStringArray<T extends string>(v: unknown): T[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as T[]) : [];
}

function normalizePreferences(v: unknown): UserPreferences {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const distance = [1, 3, 5, 10].includes(o.maxDistanceMiles as number)
    ? (o.maxDistanceMiles as 1 | 3 | 5 | 10)
    : DEFAULT_PREFERENCES.maxDistanceMiles;
  const budget = [1, 2, 3, 4].includes(o.budget as number)
    ? (o.budget as PriceLevel)
    : DEFAULT_PREFERENCES.budget;
  return {
    location:
      typeof o.location === "string" ? o.location : DEFAULT_PREFERENCES.location,
    maxDistanceMiles: distance,
    budget,
    cravings: asStringArray<Craving>(o.cravings),
    vibes: asStringArray<Vibe>(o.vibes),
    dietary: asStringArray<Dietary>(o.dietary),
  };
}

function normalizeSwipes(v: unknown): SwipeAction[] {
  if (!Array.isArray(v)) return EMPTY_SWIPES;
  const valid = v.filter((s): s is SwipeAction => {
    if (!s || typeof s !== "object") return false;
    const r = s as Record<string, unknown>;
    return (
      typeof r.restaurantId === "string" &&
      (r.direction === "left" || r.direction === "right") &&
      typeof r.at === "number"
    );
  });
  return valid.length === v.length && valid.length === 0 ? EMPTY_SWIPES : valid;
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

const noopSubscribe = () => () => {};

/**
 * True once the client has hydrated. Lets screens defer localStorage-dependent
 * UI (e.g. the saved list) by one paint to avoid a flash of the empty state.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
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

/** Swipe history. Right = saved, left = skipped. */
export function useSwipes() {
  const swipes = useStoredValue(SWIPES_KEY, EMPTY_SWIPES, normalizeSwipes);

  const recordSwipe = useCallback(
    (restaurantId: string, direction: SwipeDirection) => {
      const prev = readCached(SWIPES_KEY, EMPTY_SWIPES, normalizeSwipes);
      writeJSON(SWIPES_KEY, [
        // a fresh decision replaces any prior one for this place
        ...prev.filter((s) => s.restaurantId !== restaurantId),
        { restaurantId, direction, at: Date.now() },
      ]);
    },
    [],
  );

  const removeSwipe = useCallback((restaurantId: string) => {
    const prev = readCached(SWIPES_KEY, EMPTY_SWIPES, normalizeSwipes);
    writeJSON(
      SWIPES_KEY,
      prev.filter((s) => s.restaurantId !== restaurantId),
    );
  }, []);

  const resetSwipes = useCallback(() => writeJSON(SWIPES_KEY, EMPTY_SWIPES), []);

  const swipedIds = useMemo(() => swipes.map((s) => s.restaurantId), [swipes]);

  // Saved = right swipes, most recent first.
  const savedIds = useMemo(
    () =>
      [...swipes]
        .filter((s) => s.direction === "right")
        .sort((a, b) => b.at - a.at)
        .map((s) => s.restaurantId),
    [swipes],
  );

  return {
    swipes,
    swipedIds,
    savedIds,
    recordSwipe,
    removeSwipe,
    resetSwipes,
  };
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
