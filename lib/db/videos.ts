import { and, desc, eq } from "drizzle-orm";
import type { Video } from "@/lib/types";
import { normalizeVideo } from "@/lib/video";
import { getDb, isDbConfigured } from "./index";
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

/**
 * Insert an already-normalized Video for a restaurant. A fresh row id is
 * generated so the same source video can be attached more than once (or to
 * multiple restaurants) without a primary-key collision.
 */
export async function insertVideo(
  restaurantId: string,
  video: Video,
): Promise<Video> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const id = crypto.randomUUID();
  await db.insert(restaurantVideos).values({
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
  });
  return { ...video, id };
}

/** Soft-delete: mark a video hidden. Returns false if no row matched. */
export async function hideVideo(id: string): Promise<boolean> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const updated = await db
    .update(restaurantVideos)
    .set({ status: "hidden", updatedAt: new Date() })
    .where(eq(restaurantVideos.id, id))
    .returning({ id: restaurantVideos.id });
  return updated.length > 0;
}
