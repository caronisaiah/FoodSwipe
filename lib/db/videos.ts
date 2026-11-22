import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { AUDIT_FIELDS, type AuditContext } from "@/lib/adminAudit";
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

/** Soft-delete: mark a video hidden. Idempotent; returns false if no row matched. Writes one event on change. */
export async function hideVideo(id: string, ctx: AuditContext): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const result = await auditedUpdate({
    table: restaurantVideos,
    where: and(eq(restaurantVideos.id, id), ne(restaurantVideos.status, "hidden"))!,
    set: { status: "hidden", updatedAt: new Date() },
    audit: { ctx, resourceType: "restaurant_video", fields: AUDIT_FIELDS.restaurant_video, action: "restaurant_video.hidden", related: VIDEO_RELATED },
  });
  if (result) return true;
  const [existing] = await db.select({ id: restaurantVideos.id }).from(restaurantVideos).where(eq(restaurantVideos.id, id)).limit(1);
  return Boolean(existing);
}
