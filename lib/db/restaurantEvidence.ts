import { and, desc, eq, inArray } from "drizzle-orm";
import { normalizeMarket } from "@/lib/markets";
import type { EvidenceDocument } from "@/lib/websiteEvidence";
import { getDb } from "./index";
import { restaurantEvidenceDocuments, type RestaurantEvidenceRow } from "./schema";

/**
 * Tag Automation B4 — storage/read for bounded official-website evidence.
 * Server-only. The collect route WRITES here (admin-triggered); the AI suggest
 * path only READS. Stores cleaned text by reference to a source URL — never raw
 * HTML or media. Evidence is private review input, never shown publicly.
 */

const EVIDENCE_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type EvidenceSubject =
  | { type: "candidate"; candidateRestaurantId: string }
  | { type: "restaurant"; restaurantSlug: string };

export interface StoredEvidence {
  id: string;
  sourceUrl: string;
  sourceDomain: string | null;
  sourceType: string;
  title: string | null;
  cleanedText: string;
  fetchStatus: string;
  error: string | null;
  fetchedAt: string;
  expiresAt: string | null;
}

export interface EvidenceMeta {
  total: number;
  okDocs: number;
  latestFetchedAt: string | null;
  stale: boolean;
}

export type EvidenceMetaMap = Record<string, EvidenceMeta>;

function subjectWhere(subject: EvidenceSubject) {
  return subject.type === "candidate"
    ? and(
        eq(restaurantEvidenceDocuments.subjectType, "candidate"),
        eq(restaurantEvidenceDocuments.candidateRestaurantId, subject.candidateRestaurantId),
      )
    : and(
        eq(restaurantEvidenceDocuments.subjectType, "restaurant"),
        eq(restaurantEvidenceDocuments.restaurantSlug, subject.restaurantSlug),
      );
}

function rowToStored(row: RestaurantEvidenceRow): StoredEvidence {
  return {
    id: row.id,
    sourceUrl: row.sourceUrl,
    sourceDomain: row.sourceDomain ?? null,
    sourceType: row.sourceType,
    title: row.title ?? null,
    cleanedText: row.cleanedText,
    fetchStatus: row.fetchStatus,
    error: row.error ?? null,
    fetchedAt: row.fetchedAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

/**
 * Refresh stored evidence for a subject with a freshly-collected batch.
 *
 * The Neon HTTP driver used here does not support `db.transaction()`, but
 * `db.batch()` executes through Neon's transactional batch API. When a refresh
 * contains at least one readable evidence doc, replace the old batch atomically:
 * if the insert fails, the delete rolls back too. If a refresh contains only
 * blocked/error/empty audit docs, append those docs and keep previous readable
 * evidence so a failed refresh cannot strand the restaurant with zero evidence.
 * Writes ONLY the evidence table.
 */
export async function saveEvidenceForSubject(
  subject: EvidenceSubject,
  market: string | null | undefined,
  documents: EvidenceDocument[],
): Promise<number> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + EVIDENCE_FRESHNESS_MS);
  const mkt = normalizeMarket(market);

  if (documents.length === 0) return 0;
  const rows = documents.map((d) => ({
    id: crypto.randomUUID(),
    subjectType: subject.type,
    candidateRestaurantId: subject.type === "candidate" ? subject.candidateRestaurantId : null,
    restaurantSlug: subject.type === "restaurant" ? subject.restaurantSlug : null,
    market: mkt,
    sourceUrl: d.sourceUrl,
    sourceDomain: d.sourceDomain,
    sourceType: d.sourceType,
    title: d.title,
    cleanedText: d.cleanedText,
    fetchedAt,
    expiresAt,
    fetchStatus: d.fetchStatus,
    error: d.error,
  }));
  const hasReadableEvidence = rows.some((r) => r.fetchStatus === "ok" && r.cleanedText.trim().length > 0);

  if (hasReadableEvidence) {
    await db.batch([
      db.delete(restaurantEvidenceDocuments).where(subjectWhere(subject)),
      db.insert(restaurantEvidenceDocuments).values(rows),
    ]);
  } else {
    await db.insert(restaurantEvidenceDocuments).values(rows);
  }
  return rows.length;
}

/** OK, non-empty evidence docs for a subject (newest first) — for AI context. */
export async function getEvidenceForSubject(subject: EvidenceSubject): Promise<StoredEvidence[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select()
      .from(restaurantEvidenceDocuments)
      .where(subjectWhere(subject))
      .orderBy(desc(restaurantEvidenceDocuments.fetchedAt))
      .limit(10);
    return rows
      .map(rowToStored)
      .filter((d) => d.fetchStatus === "ok" && d.cleanedText.trim().length > 0);
  } catch {
    return [];
  }
}

/** Lightweight summary for the collect response / UI (counts + freshness). */
export async function getEvidenceMeta(subject: EvidenceSubject): Promise<EvidenceMeta> {
  const db = getDb();
  if (!db) return { total: 0, okDocs: 0, latestFetchedAt: null, stale: false };
  try {
    const rows = await db
      .select()
      .from(restaurantEvidenceDocuments)
      .where(subjectWhere(subject))
      .orderBy(desc(restaurantEvidenceDocuments.fetchedAt))
      .limit(10);
    const ok = rows.filter((r) => r.fetchStatus === "ok" && r.cleanedText.trim().length > 0);
    const latest = rows[0]?.fetchedAt ?? null;
    const stale = rows[0]?.expiresAt ? rows[0].expiresAt.getTime() < Date.now() : false;
    return {
      total: rows.length,
      okDocs: ok.length,
      latestFetchedAt: latest ? latest.toISOString() : null,
      stale,
    };
  } catch {
    return { total: 0, okDocs: 0, latestFetchedAt: null, stale: false };
  }
}

/** Batch candidate evidence summaries for admin dashboards; read-only, no fetches. */
export async function getCandidateEvidenceMetaMap(candidateIds: string[]): Promise<EvidenceMetaMap> {
  const db = getDb();
  if (!db || candidateIds.length === 0) return {};
  const out: EvidenceMetaMap = {};
  for (const id of candidateIds) {
    out[id] = { total: 0, okDocs: 0, latestFetchedAt: null, stale: false };
  }
  try {
    const rows = await db
      .select({
        candidateRestaurantId: restaurantEvidenceDocuments.candidateRestaurantId,
        cleanedText: restaurantEvidenceDocuments.cleanedText,
        fetchStatus: restaurantEvidenceDocuments.fetchStatus,
        fetchedAt: restaurantEvidenceDocuments.fetchedAt,
        expiresAt: restaurantEvidenceDocuments.expiresAt,
      })
      .from(restaurantEvidenceDocuments)
      .where(
        and(
          eq(restaurantEvidenceDocuments.subjectType, "candidate"),
          inArray(restaurantEvidenceDocuments.candidateRestaurantId, candidateIds),
        ),
      );
    for (const row of rows) {
      const id = row.candidateRestaurantId;
      if (!id || !out[id]) continue;
      const meta = out[id];
      meta.total += 1;
      if (row.fetchStatus === "ok" && row.cleanedText.trim().length > 0) meta.okDocs += 1;
      const prevLatest = meta.latestFetchedAt ? new Date(meta.latestFetchedAt).getTime() : 0;
      const rowFetched = row.fetchedAt.getTime();
      if (rowFetched >= prevLatest) {
        meta.latestFetchedAt = row.fetchedAt.toISOString();
        meta.stale = row.expiresAt ? row.expiresAt.getTime() < Date.now() : false;
      }
    }
    return out;
  } catch {
    return out;
  }
}
