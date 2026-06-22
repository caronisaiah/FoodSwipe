import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

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

/**
 * Restaurant candidate ingestion (Phase 1) — a REVIEW staging area, completely
 * separate from the live feed. The app still serves restaurants from
 * `lib/seed/restaurants.ts`; nothing here is published to `/feed`. Automation
 * (later) writes candidates for a human to approve/reject; approval is a
 * deliberate, curated step, not an automatic publish.
 *
 * Enum-ish fields (status/source) are stored as text and re-validated on read in
 * `lib/db/candidates.ts`, so the DB is never the sole guarantor of valid values.
 * No scraped media, photo bytes, or photo URLs are ever stored here.
 */
export const candidateRestaurants = pgTable("candidate_restaurants", {
  id: text("id").primaryKey(),
  // Proposed slug (not enforced unique until a curated approval step).
  slug: text("slug"),
  name: text("name").notNull(),
  // "candidate" | "approved" | "rejected" | "needs_review"
  status: text("status").notNull().default("candidate"),
  // "manual" | "google_places"
  source: text("source").notNull().default("manual"),
  googlePlaceId: text("google_place_id"),
  websiteDomain: text("website_domain"),
  address: text("address"),
  neighborhood: text("neighborhood"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  priceLevel: integer("price_level"),
  // Curated, editable FoodSwipe fields (text[]; null treated as [] on read).
  cuisineTags: text("cuisine_tags").array(),
  dietaryTags: text("dietary_tags").array(),
  vibeTags: text("vibe_tags").array(),
  dishHighlights: text("dish_highlights").array(),
  bestFor: text("best_for").array(),
  reasonText: text("reason_text"),
  // Human match / review notes.
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CandidateRestaurantRow = typeof candidateRestaurants.$inferSelect;
export type NewCandidateRestaurantRow = typeof candidateRestaurants.$inferInsert;

/**
 * Provenance for a candidate, kept SEPARATE from the curated candidate fields:
 * where the candidate came from (manual entry, a Google Place, etc). Stores only
 * text metadata + reference URLs — never photo bytes/URLs or downloaded media.
 */
export const restaurantSources = pgTable("restaurant_sources", {
  id: text("id").primaryKey(),
  candidateId: text("candidate_id").notNull(),
  sourceType: text("source_type").notNull().default("manual"),
  externalId: text("external_id"),
  rawName: text("raw_name"),
  rawAddress: text("raw_address"),
  url: text("url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RestaurantSourceRow = typeof restaurantSources.$inferSelect;
export type NewRestaurantSourceRow = typeof restaurantSources.$inferInsert;

/**
 * Optional bookkeeping for batch imports (e.g. a future admin-only Google Places
 * candidate import). Not wired to any automation yet; present so import runs can
 * be tracked + audited rather than silently mutating the candidate table.
 */
export const ingestionJobs = pgTable("ingestion_jobs", {
  id: text("id").primaryKey(),
  source: text("source").notNull().default("manual"),
  // "pending" | "running" | "completed" | "failed"
  status: text("status").notNull().default("pending"),
  query: text("query"),
  candidatesCreated: integer("candidates_created").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IngestionJobRow = typeof ingestionJobs.$inferSelect;
export type NewIngestionJobRow = typeof ingestionJobs.$inferInsert;
