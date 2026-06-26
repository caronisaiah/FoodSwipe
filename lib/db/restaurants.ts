import { and, desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "./index";
import { restaurants, type RestaurantRow } from "./schema";
import { getCandidateRestaurant, slugify } from "./candidates";
import { RESTAURANTS, getRestaurantById } from "@/lib/seed/restaurants";
import { filterCuisines, filterDietary, filterVibes } from "@/lib/vocab";
import { getMarketOrigin, normalizeMarket, type Market } from "@/lib/markets";
import type { Cuisine, Dietary, PriceLevel, Restaurant, Vibe, Video } from "@/lib/types";

export { isDbConfigured };

/**
 * Data access for PUBLISHED / live DB restaurants — created only via the explicit
 * promotion of a reviewed candidate. The app feed serves these ALONGSIDE the seed
 * (lib/seed/restaurants.ts); seed restaurants are never touched here.
 *
 * Honest data: arrays are re-validated against the controlled vocab on read
 * (never trust DB blindly); social-proof metrics stay at neutral 0 (no fake
 * "Trending"/"Top Choice"); each row gets ONE clearly-labelled placeholder video
 * so the `Restaurant` type's non-empty `videos` holds without inventing content.
 */

export const PUBLISHED_STATUSES = ["published", "hidden"] as const;
export type PublishedStatus = (typeof PUBLISHED_STATUSES)[number];

// distanceMiles is a real geographic estimate from the row's MARKET origin
// (honest), not a fabricated metric. The origin is resolved per-market via
// lib/markets (getMarketOrigin), defaulting to DC — see Slice A1.

/** Admin-facing normalized row (includes status + provenance + uuid). */
export interface PublishedRestaurantAdmin {
  id: string;
  slug: string;
  name: string;
  market: Market;
  neighborhood: string;
  address: string;
  googlePlaceId: string | null;
  websiteDomain: string | null;
  lat: number | null;
  lng: number | null;
  distanceMiles: number;
  priceLevel: number;
  cuisineTags: Cuisine[];
  dietaryTags: Dietary[];
  vibeTags: Vibe[];
  dishHighlights: string[];
  bestFor: Vibe[];
  reasonText: string;
  status: PublishedStatus;
  sourceCandidateId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

function clampPrice(v: number | null): PriceLevel {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 2;
  return Math.min(Math.max(n, 1), 4) as PriceLevel;
}

function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // miles
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.sqrt(s)) * 10) / 10;
}

/** A single honest placeholder clip so the non-empty `videos` tuple holds. */
function placeholderVideo(name: string): Video {
  return {
    id: "placeholder",
    platform: "Web",
    creatorHandle: "@foodswipe",
    caption: `${name} — preview`,
    attributionText: "Source placeholder — no third-party content",
    isRealSource: false,
    sourceType: "placeholder",
    matchConfidence: "manual",
    legalDisplayStatus: "placeholder-only",
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** DB row → public `Restaurant` (id = slug). Vocab re-validated; metrics neutral. */
function rowToRestaurant(row: RestaurantRow): Restaurant {
  return {
    id: row.slug,
    name: row.name,
    market: normalizeMarket(row.market),
    neighborhood: row.neighborhood ?? "",
    address: row.address ?? "",
    googlePlaceId: row.googlePlaceId ?? undefined,
    websiteDomain: row.websiteDomain ?? undefined,
    lat: row.lat ?? 0,
    lng: row.lng ?? 0,
    distanceMiles: typeof row.distanceMiles === "number" ? row.distanceMiles : 0,
    priceLevel: clampPrice(row.priceLevel),
    cuisineTags: filterCuisines(row.cuisineTags),
    dietaryTags: filterDietary(row.dietaryTags),
    vibeTags: filterVibes(row.vibeTags),
    dishHighlights: Array.isArray(row.dishHighlights)
      ? row.dishHighlights.filter((d): d is string => typeof d === "string" && d.trim().length > 0).map((d) => d.trim())
      : [],
    bestFor: filterVibes(row.bestFor),
    reasonText: row.reasonText ?? "",
    // Neutral internal placeholders — never real user metrics, never fabricated.
    trendScore: row.trendScore ?? 0,
    vibeScore: row.vibeScore ?? 0,
    videoCount: row.videoCount ?? 0,
    recentVideoCount: row.recentVideoCount ?? 0,
    saveCount: row.saveCount ?? 0,
    videos: [placeholderVideo(row.name)],
  };
}

function rowToAdmin(row: RestaurantRow): PublishedRestaurantAdmin {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    market: normalizeMarket(row.market),
    neighborhood: row.neighborhood ?? "",
    address: row.address ?? "",
    googlePlaceId: row.googlePlaceId ?? null,
    websiteDomain: row.websiteDomain ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    distanceMiles: typeof row.distanceMiles === "number" ? row.distanceMiles : 0,
    priceLevel: clampPrice(row.priceLevel),
    cuisineTags: filterCuisines(row.cuisineTags),
    dietaryTags: filterDietary(row.dietaryTags),
    vibeTags: filterVibes(row.vibeTags),
    dishHighlights: Array.isArray(row.dishHighlights)
      ? row.dishHighlights.filter((d): d is string => typeof d === "string" && d.trim().length > 0).map((d) => d.trim())
      : [],
    bestFor: filterVibes(row.bestFor),
    reasonText: row.reasonText ?? "",
    status: row.status === "hidden" ? "hidden" : "published",
    sourceCandidateId: row.sourceCandidateId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  };
}

/**
 * Published (visible) restaurants for the feed. Empty on no-DB/error (seed-safe).
 * An optional `market` filter narrows to one market; omitted = all markets
 * (current behavior). A1 keeps this backward-compatible — callers that pass
 * nothing are unchanged.
 */
export async function getPublishedRestaurants(market?: Market): Promise<Restaurant[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const where = market
      ? and(eq(restaurants.status, "published"), eq(restaurants.market, market))
      : eq(restaurants.status, "published");
    const rows = await db
      .select()
      .from(restaurants)
      .where(where)
      .orderBy(desc(restaurants.createdAt));
    return rows.map(rowToRestaurant);
  } catch {
    return []; // never break the seed feed on a DB hiccup
  }
}

/** A single PUBLISHED restaurant by its public slug (hidden ones are not served). */
export async function getPublishedRestaurantBySlug(slug: string): Promise<Restaurant | null> {
  const db = getDb();
  if (!db) return null;
  const s = str(slug);
  if (!s) return null;
  try {
    const rows = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.slug, s))
      .limit(1);
    const row = rows[0];
    if (!row || row.status !== "published") return null;
    return rowToRestaurant(row);
  } catch {
    return null;
  }
}

/** All published restaurants (any status) for the admin editor. */
export async function listPublishedRestaurantsForAdmin(): Promise<PublishedRestaurantAdmin[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db.select().from(restaurants).orderBy(desc(restaurants.createdAt));
  return rows.map(rowToAdmin);
}

/** A single published restaurant (any status) by uuid — admin addressing. */
export async function getPublishedRestaurantById(id: string): Promise<PublishedRestaurantAdmin | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1);
  return rows[0] ? rowToAdmin(rows[0]) : null;
}

/** Build a slug unique across seed ids AND existing published slugs. */
async function uniquePublishedSlug(base: string): Promise<string> {
  const db = getDb();
  const taken = new Set<string>(RESTAURANTS.map((r) => r.id));
  if (db) {
    const rows = await db.select({ slug: restaurants.slug }).from(restaurants);
    for (const r of rows) if (r.slug) taken.add(r.slug);
  }
  const root = slugify(base) || "restaurant";
  if (!taken.has(root)) return root;
  let i = 2;
  while (taken.has(`${root}-${i}`)) i++;
  return `${root}-${i}`;
}

export type PromoteResult =
  | { ok: true; restaurant: PublishedRestaurantAdmin }
  | { ok: false; code: "no-db" }
  | { ok: false; code: "not-found" }
  | { ok: false; code: "not-approved"; status: string }
  | { ok: false; code: "incomplete"; missingFields: string[] }
  | { ok: false; code: "already-promoted"; restaurant: PublishedRestaurantAdmin }
  | { ok: false; code: "place-already-published"; restaurant: PublishedRestaurantAdmin }
  | { ok: false; code: "error" };

/** Required fields a candidate must have before it can become a feed restaurant. */
function missingFeedFields(c: {
  name: string | null;
  address: string | null;
  priceLevel: number | null;
  lat: number | null;
  lng: number | null;
  cuisineTags: string[];
  vibeTags: string[];
  bestFor: string[];
  reasonText: string | null;
}): string[] {
  const missing: string[] = [];
  if (!str(c.name)) missing.push("name");
  if (!str(c.address)) missing.push("address");
  if (!(typeof c.priceLevel === "number" && c.priceLevel >= 1 && c.priceLevel <= 4)) missing.push("priceLevel");
  if (typeof c.lat !== "number" || !Number.isFinite(c.lat)) missing.push("lat");
  if (typeof c.lng !== "number" || !Number.isFinite(c.lng)) missing.push("lng");
  if (filterCuisines(c.cuisineTags).length === 0) missing.push("cuisineTags");
  if (filterVibes(c.vibeTags).length === 0 && filterVibes(c.bestFor).length === 0) {
    missing.push("vibeTags|bestFor");
  }
  if (!str(c.reasonText)) missing.push("reasonText");
  return missing;
}

/**
 * Explicit promotion: a reviewed (status="approved") candidate becomes a
 * published feed restaurant. Validates required fields, blocks duplicates by
 * sourceCandidateId AND googlePlaceId, copies only reviewed/curated fields, sets
 * neutral metrics, and never publishes videos or mutates Google photo data.
 */
export async function promoteCandidateToRestaurant(candidateId: string): Promise<PromoteResult> {
  const db = getDb();
  if (!db) return { ok: false, code: "no-db" };

  const candidate = await getCandidateRestaurant(candidateId);
  if (!candidate) return { ok: false, code: "not-found" };
  if (candidate.status !== "approved") {
    return { ok: false, code: "not-approved", status: candidate.status };
  }

  const missingFields = missingFeedFields(candidate);
  if (missingFields.length > 0) return { ok: false, code: "incomplete", missingFields };

  // Dedupe: one published restaurant per candidate, and per Google Place ID.
  const existingBySource = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.sourceCandidateId, candidate.id))
    .limit(1);
  if (existingBySource[0]) {
    return { ok: false, code: "already-promoted", restaurant: rowToAdmin(existingBySource[0]) };
  }
  if (candidate.googlePlaceId) {
    const existingByPlace = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.googlePlaceId, candidate.googlePlaceId))
      .limit(1);
    if (existingByPlace[0]) {
      return { ok: false, code: "place-already-published", restaurant: rowToAdmin(existingByPlace[0]) };
    }
  }

  const now = new Date();
  const lat = candidate.lat as number;
  const lng = candidate.lng as number;
  // Distance from the CANDIDATE'S market origin (not always DC) — the core A1 fix.
  const market = normalizeMarket(candidate.market);
  const origin = getMarketOrigin(market);
  // Everything except the slug (recomputed per attempt to survive a slug race).
  const baseValues = {
    name: candidate.name,
    market,
    neighborhood: str(candidate.neighborhood) ?? "",
    address: str(candidate.address) ?? "",
    googlePlaceId: candidate.googlePlaceId,
    websiteDomain: candidate.websiteDomain,
    lat,
    lng,
    distanceMiles: haversineMiles(origin.lat, origin.lng, lat, lng),
    priceLevel: clampPrice(candidate.priceLevel),
    // Copy ONLY reviewed/curated fields, re-validated against the vocab.
    cuisineTags: filterCuisines(candidate.cuisineTags),
    dietaryTags: filterDietary(candidate.dietaryTags),
    vibeTags: filterVibes(candidate.vibeTags),
    bestFor: filterVibes(candidate.bestFor),
    dishHighlights: candidate.dishHighlights,
    reasonText: str(candidate.reasonText) ?? "",
    // Neutral placeholders — never fabricated social proof.
    trendScore: 0,
    vibeScore: 0,
    videoCount: 0,
    recentVideoCount: 0,
    saveCount: 0,
    sourceCandidateId: candidate.id,
    status: "published",
    publishedAt: now,
  };

  // Insert with conflict recovery across ALL three unique indexes. On a thrown
  // conflict we disambiguate by re-querying: an existing row for THIS candidate →
  // already-promoted; one for this Place ID → place-already-published; otherwise
  // a slug collision (concurrent promote of a different candidate) → recompute a
  // fresh slug and retry once. Duplicates are impossible regardless (the indexes
  // block a 2nd row); this just maps races to the right result.
  for (let attempt = 0; attempt < 2; attempt++) {
    const slug = await uniquePublishedSlug(candidate.slug ?? candidate.name);
    try {
      const [row] = await db
        .insert(restaurants)
        .values({ id: crypto.randomUUID(), slug, ...baseValues })
        .returning();
      return { ok: true, restaurant: rowToAdmin(row) };
    } catch {
      const bySource = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.sourceCandidateId, candidate.id))
        .limit(1);
      if (bySource[0]) {
        return { ok: false, code: "already-promoted", restaurant: rowToAdmin(bySource[0]) };
      }
      if (candidate.googlePlaceId) {
        const byPlace = await db
          .select()
          .from(restaurants)
          .where(eq(restaurants.googlePlaceId, candidate.googlePlaceId))
          .limit(1);
        if (byPlace[0]) {
          return { ok: false, code: "place-already-published", restaurant: rowToAdmin(byPlace[0]) };
        }
      }
      // Neither source nor place row exists → slug collision; loop retries once.
    }
  }
  return { ok: false, code: "error" };
}

/** Set a published restaurant's status to "hidden" (kept, not served to feed). */
export async function hidePublishedRestaurant(id: string): Promise<PublishedRestaurantAdmin | null> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const [row] = await db
    .update(restaurants)
    .set({ status: "hidden", updatedAt: new Date() })
    .where(eq(restaurants.id, id))
    .returning();
  return row ? rowToAdmin(row) : null;
}

/**
 * Edit a published restaurant (admin). Only fields present in the body are
 * written (additive); tag arrays are filtered to the controlled vocab so
 * impossible tags can't be persisted. `sourceCandidateId`, metrics, slug, and id
 * are NOT editable. Returns null if no row matched.
 */
export async function updatePublishedRestaurant(
  id: string,
  patch: unknown,
): Promise<PublishedRestaurantAdmin | null> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const b = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;

  const set: Partial<typeof restaurants.$inferInsert> = { updatedAt: new Date() };
  if ("name" in b) {
    const n = str(b.name);
    if (n) set.name = n;
  }
  if ("neighborhood" in b) set.neighborhood = str(b.neighborhood) ?? "";
  if ("websiteDomain" in b) set.websiteDomain = str(b.websiteDomain);
  if ("googlePlaceId" in b) set.googlePlaceId = str(b.googlePlaceId);
  // Required feed fields are never cleared below the promotion minimum: an empty
  // edit is ignored (keeps the existing value) rather than degrading a live row.
  if ("address" in b) {
    const a = str(b.address);
    if (a) set.address = a;
  }
  if ("reasonText" in b) {
    const rt = str(b.reasonText);
    if (rt) set.reasonText = rt;
  }
  if ("cuisineTags" in b) {
    const cz = filterCuisines(b.cuisineTags);
    if (cz.length > 0) set.cuisineTags = cz; // never strip a feed row to zero cuisines
  }
  // lat/lng only update to finite numbers (never nulled); when BOTH are set,
  // recompute distanceMiles so it stays consistent with the coordinates.
  let nextLat: number | undefined;
  let nextLng: number | undefined;
  if ("lat" in b && typeof b.lat === "number" && Number.isFinite(b.lat)) {
    set.lat = b.lat;
    nextLat = b.lat;
  }
  if ("lng" in b && typeof b.lng === "number" && Number.isFinite(b.lng)) {
    set.lng = b.lng;
    nextLng = b.lng;
  }
  if (nextLat !== undefined && nextLng !== undefined) {
    // Recompute from the row's OWN market origin (not always DC). market is set at
    // promotion and not editable here, so a quick lookup keeps distance honest.
    const cur = await db
      .select({ market: restaurants.market })
      .from(restaurants)
      .where(eq(restaurants.id, id))
      .limit(1);
    const origin = getMarketOrigin(cur[0]?.market);
    set.distanceMiles = haversineMiles(origin.lat, origin.lng, nextLat, nextLng);
  }
  if ("priceLevel" in b && typeof b.priceLevel === "number") set.priceLevel = clampPrice(b.priceLevel);
  if ("dietaryTags" in b) set.dietaryTags = filterDietary(b.dietaryTags);
  if ("vibeTags" in b) set.vibeTags = filterVibes(b.vibeTags);
  if ("bestFor" in b) set.bestFor = filterVibes(b.bestFor);
  if ("dishHighlights" in b) {
    set.dishHighlights = Array.isArray(b.dishHighlights)
      ? b.dishHighlights.filter((d): d is string => typeof d === "string" && d.trim().length > 0).map((d) => d.trim())
      : [];
  }
  if ("status" in b && (b.status === "published" || b.status === "hidden")) set.status = b.status;

  const [row] = await db
    .update(restaurants)
    .set(set)
    .where(eq(restaurants.id, id))
    .returning();
  return row ? rowToAdmin(row) : null;
}

/** Resolve a restaurant for the public app by id (seed first, then published DB). */
export async function getAppRestaurantById(id: string): Promise<Restaurant | null> {
  const seed = getRestaurantById(id);
  if (seed) return seed;
  return getPublishedRestaurantBySlug(id);
}

/**
 * Merged feed dataset: code-managed seed + published DB restaurants.
 *
 * Backward-compatible by default (no `market` → seed + all published). The seed
 * is the DC market, so an explicit non-DC filter returns ONLY that market's
 * published rows (seed excluded) — honest, possibly empty if none exist yet. A
 * "dc" filter still includes the seed. Public feed filtering/selector is A2;
 * this just makes `?market=` usable without changing default behavior.
 */
export async function getAllRestaurants(market?: Market): Promise<Restaurant[]> {
  const published = await getPublishedRestaurants(market);
  const includeSeed = !market || market === "dc";
  return includeSeed ? [...RESTAURANTS, ...published] : published;
}
