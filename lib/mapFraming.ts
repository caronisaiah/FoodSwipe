import type { Market } from "./markets";
import type { MapLocation } from "./mapLocations";

export type Position = [lng: number, lat: number];
export type Bounds = [southwest: Position, northeast: Position];

export function boundsOf(points: readonly { position: Position }[]): Bounds | null {
  if (!points.length) return null;
  const lngs = points.map(({ position }) => position[0]);
  const lats = points.map(({ position }) => position[1]);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

/**
 * The first view of a market. New York opens on Lower Manhattan, where most approved restaurants are,
 * so streets and neighborhoods are readable. Fit collection still reaches every point. A market with
 * no frame, or one that would show fewer than two restaurants, opens on all of them.
 */
const FIRST_VIEW: Partial<Record<Market, Bounds>> = {
  nyc: [[-74.02, 40.70], [-73.97, 40.76]],
};

export function firstViewLocations(market: Market, locations: readonly MapLocation[]): MapLocation[] {
  const frame = FIRST_VIEW[market];
  if (!frame) return [...locations];
  const inside = locations.filter(({ position: [lng, lat] }) =>
    lng >= frame[0][0] && lng <= frame[1][0] && lat >= frame[0][1] && lat <= frame[1][1]);
  return inside.length >= 2 ? inside : [...locations];
}

/** A marker's position on screen, used to decide which markers would cover each other. */
export interface ScreenPoint<T> { item: T; x: number; y: number }

/**
 * Connected groups of markers whose 46 px targets would overlap, in screen pixels. Overlap is
 * transitive, so a chain of neighbors becomes one group. Groups are stable: members keep input order.
 */
export function groupOverlaps<T>(points: readonly ScreenPoint<T>[], size = 46): ScreenPoint<T>[][] {
  const parent = points.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (Math.abs(points[i].x - points[j].x) < size && Math.abs(points[i].y - points[j].y) < size) {
        parent[find(j)] = find(i);
      }
    }
  }
  const groups = new Map<number, ScreenPoint<T>[]>();
  points.forEach((point, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), point]);
  });
  return [...groups.values()];
}
