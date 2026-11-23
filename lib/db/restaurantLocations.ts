import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { OVERTURE_ATTRIBUTION_URL, type MapLocation, type MapNotice } from "@/lib/mapLocations";
import type { Market } from "@/lib/markets";
import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";
import { getRestaurantById } from "@/lib/seed/restaurants";
import { getDb } from "./index";
import { restaurantLocations, restaurants } from "./schema";
import { getRealVideoCounts } from "./videos";

const cdlaProviders = new Map([
  ["meta", "Meta"], ["microsoft", "Microsoft"], ["pinmeto", "PinMeTo"], ["krick", "Krick"],
  ["renderseo", "RenderSEO"], ["dac", "DAC"], ["brightquery", "BrightQuery"], ["birdeye", "Birdeye"],
  ["uberall", "Uberall"], ["opentravel", "OpenTravel Alliance"],
]);

function getNotices(evidence: unknown): MapNotice[] | null {
  if (!evidence || typeof evidence !== "object" || !("sources" in evidence) || !Array.isArray(evidence.sources)) {
    return null;
  }
  const notices = new Map<string, MapNotice>();
  for (const source of evidence.sources) {
    if (!source || typeof source.dataset !== "string") return null;
    const dataset = source.dataset.trim().toLowerCase();
    const cdlaProvider = cdlaProviders.get(dataset);
    if (cdlaProvider) {
      notices.set(dataset, { label: `${cdlaProvider} · CDLA Permissive 2.0`, url: "https://cdla.dev/permissive-2-0/" });
    } else if (dataset === "foursquare") {
      notices.set(dataset, {
        label: "Foursquare Labs, Inc. · Apache 2.0 · NOTICE",
        url: "/notices/overture-places.txt",
      });
    } else if (dataset === "alltheplaces") {
      notices.set(dataset, { label: "AllThePlaces · CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" });
    } else if (dataset !== "overture" && dataset !== "overture-signals") {
      // A new provider needs a license review before its records can be displayed.
      return null;
    }
  }
  if (!notices.size) return null;
  return [{ label: "Overture Maps Foundation · Places", url: OVERTURE_ATTRIBUTION_URL }, ...notices.values()];
}

export async function getApprovedMapLocations(market: Market): Promise<MapLocation[]> {
  const db = getDb();
  if (!db) throw new Error("Restaurant location store is unavailable.");
  const rows = await db.select({
    slug: restaurants.slug,
    name: restaurantLocations.displayName,
    area: restaurantLocations.displayArea,
    address: restaurantLocations.displayAddress,
    cuisine: restaurantLocations.cuisine,
    lat: restaurantLocations.lat,
    lng: restaurantLocations.lng,
    evidence: restaurantLocations.evidence,
  }).from(restaurantLocations).innerJoin(restaurants, eq(restaurantLocations.restaurantId, restaurants.id))
    .where(and(
      eq(restaurantLocations.status, "approved"),
      eq(restaurants.status, "published"),
      eq(restaurants.market, market),
    )).orderBy(asc(restaurantLocations.displayName));

  const includeSeeds = shouldIncludeSeedRestaurants();
  const locations = rows.flatMap((row): Omit<MapLocation, "videoCount">[] => {
    // A pin must link to the same profile that its slug resolves publicly.
    if (includeSeeds && getRestaurantById(row.slug)) return [];
    const name = row.name?.trim();
    const notices = getNotices(row.evidence);
    if (!name || !notices || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)
      || Math.abs(row.lat) > 85.051129 || Math.abs(row.lng) > 180 || (!row.lat && !row.lng)) return [];
    const { slug, area, address, cuisine, lng, lat } = row;
    return [{ slug, name, area, address, cuisine, position: [lng, lat], notices }];
  });
  const videoCounts = await getRealVideoCounts(locations.map(({ slug }) => slug));
  return locations.map((location) => ({ ...location, videoCount: videoCounts.get(location.slug) ?? 0 }));
}

/**
 * The review status of every independently sourced map location proposed for one published restaurant.
 * READ-ONLY; used by the admin review workspace to say whether the public map can show the restaurant.
 */
export async function getLocationStatusesForRestaurant(restaurantId: string): Promise<string[]> {
  const db = getDb();
  if (!db || !restaurantId) return [];
  const rows = await db.select({ status: restaurantLocations.status }).from(restaurantLocations)
    .where(eq(restaurantLocations.restaurantId, restaurantId));
  return rows.map((r) => r.status);
}
