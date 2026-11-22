import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { LegalDisplayStatus, MatchConfidence, Platform, Video } from "@/lib/types";
import { LEGAL_STATUSES, normalizeVideo } from "@/lib/video";
import { resolveAttachTarget } from "@/lib/videoAssociation";
import { getDb, isDbConfigured } from "./index";
import { getPublishedRefBySlug, getPublishedRefBySourceCandidate } from "./identity";
import { candidateRestaurants, restaurants, restaurantVideos, videoCandidates, type VideoCandidateRow, type NewVideoCandidateRow } from "./schema";

export { isDbConfigured };

/**
 * Data access for the social-video REVIEW QUEUE (Phase 1). These rows never reach
 * a profile; only an explicit `attachVideoCandidate` of an APPROVED candidate
 * inserts into `restaurant_videos` (via the existing legal-safe `normalizeVideo`).
 * Status/platform/legal fields are re-validated on read +
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

export interface CandidateVideoMeta {
  total: number;
  approvedOrAttached: number;
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

/** Batch review-video signal for candidate readiness; read-only, no resolving/attach. */
export async function getCandidateVideoMetaMap(
  candidates: { id: string; slug?: string | null }[],
): Promise<Record<string, CandidateVideoMeta>> {
  const db = getDb();
  if (!db || candidates.length === 0) return {};
  const out: Record<string, CandidateVideoMeta> = {};
  const ids = candidates.map((c) => c.id);
  const slugToIds = new Map<string, string[]>();
  for (const candidate of candidates) {
    out[candidate.id] = { total: 0, approvedOrAttached: 0 };
    if (candidate.slug) {
      const list = slugToIds.get(candidate.slug) ?? [];
      list.push(candidate.id);
      slugToIds.set(candidate.slug, list);
    }
  }
  const slugs = Array.from(slugToIds.keys());
  const conds = [];
  if (ids.length > 0) conds.push(inArray(videoCandidates.candidateRestaurantId, ids));
  if (slugs.length > 0) conds.push(inArray(videoCandidates.restaurantSlug, slugs));
  if (conds.length === 0) return out;

  try {
    const rows = await db
      .select({
        id: videoCandidates.id,
        status: videoCandidates.status,
        candidateRestaurantId: videoCandidates.candidateRestaurantId,
        restaurantSlug: videoCandidates.restaurantSlug,
      })
      .from(videoCandidates)
      .where(conds.length === 1 ? conds[0] : or(...conds));

    const seen = new Set<string>();
    for (const row of rows) {
      const matchedIds = new Set<string>();
      if (row.candidateRestaurantId && out[row.candidateRestaurantId]) matchedIds.add(row.candidateRestaurantId);
      if (row.restaurantSlug) {
        for (const id of slugToIds.get(row.restaurantSlug) ?? []) matchedIds.add(id);
      }
      for (const candidateId of matchedIds) {
        const key = `${candidateId}:${row.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out[candidateId].total += 1;
        if (row.status === "approved" || row.status === "attached") {
          out[candidateId].approvedOrAttached += 1;
        }
      }
    }
    return out;
  } catch {
    return out;
  }
}

export async function getVideoCandidate(id: string): Promise<VideoCandidate | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db.select().from(videoCandidates).where(eq(videoCandidates.id, id)).limit(1);
  return rows[0] ? rowToCandidate(rows[0]) : null;
}

/** Validated edit of a video candidate (see app/api/admin/videos/candidates/[id]). */
export interface VideoCandidatePatch {
  status?: "needs_review" | "approved" | "rejected";
  restaurantSlug?: string | null;
  candidateRestaurantId?: string | null;
  proposedRestaurantName?: string | null;
  creatorHandle?: string | null;
  creatorName?: string | null;
  caption?: string | null;
  attributionText?: string | null;
  matchConfidence?: number | null;
  matchReasons?: string[];
  reviewNotes?: string | null;
}

/**
 * Apply an ALREADY VALIDATED patch. Only the editable review fields can be written; immutable source
 * identity (sourceUrl/normalizedSourceUrl/platform/platformVideoId/resolver*) is not part of the type.
 * Attached candidates are locked to their recorded target.
 */
export async function patchVideoCandidate(id: string, patch: VideoCandidatePatch): Promise<
  { ok: true; candidate: VideoCandidate } | { ok: false; code: "not-found" | "attached" }
> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const set: Partial<NewVideoCandidateRow> = { updatedAt: new Date() };
  // "attached" is reserved for the attach flow (which also writes restaurant_videos + attachedVideoId).
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.restaurantSlug !== undefined) set.restaurantSlug = patch.restaurantSlug;
  if (patch.candidateRestaurantId !== undefined) set.candidateRestaurantId = patch.candidateRestaurantId;
  if (patch.proposedRestaurantName !== undefined) set.proposedRestaurantName = patch.proposedRestaurantName;
  if (patch.creatorHandle !== undefined) set.creatorHandle = patch.creatorHandle;
  if (patch.creatorName !== undefined) set.creatorName = patch.creatorName;
  if (patch.caption !== undefined) set.caption = patch.caption;
  if (patch.attributionText !== undefined) set.attributionText = patch.attributionText;
  if (patch.matchConfidence !== undefined) set.matchConfidence = patch.matchConfidence;
  if (patch.matchReasons !== undefined) set.matchReasons = patch.matchReasons;
  if (patch.reviewNotes !== undefined) set.reviewNotes = patch.reviewNotes;

  const [row] = await db.update(videoCandidates).set(set).where(and(
    eq(videoCandidates.id, id),
    ne(videoCandidates.status, "attached"),
    isNull(videoCandidates.attachedVideoId),
  )).returning();
  if (row) return { ok: true, candidate: rowToCandidate(row) };
  return { ok: false, code: (await getVideoCandidate(id)) ? "attached" : "not-found" };
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
  | { ok: true; videoId: string; candidate: VideoCandidate; alreadyAttached: boolean; restaurantSlug: string }
  | { ok: false; code: "no-db" }
  | { ok: false; code: "not-found" }
  | { ok: false; code: "target-changed" }
  | { ok: false; code: "target-required" }
  | { ok: false; code: "attachment-inconsistent" }
  | { ok: false; code: "not-approved"; status: string }
  | { ok: false; code: "restaurant-not-found"; slug: string }
  | { ok: false; code: "invalid-video" };

/** Status checks that do not depend on the target (idempotent retry, approved-only). */
function checkAttachmentState(candidate: VideoCandidate): AttachResult | null {
  if (candidate.status === "attached" && candidate.attachedVideoId) {
    return { ok: true, videoId: candidate.attachedVideoId, candidate, alreadyAttached: true, restaurantSlug: candidate.restaurantSlug ?? "" };
  }
  if (candidate.status === "attached" || candidate.attachedVideoId) {
    return { ok: false, code: "attachment-inconsistent" };
  }
  if (candidate.status !== "approved") {
    return { ok: false, code: "not-approved", status: candidate.status };
  }
  return null;
}

/**
 * Attach an approved candidate to the published restaurant it is LINKED to.
 *
 * The target is resolved from the candidate's stable `candidateRestaurantId` through
 * `restaurants.source_candidate_id` (so promotion, a suffixed slug, or a later restaurant reusing the
 * slug cannot redirect it), or from a stored published slug for restaurants with no candidate of origin.
 * `expectedRestaurantSlug` is the slug the human confirmed on screen; it must equal the resolved target.
 * A retry for an already attached candidate returns the recorded video.
 */
export async function attachVideoCandidate(id: string, expectedRestaurantSlug?: string): Promise<AttachResult> {
  const db = getDb();
  if (!db) return { ok: false, code: "no-db" };

  const candidate = await getVideoCandidate(id);
  if (!candidate) return { ok: false, code: "not-found" };
  const blocked = checkAttachmentState(candidate);
  if (blocked) return blocked;
  if (!expectedRestaurantSlug) return { ok: false, code: "target-required" };

  const target = await resolveAttachTarget(candidate, {
    publishedBySourceCandidate: getPublishedRefBySourceCandidate,
    publishedBySlug: getPublishedRefBySlug,
  });
  if (!target.ok) {
    if (target.code === "target-required") return { ok: false, code: "target-required" };
    if (target.code === "target-mismatch") return { ok: false, code: "target-changed" };
    return { ok: false, code: "restaurant-not-found", slug: candidate.restaurantSlug ?? expectedRestaurantSlug };
  }
  if (target.slug !== expectedRestaurantSlug) return { ok: false, code: "target-changed" };

  const platform = PLATFORM_MAP[candidate.platform];
  // normalizeVideo + enforceVideoInvariants apply the legal-safe rules (embed allowlist, link-only
  // fallbacks, no URLs for blocked statuses). Unchanged by this assignment.
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

  // Neon HTTP runs this as ONE atomic statement. The target is locked (FOR SHARE) and re-checked inside
  // the statement: the restaurant must still be published at that slug, and an id-linked candidate must
  // still point at the restaurant it was published from. If any condition no longer holds, nothing is
  // written and the caller gets target-changed.
  const updatedAt = new Date();
  const linkedCandidateId = candidate.candidateRestaurantId;
  const { rows } = await db.execute<{ id: string }>(sql`
    with target as (
      select slug, source_candidate_id from ${restaurants}
      where slug = ${target.slug} and status = 'published'
        and (${linkedCandidateId}::text is null or source_candidate_id = ${linkedCandidateId}::text)
      for share
    ), claimed as (
      update ${videoCandidates}
      set status = 'attached', attached_video_id = ${video.id},
          restaurant_slug = (select slug from target), updated_at = ${updatedAt.toISOString()}
      where id = ${id} and status = 'approved' and attached_video_id is null
        and exists (select 1 from target)
        and (candidate_restaurant_id is null or candidate_restaurant_id = (select source_candidate_id from target))
        and (restaurant_slug is null or restaurant_slug = (select slug from target))
      returning restaurant_slug
    )
    insert into ${restaurantVideos} (
      id, restaurant_id, platform, source_url, embed_url, creator_handle,
      creator_display_name, caption, thumbnail_url, attribution_text,
      published_at, discovered_at, is_real_source, source_type, match_confidence,
      legal_display_status
    )
    select ${video.id}, restaurant_slug, ${video.platform}, ${video.sourceUrl ?? null},
      ${video.embedUrl ?? null}, ${video.creatorHandle}, ${video.creatorDisplayName ?? null},
      ${video.caption}, ${video.thumbnailUrl ?? null}, ${video.attributionText},
      ${video.publishedAt ?? null}, ${video.discoveredAt ?? null}, ${video.isRealSource},
      ${video.sourceType}, ${video.matchConfidence}, ${video.legalDisplayStatus}
    from claimed
    returning id
  `);
  if (rows.length > 0) {
    return {
      ok: true,
      videoId: video.id,
      candidate: { ...candidate, status: "attached", attachedVideoId: video.id, restaurantSlug: target.slug, updatedAt: updatedAt.toISOString() },
      alreadyAttached: false,
      restaurantSlug: target.slug,
    };
  }

  const current = await getVideoCandidate(id);
  if (!current) return { ok: false, code: "not-found" };
  return checkAttachmentState(current) ?? { ok: false, code: "target-changed" };
}

/* ---- association summaries (read-only, for the admin UI and the migration mapping) ---- */

export interface AssociationSummary {
  kind: "candidate" | "published" | "legacy-slug" | "none";
  candidate: { id: string; name: string; slug: string | null; market: string; status: string } | null;
  publishedSlug: string | null;
  publishedStatus: string | null;
  /** True when attach could resolve a published restaurant right now. */
  attachable: boolean;
  /** For a slug-only (legacy) link: the single draft whose slug matches, offered as the ID to link to. */
  proposedCandidate: { id: string; name: string; slug: string | null; market: string; status: string } | null;
  problems: string[];
}

export async function getAssociationSummaries(
  candidates: VideoCandidate[],
): Promise<Record<string, AssociationSummary>> {
  const db = getDb();
  const out: Record<string, AssociationSummary> = {};
  if (!db || candidates.length === 0) return out;
  const ids = [...new Set(candidates.map((c) => c.candidateRestaurantId).filter((x): x is string => Boolean(x)))];
  const slugs = [...new Set(candidates.filter((c) => !c.candidateRestaurantId).map((c) => c.restaurantSlug).filter((x): x is string => Boolean(x)))];
  const candRows = ids.length || slugs.length
    ? await db.select().from(candidateRestaurants)
        .where(or(ids.length ? inArray(candidateRestaurants.id, ids) : undefined, slugs.length ? inArray(candidateRestaurants.slug, slugs) : undefined))
    : [];
  const pubRows = ids.length || slugs.length
    ? await db.select().from(restaurants)
        .where(or(ids.length ? inArray(restaurants.sourceCandidateId, ids) : undefined, slugs.length ? inArray(restaurants.slug, slugs) : undefined))
    : [];
  const brief = (r: (typeof candRows)[number]) => ({ id: r.id, name: r.name, slug: r.slug, market: r.market, status: r.status });
  const candById = new Map(candRows.map((r) => [r.id, r]));
  const pubBySource = new Map(pubRows.filter((r) => r.sourceCandidateId).map((r) => [r.sourceCandidateId as string, r]));
  const pubBySlug = new Map(pubRows.map((r) => [r.slug, r]));
  for (const c of candidates) {
    const problems: string[] = [];
    if (c.candidateRestaurantId) {
      const cand = candById.get(c.candidateRestaurantId) ?? null;
      const pub = pubBySource.get(c.candidateRestaurantId) ?? null;
      if (!cand) problems.push("The linked restaurant candidate no longer exists.");
      if (cand && c.restaurantSlug && pub && pub.slug !== c.restaurantSlug) problems.push("The stored slug differs from the published slug.");
      out[c.id] = {
        kind: pub ? "published" : "candidate",
        candidate: cand ? brief(cand) : null,
        publishedSlug: pub?.slug ?? null, publishedStatus: pub?.status ?? null,
        attachable: Boolean(pub && pub.status === "published"), proposedCandidate: null, problems,
      };
    } else if (c.restaurantSlug) {
      const pub = pubBySlug.get(c.restaurantSlug) ?? null;
      const matches = candRows.filter((r) => r.slug === c.restaurantSlug);
      if (pub) {
        out[c.id] = {
          kind: "published", candidate: pub.sourceCandidateId ? (candById.get(pub.sourceCandidateId) ? brief(candById.get(pub.sourceCandidateId)!) : null) : null,
          publishedSlug: pub.slug, publishedStatus: pub.status, attachable: pub.status === "published", proposedCandidate: null, problems,
        };
      } else {
        if (matches.length === 0) problems.push(`No published restaurant or draft has the slug "${c.restaurantSlug}".`);
        if (matches.length > 1) problems.push(`${matches.length} drafts share the slug "${c.restaurantSlug}"; pick one by ID.`);
        out[c.id] = {
          kind: "legacy-slug", candidate: null, publishedSlug: null, publishedStatus: null, attachable: false,
          proposedCandidate: matches.length === 1 ? brief(matches[0]) : null,
          problems: [...problems, "Linked by a typed slug only. Link it to the draft by ID so it stays correct when the slug changes."],
        };
      }
    } else {
      out[c.id] = { kind: "none", candidate: null, publishedSlug: null, publishedStatus: null, attachable: false, proposedCandidate: null, problems: ["Not linked to any restaurant."] };
    }
  }
  return out;
}
