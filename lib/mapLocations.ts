export const OVERTURE_ATTRIBUTION_URL = "https://docs.overturemaps.org/attribution/#places";

export type MapNotice = { label: string; url: string };
export type MapLocation = {
  slug: string;
  name: string;
  area: string | null;
  address: string | null;
  cuisine: string | null;
  videoCount: number;
  position: [lng: number, lat: number];
  notices: MapNotice[];
};

/** Which restaurants the map shows: every approved location, or only the saved ones among them. */
export type MapFilter = "all" | "saved";

/**
 * The collection is always a subset of the approved map locations. Saved ids that have no approved
 * coordinates are simply not in it: they stay saved, and nothing here reads or changes favorites.
 */
export function collectionFor(
  filter: MapFilter,
  locations: readonly MapLocation[],
  savedIds: ReadonlySet<string>,
): MapLocation[] {
  return filter === "saved" ? locations.filter(({ slug }) => savedIds.has(slug)) : [...locations];
}

/** The alphabetical index order shared by the list and the screen-reader names. */
export function indexOrder(locations: readonly MapLocation[]): MapLocation[] {
  return [...locations].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.slug.localeCompare(b.slug));
}

/** Directions to the verified destination. The maps app chooses the starting point. */
export function directionsUrl({ name, address }: Pick<MapLocation, "name" | "address">): string {
  const destination = address ? `${name}, ${address}` : name;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
