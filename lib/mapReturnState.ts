import { isAllowedMarket, type Market } from "./markets";
import type { MapFilter } from "./mapLocations";

/**
 * What the Map keeps while someone looks at a restaurant profile, so Back can put them where they were.
 * It lives in this tab's sessionStorage only. Nothing here is a URL, so a return can never be steered
 * to an arbitrary address, and every field is checked and bounded when read.
 */
export const MAP_RETURN_KEY = "foodswipe.map-return.v1";
export const MAP_RETURN_MAX_AGE_MS = 30 * 60_000;

export type MapReturnFocus = "profile" | "marker" | "index";

export interface MapReturnState {
  market: Market;
  /** Camera. */
  center: [lng: number, lat: number];
  zoom: number;
  /** Selected restaurant slug, if a preview was open. */
  selected: string | null;
  filter: MapFilter;
  /** Scroll position of the restaurant index. */
  listScroll: number;
  /** What to focus on return. */
  focus: MapReturnFocus;
  /**
   * True only after the person went Back from that restaurant's profile. A snapshot that was never
   * armed (they left the profile some other way) is discarded, so it cannot hijack a later visit.
   */
  armed: boolean;
  savedAt: number;
}

const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

/** The stored value if it is complete, recent and for this market; otherwise null. */
export function parseMapReturnState(raw: unknown, market: Market, now: number): MapReturnState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const center = value.center;
  if (!isAllowedMarket(value.market) || value.market !== market) return null;
  if (!Array.isArray(center) || center.length !== 2 || !finite(center[0], -180, 180) || !finite(center[1], -90, 90)) return null;
  if (!finite(value.zoom, 0, 22) || !finite(value.listScroll, 0, 1_000_000)) return null;
  if (value.filter !== "all" && value.filter !== "saved") return null;
  if (value.focus !== "profile" && value.focus !== "marker" && value.focus !== "index") return null;
  if (typeof value.armed !== "boolean") return null;
  if (!finite(value.savedAt, 0, Number.MAX_SAFE_INTEGER) || now - value.savedAt > MAP_RETURN_MAX_AGE_MS || value.savedAt > now + 60_000) return null;
  const selected = value.selected;
  if (selected !== null && (typeof selected !== "string" || !selected || selected.length > 256 || selected.includes("\0"))) return null;
  return {
    market, center: [center[0], center[1]], zoom: value.zoom, selected, filter: value.filter,
    listScroll: value.listScroll, focus: value.focus, armed: value.armed, savedAt: value.savedAt,
  };
}

export function saveMapReturnState(state: MapReturnState): void {
  try {
    window.sessionStorage.setItem(MAP_RETURN_KEY, JSON.stringify(state));
  } catch {
    // Storage can be blocked; Back then opens the Map's normal first view.
  }
}

/**
 * Called by a profile when the person goes Back (the Back button, or the browser's back gesture). It arms the
 * snapshot only if it was saved for this very restaurant, so the Map restores it exactly once.
 */
export function armMapReturn(slug: string, now = Date.now()): void {
  try {
    const raw = window.sessionStorage.getItem(MAP_RETURN_KEY);
    if (!raw) return;
    const value = JSON.parse(raw) as { market?: unknown };
    if (!isAllowedMarket(value?.market)) return;
    const state = parseMapReturnState(value, value.market, now);
    if (state && state.selected === slug) saveMapReturnState({ ...state, armed: true });
  } catch {
    // Without storage the Map simply opens on its normal first view.
  }
}

/** Reads and always clears the stored state. Only an armed snapshot for this market is returned. */
export function takeMapReturnState(market: Market, now = Date.now()): MapReturnState | null {
  try {
    const raw = window.sessionStorage.getItem(MAP_RETURN_KEY);
    window.sessionStorage.removeItem(MAP_RETURN_KEY);
    const state = raw ? parseMapReturnState(JSON.parse(raw), market, now) : null;
    return state?.armed ? state : null;
  } catch {
    return null;
  }
}
