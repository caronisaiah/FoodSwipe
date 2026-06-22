import { desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "./index";
import {
  candidateRestaurants,
  ingestionJobs,
  restaurantSources,
  type CandidateRestaurantRow,
  type NewCandidateRestaurantRow,
} from "./schema";

export { isDbConfigured };

/**
 * Restaurant candidate ingestion (Phase 1) — data access for the REVIEW staging
 * area. These rows never reach `/feed`; the app still serves seed restaurants.
 * Status/source are re-validated on the way in and out (never trust raw DB/body
 * values), mirroring how `lib/db/videos.ts` re-normalizes persisted videos.
 */

export const CANDIDATE_STATUSES = [
  "candidate",
  "approved",
  "rejected",
  "needs_review",
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const CANDIDATE_SOURCES = ["manual", "google_places"] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

/** Normalized candidate as returned to the admin API (never raw row values). */
export interface CandidateRestaurant {
  id: string;
  slug: string | null;
  name: string;
  status: CandidateStatus;
  source: CandidateSource;
  googlePlaceId: string | null;
  websiteDomain: string | null;
  address: string | null;
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  priceLevel: number | null;
  cuisineTags: string[];
  dietaryTags: string[];
  vibeTags: string[];
  dishHighlights: string[];
  bestFor: string[];
  reasonText: string | null;
  reviewNotes: string | null;
  // ISO timestamps for source-derived metadata freshness; null for manual rows.
  sourceFetchedAt: string | null;
  sourceExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---- validation / coercion (untrusted body + untrusted DB rows) ----
function inSet<T extends string>(set: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (set as readonly string[]).includes(v);
}
function optStr(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
function strArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
    : [];
}
function optPrice(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 4 ? Math.round(v) : null;
}
function optCoord(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
/** Coerce a Date or ISO string to a Date; null for anything unusable. */
function optDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && v.trim().length > 0) {
    const d = new Date(v.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "") // drop non-ASCII (incl. combining diacritics) before slugging
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function rowToCandidate(row: CandidateRestaurantRow): CandidateRestaurant {
  return {
    id: row.id,
    slug: row.slug ?? null,
    name: row.name,
    status: inSet(CANDIDATE_STATUSES, row.status) ? row.status : "needs_review",
    source: inSet(CANDIDATE_SOURCES, row.source) ? row.source : "manual",
    googlePlaceId: row.googlePlaceId ?? null,
    websiteDomain: row.websiteDomain ?? null,
    address: row.address ?? null,
    neighborhood: row.neighborhood ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    priceLevel: row.priceLevel ?? null,
    cuisineTags: row.cuisineTags ?? [],
    dietaryTags: row.dietaryTags ?? [],
    vibeTags: row.vibeTags ?? [],
    dishHighlights: row.dishHighlights ?? [],
    bestFor: row.bestFor ?? [],
    reasonText: row.reasonText ?? null,
    reviewNotes: row.reviewNotes ?? null,
    sourceFetchedAt: row.sourceFetchedAt ? row.sourceFetchedAt.toISOString() : null,
    sourceExpiresAt: row.sourceExpiresAt ? row.sourceExpiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** All candidates (optionally filtered by status), newest first. */
export async function listCandidateRestaurants(
  status?: CandidateStatus,
): Promise<CandidateRestaurant[]> {
  const db = getDb();
  if (!db) return [];
  const rows = status
    ? await db
        .select()
        .from(candidateRestaurants)
        .where(eq(candidateRestaurants.status, status))
        .orderBy(desc(candidateRestaurants.createdAt))
    : await db
        .select()
        .from(candidateRestaurants)
        .orderBy(desc(candidateRestaurants.createdAt));
  return rows.map(rowToCandidate);
}

/** A single candidate by id, or null. */
export async function getCandidateRestaurant(
  id: string,
): Promise<CandidateRestaurant | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(candidateRestaurants)
    .where(eq(candidateRestaurants.id, id))
    .limit(1);
  return rows[0] ? rowToCandidate(rows[0]) : null;
}

/** Existing candidate with this Google Place ID, or null (for import dedupe). */
export async function getCandidateByGooglePlaceId(
  googlePlaceId: string,
): Promise<CandidateRestaurant | null> {
  const db = getDb();
  if (!db) return null;
  const id = optStr(googlePlaceId);
  if (!id) return null;
  const rows = await db
    .select()
    .from(candidateRestaurants)
    .where(eq(candidateRestaurants.googlePlaceId, id))
    .limit(1);
  return rows[0] ? rowToCandidate(rows[0]) : null;
}

/** All non-empty candidate slugs, as a set (for slug-collision protection). */
export async function getExistingCandidateSlugs(): Promise<Set<string>> {
  const db = getDb();
  if (!db) return new Set();
  const rows = await db
    .select({ slug: candidateRestaurants.slug })
    .from(candidateRestaurants);
  const set = new Set<string>();
  for (const r of rows) if (r.slug) set.add(r.slug);
  return set;
}

/**
 * Create a candidate from an untrusted body. Returns null if there's no usable
 * `name`. A fresh uuid + proposed slug are generated; status defaults to
 * "candidate" and source to "manual".
 */
export async function insertCandidateRestaurant(
  input: unknown,
): Promise<CandidateRestaurant | null> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  const name = optStr(b.name);
  if (!name) return null;

  const [row] = await db
    .insert(candidateRestaurants)
    .values({
      id: crypto.randomUUID(),
      slug: optStr(b.slug) ?? slugify(name),
      name,
      status: inSet(CANDIDATE_STATUSES, b.status) ? b.status : "candidate",
      source: inSet(CANDIDATE_SOURCES, b.source) ? b.source : "manual",
      googlePlaceId: optStr(b.googlePlaceId),
      websiteDomain: optStr(b.websiteDomain),
      address: optStr(b.address),
      neighborhood: optStr(b.neighborhood),
      lat: optCoord(b.lat),
      lng: optCoord(b.lng),
      priceLevel: optPrice(b.priceLevel),
      cuisineTags: strArray(b.cuisineTags),
      dietaryTags: strArray(b.dietaryTags),
      vibeTags: strArray(b.vibeTags),
      dishHighlights: strArray(b.dishHighlights),
      bestFor: strArray(b.bestFor),
      reasonText: optStr(b.reasonText),
      reviewNotes: optStr(b.reviewNotes) ?? optStr(b.notes),
      // Set by importers (e.g. Google Places); manual creates leave these null.
      sourceFetchedAt: optDate(b.sourceFetchedAt),
      sourceExpiresAt: optDate(b.sourceExpiresAt),
    })
    .returning();
  return rowToCandidate(row);
}

/**
 * Patch a candidate from an untrusted body — only fields actually present in the
 * body are written (so PATCH is additive). Returns null if no row matched.
 */
export async function updateCandidateRestaurant(
  id: string,
  patch: unknown,
): Promise<CandidateRestaurant | null> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const b = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;

  const set: Partial<NewCandidateRestaurantRow> = { updatedAt: new Date() };
  if ("name" in b) {
    const n = optStr(b.name);
    if (n) set.name = n;
  }
  if ("slug" in b) set.slug = optStr(b.slug);
  if ("status" in b && inSet(CANDIDATE_STATUSES, b.status)) set.status = b.status;
  if ("source" in b && inSet(CANDIDATE_SOURCES, b.source)) set.source = b.source;
  if ("googlePlaceId" in b) set.googlePlaceId = optStr(b.googlePlaceId);
  if ("websiteDomain" in b) set.websiteDomain = optStr(b.websiteDomain);
  if ("address" in b) set.address = optStr(b.address);
  if ("neighborhood" in b) set.neighborhood = optStr(b.neighborhood);
  if ("lat" in b) set.lat = optCoord(b.lat);
  if ("lng" in b) set.lng = optCoord(b.lng);
  if ("priceLevel" in b) set.priceLevel = optPrice(b.priceLevel);
  if ("cuisineTags" in b) set.cuisineTags = strArray(b.cuisineTags);
  if ("dietaryTags" in b) set.dietaryTags = strArray(b.dietaryTags);
  if ("vibeTags" in b) set.vibeTags = strArray(b.vibeTags);
  if ("dishHighlights" in b) set.dishHighlights = strArray(b.dishHighlights);
  if ("bestFor" in b) set.bestFor = strArray(b.bestFor);
  if ("reasonText" in b) set.reasonText = optStr(b.reasonText);
  if ("reviewNotes" in b) set.reviewNotes = optStr(b.reviewNotes);
  else if ("notes" in b) set.reviewNotes = optStr(b.notes);

  const [row] = await db
    .update(candidateRestaurants)
    .set(set)
    .where(eq(candidateRestaurants.id, id))
    .returning();
  return row ? rowToCandidate(row) : null;
}

/** Convenience review action: set a candidate's status (+ optional notes). */
export async function markCandidateRestaurantStatus(
  id: string,
  status: CandidateStatus,
  notes?: string,
): Promise<CandidateRestaurant | null> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const set: Partial<NewCandidateRestaurantRow> = {
    status: inSet(CANDIDATE_STATUSES, status) ? status : "needs_review",
    updatedAt: new Date(),
  };
  if (notes !== undefined) set.reviewNotes = optStr(notes);
  const [row] = await db
    .update(candidateRestaurants)
    .set(set)
    .where(eq(candidateRestaurants.id, id))
    .returning();
  return row ? rowToCandidate(row) : null;
}

/**
 * Record provenance for a candidate (kept separate from curated fields).
 * Best-effort: a provenance failure never fails the candidate write. Stores only
 * text metadata + reference URLs — never photo bytes/URLs or downloaded media.
 */
export async function addRestaurantSource(
  candidateId: string,
  input: {
    sourceType?: string;
    externalId?: string | null;
    rawName?: string | null;
    rawAddress?: string | null;
    url?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.insert(restaurantSources).values({
      id: crypto.randomUUID(),
      candidateId,
      sourceType: inSet(CANDIDATE_SOURCES, input.sourceType) ? input.sourceType : "manual",
      externalId: optStr(input.externalId),
      rawName: optStr(input.rawName),
      rawAddress: optStr(input.rawAddress),
      url: optStr(input.url),
      notes: optStr(input.notes),
    });
  } catch {
    // Provenance is best-effort — never block the candidate write on it.
  }
}

/**
 * Record an ingestion run for audit (e.g. a Google Places import). Best-effort:
 * a bookkeeping failure never fails an import that already created candidates.
 * Dry runs are intentionally NOT recorded here (the import route writes nothing
 * on a dry run); `dryRun` defaults false and exists to support future logging.
 */
export async function createIngestionJob(input: {
  source?: string;
  query?: string | null;
  status?: string;
  dryRun?: boolean;
  candidatesCreated?: number;
  skippedDuplicates?: number;
  error?: string | null;
  notes?: string | null;
}): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await db.insert(ingestionJobs).values({
      id: crypto.randomUUID(),
      source: optStr(input.source) ?? "manual",
      status: optStr(input.status) ?? "success",
      query: optStr(input.query),
      dryRun: input.dryRun === true,
      candidatesCreated: Number.isFinite(input.candidatesCreated)
        ? Math.max(0, Math.trunc(input.candidatesCreated as number))
        : 0,
      skippedDuplicates: Number.isFinite(input.skippedDuplicates)
        ? Math.max(0, Math.trunc(input.skippedDuplicates as number))
        : 0,
      error: optStr(input.error),
      notes: optStr(input.notes),
    });
  } catch {
    // Audit row is best-effort — never block on it.
  }
}
