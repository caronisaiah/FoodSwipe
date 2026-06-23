import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Snapshot of the conservative auto-suggestion applied at import time. Stored so
 * the review console can (a) show what was auto-suggested vs human-edited and
 * (b) offer "reset to suggestions". Values are controlled-vocab strings.
 */
export interface SuggestedTagSnapshot {
  cuisineTags: string[];
  dietaryTags: string[];
  vibeTags: string[];
  bestFor: string[];
  dishHighlights: string[];
  reasonText: string;
}

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
  // Freshness markers for SOURCE-DERIVED metadata (set ONLY for imported
  // candidates, e.g. source="google_places"; null for manual entries). Google
  // permits caching Place IDs indefinitely, but other Place content should be
  // reviewed/refreshed before it goes stale — `sourceExpiresAt` defaults to
  // `sourceFetchedAt` + 30 days at import. Review-stage only; never shown
  // publicly and never used by `/feed`. See the freshness policy in the README.
  sourceFetchedAt: timestamp("source_fetched_at", { withTimezone: true }),
  sourceExpiresAt: timestamp("source_expires_at", { withTimezone: true }),
  // INTERNAL admin-triage only — an estimate of how likely this candidate
  // already has useful short-form social review content worth curating. NOT a
  // quality/popularity/rating/trending/social-proof signal; never displayed to
  // users, never used by `/feed`. Derived from expiring Google signals (governed
  // by sourceExpiresAt above). Null for manually-entered candidates.
  reviewLikelihoodScore: integer("review_likelihood_score"),
  reviewLikelihoodReasons: text("review_likelihood_reasons").array(),
  // Conservative auto tag suggestions (Google import only) — a STARTING POINT for
  // human review, never published to `/feed`. `suggestedTags` is the original
  // suggestion snapshot, kept so the console can diff human edits and offer
  // "reset to suggestions". Null for manually-entered candidates.
  suggestionConfidence: text("suggestion_confidence"),
  suggestionReasons: text("suggestion_reasons").array(),
  suggestedTags: jsonb("suggested_tags").$type<SuggestedTagSnapshot>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Exact-duplicate guard: at most one candidate per Google Place ID. PARTIAL
  // (WHERE google_place_id IS NOT NULL) so manually-entered candidates with no
  // Place ID are unaffected and many can coexist. This is what makes the import
  // route's insert-conflict recovery a real race guarantee (not just app-level).
  uniqueIndex("candidate_restaurants_google_place_id_key")
    .on(t.googlePlaceId)
    .where(sql`${t.googlePlaceId} is not null`),
]);

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
  // "pending" | "running" | "completed" | "failed" | "success"
  status: text("status").notNull().default("pending"),
  query: text("query"),
  // Whether the run was a preview (true) vs an actual import. Real imports are
  // recorded; dry runs intentionally write nothing (see the import route).
  dryRun: boolean("dry_run").notNull().default(false),
  candidatesCreated: integer("candidates_created").notNull().default(0),
  skippedDuplicates: integer("skipped_duplicates").notNull().default(0),
  error: text("error"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IngestionJobRow = typeof ingestionJobs.$inferSelect;
export type NewIngestionJobRow = typeof ingestionJobs.$inferInsert;

/**
 * Published / live restaurants — DB-backed restaurants that the app feed serves
 * ALONGSIDE the code-managed seed (lib/seed/restaurants.ts). Created only via the
 * explicit promotion of a reviewed candidate (never automatically). Stores enough
 * to satisfy the `Restaurant` type (lib/types.ts); arrays are re-validated against
 * the controlled vocab on read (lib/db/restaurants.ts) — never trusted blindly.
 *
 * NO fabricated social proof: trend/vibe/video/save counts default to 0 (neutral
 * internal placeholders, NOT real user metrics) so promoted restaurants never get
 * a "Trending"/"Top Choice" badge and the profile hides the empty "hype" strip.
 * `status` gates feed visibility ("published" shows, "hidden" does not).
 */
export const restaurants = pgTable("restaurants", {
  id: text("id").primaryKey(),
  // Public identifier used in URLs + photo/video API lookups. Unique across the
  // published set; chosen at promotion to also avoid colliding with seed ids.
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  neighborhood: text("neighborhood").notNull().default(""),
  address: text("address").notNull().default(""),
  googlePlaceId: text("google_place_id"),
  websiteDomain: text("website_domain"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  distanceMiles: doublePrecision("distance_miles").notNull().default(0),
  priceLevel: integer("price_level").notNull().default(2),
  cuisineTags: text("cuisine_tags").array(),
  dietaryTags: text("dietary_tags").array(),
  vibeTags: text("vibe_tags").array(),
  dishHighlights: text("dish_highlights").array(),
  bestFor: text("best_for").array(),
  reasonText: text("reason_text").notNull().default(""),
  // Neutral internal placeholders — NOT real metrics. Default 0 (no fake hype).
  trendScore: integer("trend_score").notNull().default(0),
  vibeScore: integer("vibe_score").notNull().default(0),
  videoCount: integer("video_count").notNull().default(0),
  recentVideoCount: integer("recent_video_count").notNull().default(0),
  saveCount: integer("save_count").notNull().default(0),
  // Provenance: the candidate this was promoted from (never edited via the API).
  sourceCandidateId: text("source_candidate_id"),
  // "published" (visible in feed) | "hidden" (kept, not served).
  status: text("status").notNull().default("published"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (t) => [
  // Public id must be unique across published restaurants.
  uniqueIndex("restaurants_slug_key").on(t.slug),
  // One published restaurant per source candidate (no double promotion).
  uniqueIndex("restaurants_source_candidate_id_key")
    .on(t.sourceCandidateId)
    .where(sql`${t.sourceCandidateId} is not null`),
  // One published restaurant per Google Place ID.
  uniqueIndex("restaurants_google_place_id_key")
    .on(t.googlePlaceId)
    .where(sql`${t.googlePlaceId} is not null`),
]);

export type RestaurantRow = typeof restaurants.$inferSelect;
export type NewRestaurantRow = typeof restaurants.$inferInsert;

/**
 * Social video intake (Phase 1) — a REVIEW STAGING queue for TikTok/Instagram/
 * YouTube URLs, completely separate from `restaurant_videos`. NOTHING here is
 * shown on a profile; a video only reaches `restaurant_videos` after an explicit
 * admin "attach" of an APPROVED candidate (see lib/db/videoCandidates.ts).
 *
 * Enum-ish fields (status/platform/legalDisplayStatus) are stored as text and
 * re-validated on read (never trust raw DB values). We store only review
 * metadata + reference URLs (thumbnail by reference, like restaurant_videos) —
 * never downloaded/rehosted media bytes.
 */
export const videoCandidates = pgTable("video_candidates", {
  id: text("id").primaryKey(),
  // "needs_review" | "approved" | "rejected" | "attached"
  status: text("status").notNull().default("needs_review"),
  // "tiktok" | "instagram" | "youtube"
  platform: text("platform").notNull(),
  sourceUrl: text("source_url").notNull(),
  // Canonical, query-stripped URL — the dedupe key (unique index below).
  normalizedSourceUrl: text("normalized_source_url").notNull(),
  platformVideoId: text("platform_video_id"),
  restaurantSlug: text("restaurant_slug"),
  candidateRestaurantId: text("candidate_restaurant_id"),
  proposedRestaurantName: text("proposed_restaurant_name"),
  creatorHandle: text("creator_handle"),
  creatorName: text("creator_name"),
  caption: text("caption"),
  // Thumbnail stored BY REFERENCE only (validated https URL) — never rehosted.
  thumbnailUrl: text("thumbnail_url"),
  embedUrl: text("embed_url"),
  attributionText: text("attribution_text"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  // Freshness of resolver-fetched metadata (expiring third-party data).
  sourceFetchedAt: timestamp("source_fetched_at", { withTimezone: true }),
  sourceExpiresAt: timestamp("source_expires_at", { withTimezone: true }),
  // Internal 0–100 confidence that this video matches the restaurant (admin/later
  // search). NOT public, NOT engagement/social proof. Null = unscored.
  matchConfidence: integer("match_confidence"),
  matchReasons: text("match_reasons").array(),
  // Same legal-safe vocab as Video: embeddable | source-link-only | placeholder-only | unavailable.
  legalDisplayStatus: text("legal_display_status").notNull().default("source-link-only"),
  // How the URL resolver fared (e.g. "resolved" | "source-link-only" | "missing-credentials" | "error").
  resolverStatus: text("resolver_status").notNull(),
  resolverError: text("resolver_error"),
  reviewNotes: text("review_notes"),
  // Set when the candidate is attached — the restaurant_videos row it created
  // (makes attach idempotent + records provenance).
  attachedVideoId: text("attached_video_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // One candidate per canonical source URL (exact-duplicate protection).
  uniqueIndex("video_candidates_normalized_source_url_key").on(t.normalizedSourceUrl),
  // And one per (platform, platformVideoId) when an id was extractable.
  uniqueIndex("video_candidates_platform_video_id_key")
    .on(t.platform, t.platformVideoId)
    .where(sql`${t.platformVideoId} is not null`),
]);

export type VideoCandidateRow = typeof videoCandidates.$inferSelect;
export type NewVideoCandidateRow = typeof videoCandidates.$inferInsert;
