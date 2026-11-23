import { and, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "./index";
import { candidateRestaurants, restaurants } from "./schema";
import { normalizeMarket } from "@/lib/markets";
import type { IdentityRecord } from "@/lib/duplicateWarnings";
import type { CandidateRef, PublishedRef } from "@/lib/videoAssociation";

/**
 * Read-only identity lookups for duplicate hints, Place ID conflicts and the restaurant selector.
 * Nothing here writes.
 */

/** Light identity rows for every candidate and every DB-published restaurant (draft, approved, hidden...). */
export async function listIdentityRecords(): Promise<IdentityRecord[]> {
  const db = getDb();
  if (!db) return [];
  const [cands, pubs] = await Promise.all([
    db.select({
      id: candidateRestaurants.id, name: candidateRestaurants.name, address: candidateRestaurants.address,
      market: candidateRestaurants.market, status: candidateRestaurants.status, slug: candidateRestaurants.slug,
      googlePlaceId: candidateRestaurants.googlePlaceId,
    }).from(candidateRestaurants),
    db.select({
      id: restaurants.id, name: restaurants.name, address: restaurants.address, market: restaurants.market,
      status: restaurants.status, slug: restaurants.slug, googlePlaceId: restaurants.googlePlaceId,
    }).from(restaurants),
  ]);
  return [
    ...cands.map((r) => ({ kind: "candidate" as const, ...r, market: normalizeMarket(r.market) })),
    ...pubs.map((r) => ({ kind: "published" as const, ...r, market: normalizeMarket(r.market) })),
  ];
}

/** The existing record (candidate or published, any status) that already owns this Google Place ID. */
export async function findPlaceIdConflict(googlePlaceId: string, excludeCandidateId?: string): Promise<IdentityRecord | null> {
  const db = getDb();
  if (!db || !googlePlaceId) return null;
  const [cand] = await db.select().from(candidateRestaurants)
    .where(eq(candidateRestaurants.googlePlaceId, googlePlaceId)).limit(2);
  if (cand && cand.id !== excludeCandidateId) {
    return { kind: "candidate", id: cand.id, name: cand.name, address: cand.address, market: normalizeMarket(cand.market), status: cand.status, slug: cand.slug, googlePlaceId: cand.googlePlaceId };
  }
  const [pub] = await db.select().from(restaurants).where(eq(restaurants.googlePlaceId, googlePlaceId)).limit(1);
  if (pub) {
    return { kind: "published", id: pub.id, name: pub.name, address: pub.address, market: normalizeMarket(pub.market), status: pub.status, slug: pub.slug, googlePlaceId: pub.googlePlaceId };
  }
  return null;
}

export interface PromotedRestaurant { id: string; slug: string; status: string; market: string }

/** The published restaurant created from this candidate, if any (unique per candidate). */
export async function getPromotedRestaurantForCandidate(candidateId: string): Promise<PromotedRestaurant | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db.select({ id: restaurants.id, slug: restaurants.slug, status: restaurants.status, market: restaurants.market })
    .from(restaurants).where(eq(restaurants.sourceCandidateId, candidateId)).limit(1);
  return row ? { ...row, market: normalizeMarket(row.market) } : null;
}

/** A DB-published restaurant by its public slug (published or hidden), or null. */
export async function getPublishedRestaurantBySlug(slug: string): Promise<(PromotedRestaurant & { name: string; sourceCandidateId: string | null }) | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db.select({
    id: restaurants.id, slug: restaurants.slug, status: restaurants.status, market: restaurants.market,
    name: restaurants.name, sourceCandidateId: restaurants.sourceCandidateId,
  }).from(restaurants).where(eq(restaurants.slug, slug)).limit(1);
  return row ? { ...row, market: normalizeMarket(row.market) } : null;
}

export interface RestaurantTarget {
  kind: "candidate" | "published";
  id: string;
  name: string;
  slug: string | null;
  market: string;
  address: string | null;
  status: string;
  googlePlaceId: string | null;
  /** For a candidate: the published slug once promoted. */
  publishedSlug: string | null;
}

/** Search candidates and published restaurants by name, address, slug or Place ID for the selector. */
export async function searchRestaurantTargets(query: string, opts: { market?: string; limit?: number } = {}): Promise<RestaurantTarget[]> {
  const db = getDb();
  if (!db) return [];
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const q = query.trim().replace(/[%_\\]/g, (c) => `\\${c}`);
  const like = `%${q}%`;
  const candWhere = q
    ? or(ilike(candidateRestaurants.name, like), ilike(candidateRestaurants.address, like), ilike(candidateRestaurants.slug, like), eq(candidateRestaurants.googlePlaceId, query.trim()))
    : undefined;
  const pubWhere = q
    ? or(ilike(restaurants.name, like), ilike(restaurants.address, like), ilike(restaurants.slug, like), eq(restaurants.googlePlaceId, query.trim()))
    : undefined;
  const marketCand = opts.market ? eq(candidateRestaurants.market, opts.market) : undefined;
  const marketPub = opts.market ? eq(restaurants.market, opts.market) : undefined;
  const [cands, pubs] = await Promise.all([
    db.select().from(candidateRestaurants).where(and(candWhere, marketCand)).orderBy(sql`${candidateRestaurants.createdAt} desc`).limit(limit),
    db.select().from(restaurants).where(and(pubWhere, marketPub)).orderBy(sql`${restaurants.createdAt} desc`).limit(limit),
  ]);
  const promoted = new Map<string, string>();
  if (cands.length) {
    const rows = await db.select({ sourceCandidateId: restaurants.sourceCandidateId, slug: restaurants.slug }).from(restaurants)
      .where(or(...cands.map((c) => eq(restaurants.sourceCandidateId, c.id))));
    for (const row of rows) if (row.sourceCandidateId) promoted.set(row.sourceCandidateId, row.slug);
  }
  return [
    ...cands.map((c): RestaurantTarget => ({ kind: "candidate", id: c.id, name: c.name, slug: c.slug, market: normalizeMarket(c.market), address: c.address, status: c.status, googlePlaceId: c.googlePlaceId, publishedSlug: promoted.get(c.id) ?? null })),
    ...pubs.map((p): RestaurantTarget => ({ kind: "published", id: p.id, name: p.name, slug: p.slug, market: normalizeMarket(p.market), address: p.address, status: p.status, googlePlaceId: p.googlePlaceId, publishedSlug: p.slug })),
  ].slice(0, limit * 2);
}

/** The published restaurant created from a candidate, in the shape the association rules use. */
export async function getPublishedRefBySourceCandidate(candidateId: string): Promise<PublishedRef | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db.select({
    id: restaurants.id, slug: restaurants.slug, name: restaurants.name, market: restaurants.market,
    status: restaurants.status, sourceCandidateId: restaurants.sourceCandidateId,
  }).from(restaurants).where(eq(restaurants.sourceCandidateId, candidateId)).limit(1);
  return row ? { ...row, market: normalizeMarket(row.market) } : null;
}

export async function getPublishedRefBySlug(slug: string): Promise<PublishedRef | null> {
  const row = await getPublishedRestaurantBySlug(slug);
  return row ? { id: row.id, slug: row.slug, name: row.name, market: row.market, status: row.status, sourceCandidateId: row.sourceCandidateId } : null;
}

export async function getCandidateRef(id: string): Promise<CandidateRef | null> {
  const db = getDb();
  if (!db || !id) return null;
  const [row] = await db.select({
    id: candidateRestaurants.id, name: candidateRestaurants.name, slug: candidateRestaurants.slug,
    market: candidateRestaurants.market, status: candidateRestaurants.status,
  }).from(candidateRestaurants).where(eq(candidateRestaurants.id, id)).limit(1);
  return row ? { ...row, market: normalizeMarket(row.market) } : null;
}
