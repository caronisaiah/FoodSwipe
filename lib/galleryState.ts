import { GALLERY_MAX_PHOTOS } from "./clientGallery";
import type { PlacePhoto } from "./placePhoto";

/**
 * State of one restaurant's photo gallery. Photo 1 is the approved hero the page already
 * shows; the rest arrive only after the first gallery interaction. Everything an event
 * says is tied to `key` (restaurant + hero), so an answer that belongs to a restaurant
 * the user has swiped past can never change what is on screen.
 */
export type GalleryPhase = "idle" | "loading" | "ready" | "unavailable" | "error";

export interface GalleryState {
  key: string | null;
  heroId: string | null;
  phase: GalleryPhase;
  /** Photos after the hero, already validated against it. */
  extras: PlacePhoto[];
  /** Photos whose image failed to load. They stay out of the gallery. */
  dropped: string[];
  index: number;
  /** Which way the first interaction was heading, applied when the extras arrive. */
  pending: 1 | -1 | null;
}

export type GalleryEvent =
  | { type: "reset"; key: string | null; heroId: string | null }
  | { type: "request"; key: string | null; step: 1 | -1 }
  | { type: "loaded"; key: string | null; extras: PlacePhoto[] }
  | { type: "unavailable"; key: string | null }
  | { type: "failed"; key: string | null }
  | { type: "step"; key: string | null; step: 1 | -1 }
  | { type: "drop"; key: string | null; id: string };

export function galleryKey(restaurantId: string, hero: PlacePhoto | null | undefined): string | null {
  return hero ? JSON.stringify([restaurantId, hero.googleMapsUri]) : null;
}

export function initialGallery(key: string | null, heroId: string | null): GalleryState {
  return { key, heroId, phase: "idle", extras: [], dropped: [], index: 0, pending: null };
}

/** Identities of the photos that can be shown, hero first. */
export function visibleIds(state: GalleryState): string[] {
  const ids = [...(state.heroId ? [state.heroId] : []), ...state.extras.map((p) => p.googleMapsUri)];
  return ids.filter((id) => !state.dropped.includes(id)).slice(0, GALLERY_MAX_PHOTOS);
}

export function reduceGallery(state: GalleryState, event: GalleryEvent): GalleryState {
  if (event.type === "reset") {
    return state.key === event.key && state.heroId === event.heroId ? state : initialGallery(event.key, event.heroId);
  }
  // Answers about another restaurant, or about no photo at all, change nothing.
  if (event.key !== state.key || state.key === null) return state;

  switch (event.type) {
    case "request":
      // A failed request may be tried again by the next deliberate interaction, never automatically.
      return state.phase === "idle" || state.phase === "error"
        ? { ...state, phase: "loading", pending: event.step }
        : state;
    case "loaded": {
      if (state.phase !== "loading") return state;
      if (event.extras.length === 0) return { ...state, phase: "unavailable", extras: [], pending: null };
      const next: GalleryState = { ...state, phase: "ready", extras: event.extras, pending: null };
      const count = visibleIds(next).length;
      return { ...next, index: state.pending === -1 ? count - 1 : Math.min(1, count - 1) };
    }
    case "unavailable":
      return state.phase === "loading" ? { ...state, phase: "unavailable", pending: null } : state;
    case "failed":
      return state.phase === "loading" ? { ...state, phase: "error", pending: null } : state;
    case "step": {
      if (state.phase !== "ready") return state;
      const count = visibleIds(state).length;
      return count > 1 ? { ...state, index: (state.index + event.step + count) % count } : state;
    }
    case "drop": {
      if (state.dropped.includes(event.id) || !visibleIds(state).includes(event.id)) return state;
      const next = { ...state, dropped: [...state.dropped, event.id] };
      const count = visibleIds(next).length;
      return { ...next, index: Math.max(0, Math.min(state.index, count - 1)) };
    }
  }
}

/** What the screen needs: the shown photo, the confirmed count and whether to offer navigation. */
export function selectGallery(state: GalleryState, hero: PlacePhoto | null | undefined) {
  const byId = new Map<string, PlacePhoto>();
  if (hero) byId.set(hero.googleMapsUri, hero);
  for (const photo of state.extras) byId.set(photo.googleMapsUri, photo);
  const photos = visibleIds(state).flatMap((id) => (byId.has(id) ? [byId.get(id) as PlacePhoto] : []));
  const index = Math.min(state.index, Math.max(photos.length - 1, 0));
  return {
    photos,
    index,
    current: photos[index] ?? null,
    /** Only a loaded gallery confirms a count; before that nothing claims more than one photo. */
    confirmedCount: state.phase === "ready" ? photos.length : 1,
    canStep: state.phase === "ready" && photos.length > 1,
  };
}
