import { isAllowedMarket, type Market } from "./markets";
import type { SwipeDirection } from "./types";

export const LEGACY_SWIPES_KEY = "foodswipe.swipes.v2";

export interface Favorite {
  restaurantId: string;
  /** UTC epoch milliseconds, or null when the legacy timestamp was lost. */
  savedAt: number | null;
}

export interface FavoriteRemoval {
  readonly restaurantId: string;
  readonly revision: number;
}

interface FavoriteRecord extends Favorite {
  order: number;
  revision: number;
  removed: boolean;
}

interface MarketHistory {
  seenIds: string[];
  restarted: boolean;
}

export interface DiscoveryState {
  version: 1;
  favorites: FavoriteRecord[];
  nextRevision: number;
  legacySeenIds: string[];
  history: Partial<Record<Market, MarketHistory>>;
}

export type Mutation<T> = { state: DiscoveryState; value: T };

export const EMPTY_DISCOVERY: DiscoveryState = {
  version: 1, favorites: [], nextRevision: 0, legacySeenIds: [], history: {},
};

const emptyHistory: MarketHistory = { seenIds: [], restarted: false };
const validId = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const validCounter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function migrateLegacySwipes(raw: string | null): DiscoveryState {
  let actions: unknown;
  try {
    actions = raw === null ? [] : JSON.parse(raw);
  } catch {
    actions = [];
  }
  if (!Array.isArray(actions)) return EMPTY_DISCOVERY;

  const legacySeen = new Set<string>();
  const favorites = new Map<string, FavoriteRecord>();
  actions.forEach((action: unknown, order) => {
    if (!action || typeof action !== "object") return;
    const { restaurantId, direction, at } = action as Record<string, unknown>;
    if (!validId(restaurantId) || (direction !== "left" && direction !== "right")) return;
    legacySeen.add(restaurantId);
    if (direction !== "right") return;

    const savedAt = validCounter(at) ? at : null;
    const prior = favorites.get(restaurantId);
    if (!prior || (savedAt ?? -1) > (prior.savedAt ?? -1)) {
      favorites.set(restaurantId, { restaurantId, savedAt, order, revision: order, removed: false });
    }
  });

  return {
    ...EMPTY_DISCOVERY, favorites: [...favorites.values()], legacySeenIds: [...legacySeen],
    nextRevision: actions.length,
  };
}

/** An unreadable canonical record must never trigger a fresh legacy import. */
export function isDiscoveryState(value: unknown): value is DiscoveryState {
  if (!value || typeof value !== "object") return false;
  const state = value as DiscoveryState;
  if (
    state.version !== 1 || !validCounter(state.nextRevision) || !Array.isArray(state.favorites) ||
    !Array.isArray(state.legacySeenIds) || !state.legacySeenIds.every(validId) ||
    !state.history || typeof state.history !== "object" || Array.isArray(state.history)
  ) return false;
  const favoriteIds = new Set<string>();
  for (const record of state.favorites) {
    if (!record || !validId(record.restaurantId) || favoriteIds.has(record.restaurantId) ||
      (record.savedAt !== null && !validCounter(record.savedAt)) ||
      !validCounter(record.order) || !validCounter(record.revision) ||
      record.order > record.revision || record.revision >= state.nextRevision ||
      typeof record.removed !== "boolean") return false;
    favoriteIds.add(record.restaurantId);
  }
  return Object.entries(state.history).every(([market, history]) =>
    isAllowedMarket(market) && history && typeof history.restarted === "boolean" &&
    Array.isArray(history.seenIds) && history.seenIds.every(validId),
  );
}

export function selectFavorites(state: DiscoveryState): Favorite[] {
  return state.favorites
    .filter(({ removed }) => !removed)
    .sort((a, b) => (b.savedAt ?? -1) - (a.savedAt ?? -1) || a.order - b.order)
    .map(({ restaurantId, savedAt }) => ({ restaurantId, savedAt }));
}

export function selectSeen(state: DiscoveryState, market: Market): string[] {
  const history = state.history[market] ?? emptyHistory;
  return history.restarted ? history.seenIds : [...new Set([...state.legacySeenIds, ...history.seenIds])];
}

function replaceFavorite(state: DiscoveryState, favorite: FavoriteRecord): DiscoveryState {
  return {
    ...state,
    nextRevision: state.nextRevision + 1,
    favorites: [...state.favorites.filter(({ restaurantId }) => restaurantId !== favorite.restaurantId), favorite],
  };
}

export function addFavorite(state: DiscoveryState, restaurantId: string, savedAt: number): Mutation<boolean> {
  if (!validId(restaurantId) || state.favorites.some((r) => r.restaurantId === restaurantId && !r.removed)) {
    return { state, value: false };
  }
  const revision = state.nextRevision;
  return {
    state: replaceFavorite(state, { restaurantId, savedAt, order: revision, revision, removed: false }),
    value: true,
  };
}

export function removeFavorite(state: DiscoveryState, restaurantId: string): Mutation<FavoriteRemoval | null> {
  const favorite = state.favorites.find((r) => r.restaurantId === restaurantId && !r.removed);
  if (!favorite) return { state, value: null };
  const revision = state.nextRevision;
  return {
    state: replaceFavorite(state, { ...favorite, removed: true, revision }),
    value: { restaurantId, revision },
  };
}

export function undoFavorite(state: DiscoveryState, receipt: FavoriteRemoval): Mutation<boolean> {
  const favorite = state.favorites.find(({ restaurantId }) => restaurantId === receipt.restaurantId);
  if (!favorite?.removed || favorite.revision !== receipt.revision) return { state, value: false };
  return {
    state: replaceFavorite(state, { ...favorite, removed: false, revision: state.nextRevision }),
    value: true,
  };
}

export function recordSwipe(
  state: DiscoveryState, market: Market, restaurantId: string, direction: SwipeDirection, at: number,
): Mutation<boolean> {
  if (!validId(restaurantId)) return { state, value: false };
  const result = direction === "right" ? addFavorite(state, restaurantId, at) : { state, value: false };
  const history = state.history[market] ?? emptyHistory;
  if (history.seenIds.includes(restaurantId)) return result;
  return {
    ...result,
    state: {
      ...result.state,
      history: { ...state.history, [market]: { ...history, seenIds: [...history.seenIds, restaurantId] } },
    },
  };
}

export function restartMarket(state: DiscoveryState, market: Market): Mutation<void> {
  const history = state.history[market];
  if (history?.restarted && history.seenIds.length === 0) return { state, value: undefined };
  return {
    state: { ...state, history: { ...state.history, [market]: { restarted: true, seenIds: [] } } },
    value: undefined,
  };
}
