import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * v1.2 shared persistence — ONLY video attachments live in Postgres.
 * Restaurants stay in `lib/seed/restaurants.ts` (out of scope to move).
 *
 * Columns mirror the `Video` type (lib/types.ts). Enum-ish fields are stored as
 * text and re-validated on the way out via `normalizeVideo` (lib/video.ts), so
 * the DB is never the sole guarantor of the legal-safe invariants.
 */
export const restaurantVideos = pgTable("restaurant_videos", {
  id: text("id").primaryKey(),
  restaurantId: text("restaurant_id").notNull(),
  platform: text("platform").notNull(),
  sourceUrl: text("source_url"),
  embedUrl: text("embed_url"),
  creatorHandle: text("creator_handle").notNull(),
  creatorDisplayName: text("creator_display_name"),
  caption: text("caption").notNull(),
  // thumbnailUrl + publishedAt are populated when optional YouTube Data API
  // enrichment succeeds (YOUTUBE_API_KEY set); otherwise they persist as NULL.
  // The thumbnail is stored by reference only (never downloaded/rehosted) and
  // is re-validated as an https URL via normalizeVideo on read.
  thumbnailUrl: text("thumbnail_url"),
  attributionText: text("attribution_text").notNull(),
  publishedAt: text("published_at"),
  discoveredAt: text("discovered_at"),
  isRealSource: boolean("is_real_source").notNull().default(false),
  sourceType: text("source_type").notNull(),
  matchConfidence: text("match_confidence").notNull(),
  legalDisplayStatus: text("legal_display_status").notNull(),
  // "active" (shown) | "hidden" (soft-deleted). Default active.
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RestaurantVideoRow = typeof restaurantVideos.$inferSelect;
export type NewRestaurantVideoRow = typeof restaurantVideos.$inferInsert;
