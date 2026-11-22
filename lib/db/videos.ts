import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { AUDIT_FIELDS, type AuditAction, type AuditContext } from "@/lib/adminAudit";
import type { Video } from "@/lib/types";
import { normalizeVideo } from "@/lib/video";
import { getDb, isDbConfigured } from "./index";
import { VIDEO_RESTAURANT_RELATED, auditedInsert, auditedUpdate } from "./audit";
import { restaurantVideos, type RestaurantVideoRow } from "./schema";

export { isDbConfigured };

/**
 * Persisted-row -> legal-safe Video. Runs through `normalizeVideo` so even rows
 * written by an older schema (or by hand) can't violate the display invariants.
 */
function rowToVideo(row: RestaurantVideoRow): Video | null {
  return normalizeVideo({
    id: row.id,
    platform: row.platform,
    sourceUrl: row.sourceUrl ?? undefined,
    embedUrl: row.embedUrl ?? undefined,
    creatorHandle: row.creatorHandle,
    creatorDisplayName: row.creatorDisplayName ?? undefined,
    caption: row.caption,
    thumbnailUrl: row.thumbnailUrl ?? undefined,
    attributionText: row.attributionText,
    publishedAt: row.publishedAt ?? undefined,
    discoveredAt: row.discoveredAt ?? undefined,
    isRealSource: row.isRealSource,
    sourceType: row.sourceType,
    matchConfidence: row.matchConfidence,
    legalDisplayStatus: row.legalDisplayStatus,
  });
}

/** Active (non-hidden) persisted videos for a restaurant, newest first. */
export async function getActiveVideos(restaurantId: string): Promise<Video[]> {
  const db = getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(restaurantVideos)
    .where(
      and(
        eq(restaurantVideos.restaurantId, restaurantId),
        eq(restaurantVideos.status, "active"),
      ),
    )
    .orderBy(desc(restaurantVideos.createdAt));
  return rows
    .map(rowToVideo)
    .filter((v): v is Video => v !== null);
}

/** Use the same source validation as the public profiles when counting creator posts. */
export async function getRealVideoCounts(slugs: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const db = getDb();
  if (!db || slugs.length === 0) return counts;
  const rows = await db.select().from(restaurantVideos).where(and(
    inArray(restaurantVideos.restaurantId, slugs),
    eq(restaurantVideos.status, "active"),
    eq(restaurantVideos.sourceType, "real-post"),
  ));
  for (const row of rows) {
    if (!rowToVideo(row)?.isRealSource) continue;
    counts.set(row.restaurantId, (counts.get(row.restaurantId) ?? 0) + 1);
  }
  return counts;
}

const VIDEO_RELATED = VIDEO_RESTAURANT_RELATED;

/**
 * Insert an already-normalized Video for a restaurant. A fresh row id is
 * generated so the same source video can be attached more than once (or to
 * multiple restaurants) without a primary-key collision.
 * Used only for code-managed seed restaurants (no candidate lifecycle); the row and its
 * `restaurant_video.added_direct` event commit together.
 */
export async function insertVideo(
  restaurantId: string,
  video: Video,
  ctx: AuditContext,
): Promise<Video> {
  if (!getDb()) throw new Error("DATABASE_URL not configured");
  const id = crypto.randomUUID();
  await auditedInsert({
    table: restaurantVideos,
    audit: {
      ctx, resourceType: "restaurant_video", fields: AUDIT_FIELDS.restaurant_video,
      action: "restaurant_video.added_direct", related: VIDEO_RELATED,
    },
    values: {
      id,
      restaurantId,
      platform: video.platform,
      sourceUrl: video.sourceUrl ?? null,
      embedUrl: video.embedUrl ?? null,
      creatorHandle: video.creatorHandle,
      creatorDisplayName: video.creatorDisplayName ?? null,
      caption: video.caption,
      thumbnailUrl: video.thumbnailUrl ?? null,
      attributionText: video.attributionText,
      publishedAt: video.publishedAt ?? null,
      discoveredAt: video.discoveredAt ?? null,
      isRealSource: video.isRealSource,
      sourceType: video.sourceType,
      matchConfidence: video.matchConfidence,
      legalDisplayStatus: video.legalDisplayStatus,
      status: "active",
    },
  });
  return { ...video, id };
}

/** A live (or hidden) video as the admin sees it: attribution fields plus status. Source identity is read-only. */
export interface PublishedVideoAdmin {
  id: string;
  /** The restaurant's PUBLIC slug (restaurant_videos.restaurant_id holds the slug). */
  restaurantSlug: string;
  platform: string;
  sourceUrl: string | null;
  creatorHandle: string;
  creatorDisplayName: string | null;
  caption: string;
  attributionText: string;
  status: "active" | "hidden";
  legalDisplayStatus: string;
  sourceType: string;
  createdAt: string;
  updatedAt: string;
}

function rowToAdminVideo(row: RestaurantVideoRow): PublishedVideoAdmin {
  return {
    id: row.id,
    restaurantSlug: row.restaurantId,
    platform: row.platform,
    sourceUrl: row.sourceUrl ?? null,
    creatorHandle: row.creatorHandle,
    creatorDisplayName: row.creatorDisplayName ?? null,
    caption: row.caption,
    attributionText: row.attributionText,
    status: row.status === "hidden" ? "hidden" : "active",
    legalDisplayStatus: row.legalDisplayStatus,
    sourceType: row.sourceType,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Videos for the admin (active AND hidden), newest first, optionally for one restaurant slug or status. */
export async function listVideosForAdmin(filters: { restaurantSlug?: string; status?: "active" | "hidden"; limit?: number } = {}): Promise<PublishedVideoAdmin[]> {
  const db = getDb();
  if (!db) return [];
  const conds = [];
  if (filters.restaurantSlug) conds.push(eq(restaurantVideos.restaurantId, filters.restaurantSlug));
  if (filters.status) conds.push(eq(restaurantVideos.status, filters.status));
  const rows = await db
    .select()
    .from(restaurantVideos)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(restaurantVideos.createdAt))
    .limit(Math.min(Math.max(filters.limit ?? 100, 1), 200));
  return rows.map(rowToAdminVideo);
}

export async function getVideoForAdmin(id: string): Promise<PublishedVideoAdmin | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db.select().from(restaurantVideos).where(eq(restaurantVideos.id, id)).limit(1);
  return row ? rowToAdminVideo(row) : null;
}

/**
 * The ONLY fields of a published video an admin can correct. Source identity (platform, source URL,
 * embed URL), the caption, the legal display status and provenance are not part of this type, so a
 * correction can never loosen a legal-display restriction or re-point a video at different content.
 */
export interface PublishedVideoCorrection {
  creatorHandle?: string;
  creatorDisplayName?: string | null;
  attributionText?: string;
}

/** Correct attribution fields. Returns null when the video does not exist; no event when nothing changed. */
export async function updatePublishedVideo(
  id: string,
  correction: PublishedVideoCorrection,
  ctx: AuditContext,
): Promise<{ video: PublishedVideoAdmin; changed: boolean } | null> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const set: Partial<typeof restaurantVideos.$inferInsert> = { updatedAt: new Date() };
  if (correction.creatorHandle !== undefined) set.creatorHandle = correction.creatorHandle;
  if (correction.creatorDisplayName !== undefined) set.creatorDisplayName = correction.creatorDisplayName;
  if (correction.attributionText !== undefined) set.attributionText = correction.attributionText;
  const result = await auditedUpdate({
    table: restaurantVideos,
    where: eq(restaurantVideos.id, id),
    set,
    audit: {
      ctx, resourceType: "restaurant_video", fields: AUDIT_FIELDS.restaurant_video,
      action: "restaurant_video.updated", related: VIDEO_RELATED,
    },
  });
  if (!result) return null;
  return { video: rowToAdminVideo(result.row), changed: result.eventId !== null };
}

const VIDEO_STATUS_ACTIONS: Record<"hidden" | "active", AuditAction> = {
  hidden: "restaurant_video.hidden",
  active: "restaurant_video.restored",
};

/**
 * Soft-delete (hidden) or recovery (active). Idempotent: setting the status it already has writes
 * nothing and no event. Never hard-deletes; the row, its source identity and its association survive.
 */
export async function setVideoStatus(
  id: string,
  status: "hidden" | "active",
  ctx: AuditContext,
): Promise<{ video: PublishedVideoAdmin; changed: boolean } | null> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const result = await auditedUpdate({
    table: restaurantVideos,
    where: and(eq(restaurantVideos.id, id), ne(restaurantVideos.status, status))!,
    set: { status, updatedAt: new Date() },
    audit: {
      ctx, resourceType: "restaurant_video", fields: AUDIT_FIELDS.restaurant_video,
      action: VIDEO_STATUS_ACTIONS[status], related: VIDEO_RELATED,
    },
  });
  if (result) return { video: rowToAdminVideo(result.row), changed: true };
  const existing = await getVideoForAdmin(id);
  return existing ? { video: existing, changed: false } : null;
}

/** Soft-delete: mark a video hidden. Returns false if no row matched (already hidden counts as found). */
export async function hideVideo(id: string, ctx: AuditContext): Promise<boolean> {
  return (await setVideoStatus(id, "hidden", ctx)) !== null;
}

/** Recovery: make a hidden video active again. Returns null if no row matched. */
export async function restoreVideo(id: string, ctx: AuditContext) {
  return setVideoStatus(id, "active", ctx);
}
