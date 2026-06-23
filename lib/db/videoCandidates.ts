import { and, desc, eq } from "drizzle-orm";
import type { LegalDisplayStatus, MatchConfidence, Platform, Video } from "@/lib/types";
import { LEGAL_STATUSES, normalizeVideo } from "@/lib/video";
import { getDb, isDbConfigured } from "./index";
import { videoCandidates, type VideoCandidateRow, type NewVideoCandidateRow } from "./schema";
import { insertVideo } from "./videos";
import { getAppRestaurantById } from "./restaurants";

export { isDbConfigured };

/**
 * Data access for the social-video REVIEW QUEUE (Phase 1). These rows never reach
 * a profile; only an explicit `attachVideoCandidate` of an APPROVED candidate
 * inserts into `restaurant_videos` (via the existing legal-safe `normalizeVideo`
 * + `insertVideo`). Status/platform/legal fields are re-validated on read +
 * write; unknown DB values coerce to safe defaults.
 */

export const VIDEO_CANDIDATE_STATUSES = ["needs_review", "approved", "rejected", "attached"] as const;
export type VideoCandidateStatus = (typeof VIDEO_CANDIDATE_STATUSES)[number];

export const VIDEO_CANDIDATE_PLATFORMS = ["tiktok", "instagram", "youtube"] as const;
export type VideoCandidatePlatform = (typeof VIDEO_CANDIDATE_PLATFORMS)[number];

export interface VideoCandidate {
  id: string;
  status: VideoCandidateStatus;
  platform: VideoCandidatePlatform;
  sourceUrl: string;
  normalizedSourceUrl: string;
  platformVideoId: string | null;
  restaurantSlug: string | null;
  candidateRestaurantId: string | null;
  proposedRestaurantName: string | null;
  creatorHandle: string | null;
  creatorName: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  embedUrl: string | null;
  attributionText: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  sourceFetchedAt: string | null;
  sourceExpiresAt: string | null;
  matchConfidence: number | null;
  matchReasons: string[];
  legalDisplayStatus: LegalDisplayStatus;
  resolverStatus: string;
  resolverError: string | null;
  reviewNotes: string | null;
  attachedVideoId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---- coercion (untrusted body + untrusted DB rows) ----
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
function optConfidence(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.min(Math.max(Math.round(v), 0), 100)
    : null;
}
function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function rowToCandidate(row: VideoCandidateRow): VideoCandidate {
  return {
    id: row.id,
    status: inSet(VIDEO_CANDIDATE_STATUSES, row.status) ? row.status : "needs_review",
    // platform is always written valid; coerce defensively if a DB value is junk.
    platform: inSet(VIDEO_CANDIDATE_PLATFORMS, row.platform) ? row.platform : "youtube",
    sourceUrl: row.sourceUrl,
    normalizedSourceUrl: row.normalizedSourceUrl,
    platformVideoId: row.platformVideoId ?? null,
    restaurantSlug: row.restaurantSlug ?? null,
    candidateRestaurantId: row.candidateRestaurantId ?? null,
    proposedRestaurantName: row.proposedRestaurantName ?? null,
    creatorHandle: row.creatorHandle ?? null,
    creatorName: row.creatorName ?? null,
    caption: row.caption ?? null,
    thumbnailUrl: row.thumbnailUrl ?? null,
    embedUrl: row.embedUrl ?? null,
    attributionText: row.attributionText ?? null,
    publishedAt: isoOrNull(row.publishedAt),
    discoveredAt: row.discoveredAt.toISOString(),
    sourceFetchedAt: isoOrNull(row.sourceFetchedAt),
    sourceExpiresAt: isoOrNull(row.sourceExpiresAt),
    matchConfidence: optConfidence(row.matchConfidence),
    matchReasons: row.matchReasons ?? [],
    legalDisplayStatus: inSet(LEGAL_STATUSES, row.legalDisplayStatus)
      ? row.legalDisplayStatus
      : "source-link-only",
    resolverStatus: row.resolverStatus,
    resolverError: row.resolverError ?? null,
    reviewNotes: row.reviewNotes ?? null,
    attachedVideoId: row.attachedVideoId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface CreateVideoCandidateInput {
  platform: VideoCandidatePlatform;
  sourceUrl: string;
  normalizedSourceUrl: string;
  platformVideoId?: string | null;
  restaurantSlug?: string | null;
  candidateRestaurantId?: string | null;
  proposedRestaurantName?: string | null;
  creatorHandle?: string | null;
  creatorName?: string | null;
  caption?: string | null;
  thumbnailUrl?: string | null;
  embedUrl?: string | null;
  attributionText?: string | null;
  publishedAt?: string | null;
  sourceFetchedAt?: string | null;
  matchConfidence?: number | null;
  matchReasons?: string[];
  legalDisplayStatus: LegalDisplayStatus;
  resolverStatus: string;
  resolverError?: string | null;
  reviewNotes?: string | null;
}

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Insert a candidate (status "needs_review"). Idempotent on the source URL: if a
 * candidate with the same normalized URL (or platform+videoId) already exists,
 * returns it with `duplicate: true` instead of failing.
 */
export async function createVideoCandidate(
  input: CreateVideoCandidateInput,
): Promise<{ candidate: VideoCandidate; duplicate: boolean }> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");

  const existing = await findExisting(input.normalizedSourceUrl, input.platform, input.platformVideoId ?? null);
  if (existing) return { candidate: existing, duplicate: true };

  // Resolver-fetched third-party metadata is expiring: give it a 30-day freshness
  // window (mirrors the candidate_restaurants convention) so a later refresh job
  // can tell stale rows apart. Null when nothing was fetched.
  const fetchedAt = toDate(input.sourceFetchedAt);
  const FRESHNESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  const expiresAt = fetchedAt ? new Date(fetchedAt.getTime() + FRESHNESS_WINDOW_MS) : null;

  const values: NewVideoCandidateRow = {
    id: crypto.randomUUID(),
    status: "needs_review",
    platform: input.platform,
    sourceUrl: input.sourceUrl,
    normalizedSourceUrl: input.normalizedSourceUrl,
    platformVideoId: optStr(input.platformVideoId),
    restaurantSlug: optStr(input.restaurantSlug),
    candidateRestaurantId: optStr(input.candidateRestaurantId),
    proposedRestaurantName: optStr(input.proposedRestaurantName),
    creatorHandle: optStr(input.creatorHandle),
    creatorName: optStr(input.creatorName),
    caption: optStr(input.caption),
    thumbnailUrl: optStr(input.thumbnailUrl),
    embedUrl: optStr(input.embedUrl),
    attributionText: optStr(input.attributionText),
    publishedAt: toDate(input.publishedAt),
    sourceFetchedAt: fetchedAt,
    sourceExpiresAt: expiresAt,
    matchConfidence: optConfidence(input.matchConfidence),
    matchReasons: strArray(input.matchReasons),
    legalDisplayStatus: inSet(LEGAL_STATUSES, input.legalDisplayStatus)
      ? input.legalDisplayStatus
      : "source-link-only",
    resolverStatus: input.resolverStatus,
    resolverError: optStr(input.resolverError),
    reviewNotes: optStr(input.reviewNotes),
  };

  try {
    const [row] = await db.insert(videoCandidates).values(values).returning();
    return { candidate: rowToCandidate(row), duplicate: false };
  } catch {
    // Lost a race on a unique index — return the existing candidate.
    const again = await findExisting(input.normalizedSourceUrl, input.platform, input.platformVideoId ?? null);
    if (again) return { candidate: again, duplicate: true };
    throw new Error("Failed to create video candidate.");
  }
}

async function findExisting(
  normalizedSourceUrl: string,
  platform: string,
  platformVideoId: string | null,
): Promise<VideoCandidate | null> {
  const db = getDb();
  if (!db) return null;
  const byUrl = await db
    .select()
    .from(videoCandidates)
    .where(eq(videoCandidates.normalizedSourceUrl, normalizedSourceUrl))
    .limit(1);
  if (byUrl[0]) return rowToCandidate(byUrl[0]);
  if (platformVideoId) {
    const byId = await db
      .select()
      .from(videoCandidates)
      .where(and(eq(videoCandidates.platform, platform), eq(videoCandidates.platformVideoId, platformVideoId)))
      .limit(1);
    if (byId[0]) return rowToCandidate(byId[0]);
  }
  return null;
}

export interface ListVideoCandidateFilters {
  status?: string;
  platform?: string;
  restaurantSlug?: string;
}

export async function listVideoCandidates(filters: ListVideoCandidateFilters = {}): Promise<VideoCandidate[]> {
  const db = getDb();
  if (!db) return [];
  const conds = [];
  if (inSet(VIDEO_CANDIDATE_STATUSES, filters.status)) conds.push(eq(videoCandidates.status, filters.status));
  if (inSet(VIDEO_CANDIDATE_PLATFORMS, filters.platform)) conds.push(eq(videoCandidates.platform, filters.platform));
  const slug = optStr(filters.restaurantSlug);
  if (slug) conds.push(eq(videoCandidates.restaurantSlug, slug));
  const rows = await db
    .select()
    .from(videoCandidates)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(videoCandidates.createdAt));
  return rows.map(rowToCandidate);
}

export async function getVideoCandidate(id: string): Promise<VideoCandidate | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db.select().from(videoCandidates).where(eq(videoCandidates.id, id)).limit(1);
  return rows[0] ? rowToCandidate(rows[0]) : null;
}

/**
 * Additive patch — only the editable review fields are written. Immutable source
 * identity (sourceUrl/normalizedSourceUrl/platform/platformVideoId/resolver*) is
 * NOT editable here. Returns null if no row matched.
 */
export async function patchVideoCandidate(id: string, patch: unknown): Promise<VideoCandidate | null> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const b = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;

  const set: Partial<NewVideoCandidateRow> = { updatedAt: new Date() };
  // "attached" is reserved for the attach flow (which also writes restaurant_videos
  // + attachedVideoId) — a reviewer can only move between the review states here.
  if ("status" in b && inSet(["needs_review", "approved", "rejected"] as const, b.status)) {
    set.status = b.status;
  }
  if ("restaurantSlug" in b) set.restaurantSlug = optStr(b.restaurantSlug);
  if ("proposedRestaurantName" in b) set.proposedRestaurantName = optStr(b.proposedRestaurantName);
  if ("creatorHandle" in b) set.creatorHandle = optStr(b.creatorHandle);
  if ("caption" in b) set.caption = optStr(b.caption);
  if ("attributionText" in b) set.attributionText = optStr(b.attributionText);
  if ("matchConfidence" in b) set.matchConfidence = optConfidence(b.matchConfidence);
  if ("matchReasons" in b) set.matchReasons = strArray(b.matchReasons);
  if ("reviewNotes" in b) set.reviewNotes = optStr(b.reviewNotes);

  const [row] = await db.update(videoCandidates).set(set).where(eq(videoCandidates.id, id)).returning();
  return row ? rowToCandidate(row) : null;
}

export async function markVideoCandidateStatus(
  id: string,
  status: VideoCandidateStatus,
  notes?: string,
): Promise<VideoCandidate | null> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const set: Partial<NewVideoCandidateRow> = {
    status: inSet(VIDEO_CANDIDATE_STATUSES, status) ? status : "needs_review",
    updatedAt: new Date(),
  };
  if (notes !== undefined) set.reviewNotes = optStr(notes);
  const [row] = await db.update(videoCandidates).set(set).where(eq(videoCandidates.id, id)).returning();
  return row ? rowToCandidate(row) : null;
}

/* ---- attach (candidate → restaurant_videos), explicit + gated ---- */

const PLATFORM_MAP: Record<VideoCandidatePlatform, Platform> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

function toVideoMatchConfidence(n: number | null): MatchConfidence {
  if (n === null) return "manual";
  if (n >= 75) return "high";
  if (n >= 40) return "medium";
  if (n > 0) return "low";
  return "manual";
}

export type AttachResult =
  | { ok: true; videoId: string; candidate: VideoCandidate; alreadyAttached: boolean }
  | { ok: false; code: "no-db" }
  | { ok: false; code: "not-found" }
  | { ok: false; code: "not-approved"; status: string }
  | { ok: false; code: "missing-slug" }
  | { ok: false; code: "restaurant-not-found"; slug: string }
  | { ok: false; code: "invalid-video" }
  | { ok: false; code: "error" };

/**
 * Attach an APPROVED candidate to its restaurant by inserting into
 * `restaurant_videos` (through the existing legal-safe normalizeVideo + insertVideo).
 * Idempotent (an already-attached candidate returns its existing video). NEVER
 * attaches a rejected/needs_review candidate. Never auto-runs.
 */
export async function attachVideoCandidate(id: string): Promise<AttachResult> {
  const db = getDb();
  if (!db) return { ok: false, code: "no-db" };

  const candidate = await getVideoCandidate(id);
  if (!candidate) return { ok: false, code: "not-found" };

  if (candidate.status === "attached" && candidate.attachedVideoId) {
    return { ok: true, videoId: candidate.attachedVideoId, candidate, alreadyAttached: true };
  }
  if (candidate.status !== "approved") {
    return { ok: false, code: "not-approved", status: candidate.status };
  }
  if (!candidate.restaurantSlug) return { ok: false, code: "missing-slug" };

  const restaurant = await getAppRestaurantById(candidate.restaurantSlug);
  if (!restaurant) return { ok: false, code: "restaurant-not-found", slug: candidate.restaurantSlug };

  const platform = PLATFORM_MAP[candidate.platform];
  // normalizeVideo + enforceVideoInvariants apply the legal-safe rules: YouTube
  // keeps its nocookie embed; TikTok/Instagram (no allowlisted embed) become a
  // source-link-only real post that links out — never an iframe of their content.
  const video: Video | null = normalizeVideo({
    id: `vc-${candidate.id}`,
    platform,
    sourceUrl: candidate.sourceUrl,
    embedUrl: candidate.embedUrl ?? undefined,
    creatorHandle: candidate.creatorHandle ?? "@unknown",
    creatorDisplayName: candidate.creatorName ?? undefined,
    caption: candidate.caption ?? "",
    thumbnailUrl: candidate.thumbnailUrl ?? undefined,
    attributionText: candidate.attributionText ?? `${platform} post`,
    publishedAt: candidate.publishedAt ?? undefined,
    discoveredAt: candidate.discoveredAt,
    isRealSource: true,
    sourceType: "real-post",
    matchConfidence: toVideoMatchConfidence(candidate.matchConfidence),
    legalDisplayStatus: candidate.legalDisplayStatus,
  });
  if (!video) return { ok: false, code: "invalid-video" };

  // Atomic CLAIM: flip approved → attached in a single conditional UPDATE. Because
  // the predicate is WHERE status='approved', only ONE concurrent caller can win;
  // a racing/double-clicked request gets 0 rows and never reaches insertVideo, so
  // it can't create a duplicate restaurant_videos row. (restaurant_videos has no
  // dedupe key, and insertVideo always mints a fresh id, so this CAS is the lock.)
  const claimed = await db
    .update(videoCandidates)
    .set({ status: "attached", updatedAt: new Date() })
    .where(and(eq(videoCandidates.id, id), eq(videoCandidates.status, "approved")))
    .returning();
  if (claimed.length === 0) {
    // Lost the race (or status changed between our read and the claim).
    const cur = await getVideoCandidate(id);
    if (cur && cur.status === "attached") {
      return { ok: true, videoId: cur.attachedVideoId ?? "", candidate: cur, alreadyAttached: true };
    }
    return { ok: false, code: "not-approved", status: cur?.status ?? "unknown" };
  }

  // We own the claim — insert, then record the created video id.
  try {
    const saved = await insertVideo(restaurant.id, video);
    const updated = await recordAttachedVideoId(id, saved.id);
    return { ok: true, videoId: saved.id, candidate: updated ?? candidate, alreadyAttached: false };
  } catch {
    // Insert failed AFTER claiming — roll the status back to "approved" so the
    // candidate stays retryable rather than stuck "attached" with no video.
    try {
      await db
        .update(videoCandidates)
        .set({ status: "approved", attachedVideoId: null, updatedAt: new Date() })
        .where(eq(videoCandidates.id, id));
    } catch {
      // best-effort rollback
    }
    return { ok: false, code: "error" };
  }
}

/** Record the created restaurant_videos id on an already-claimed (attached) candidate. */
async function recordAttachedVideoId(id: string, attachedVideoId: string): Promise<VideoCandidate | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .update(videoCandidates)
    .set({ attachedVideoId, updatedAt: new Date() })
    .where(eq(videoCandidates.id, id))
    .returning();
  return row ? rowToCandidate(row) : null;
}
