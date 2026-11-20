import type { PlacePhoto } from "./placePhoto";

/**
 * How long a photo may take before the restaurant's logo or the existing
 * placeholder is shown underneath it. The photo keeps loading and replaces the
 * fallback the moment it has really loaded, so a slow connection never leaves a
 * blank area and a fast one never flashes a fallback.
 */
export const PHOTO_PATIENCE_MS = 2_000;

export type PhotoLoadPhase = "loading" | "slow" | "loaded" | "failed";

export interface PhotoLoadState {
  /** Which photo this state describes. Answers about any other photo are ignored. */
  key: string | null;
  phase: PhotoLoadPhase;
}

export interface PhotoLoadEvent {
  type: "load" | "error" | "slow" | "reset";
  key: string | null;
}

/** Identifies one specific photo, including its individual source link. */
export function photoLoadKey(photo: PlacePhoto | null | undefined): string | null {
  return photo ? JSON.stringify([photo.photoUri, photo.googleMapsUri]) : null;
}

export function initialPhotoLoad(key: string | null): PhotoLoadState {
  return { key, phase: "loading" };
}

export function reducePhotoLoad(state: PhotoLoadState, event: PhotoLoadEvent): PhotoLoadState {
  if (event.type === "reset") return state.key === event.key ? state : initialPhotoLoad(event.key);
  // A late answer about an earlier restaurant's photo must never touch the current one,
  // and there is nothing to answer for when there is no photo at all.
  if (event.key !== state.key || event.key === null) return state;
  const waiting = state.phase === "loading" || state.phase === "slow";
  switch (event.type) {
    case "slow":
      return state.phase === "loading" ? { ...state, phase: "slow" } : state;
    case "load":
      return waiting ? { ...state, phase: "loaded" } : state;
    case "error":
      return waiting ? { ...state, phase: "failed" } : state;
  }
}

/**
 * What to render for `photo` given what has actually happened to its image.
 * `displayed` is the only value that may be shown with a credit: it is set only
 * once this exact photo has loaded.
 */
export function selectPhotoLoad(state: PhotoLoadState, photo: PlacePhoto | null | undefined) {
  const current = photo && state.key === photoLoadKey(photo) ? photo : null;
  const attempted = current && state.phase !== "failed" ? current : null;
  const displayed = current && state.phase === "loaded" ? current : null;
  return {
    /** The photo to keep loading, or null once it failed or does not exist. */
    attempted,
    displayed,
    /** Show the logo or placeholder: no photo, a failed one, or one that is taking too long. */
    showFallback: !displayed && (attempted === null || state.phase === "slow"),
  };
}
