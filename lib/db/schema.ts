import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
  // Market id (multi-market A1) — allow-list validated in lib/markets.ts; carried
  // into restaurants.market on promotion. Backfilled "dc" for existing rows.
  market: text("market").notNull().default("dc"),
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
  // Supports admin review filtered by status + market, newest first (A1+).
  index("candidate_restaurants_status_market_created_idx").on(t.status, t.market, t.createdAt),
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
  // Market id (multi-market A1) — set from the source candidate at promotion;
  // selects the origin used for distanceMiles. Backfilled "dc" for existing rows.
  market: text("market").notNull().default("dc"),
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
  // Supports the feed/admin query: published rows for a market, newest first (A1+).
  // NOTE: slug stays GLOBALLY unique (restaurants_slug_key above) — cross-market
  // duplicate slugs are deferred to A2/A3 until all slug-based lookups are market-aware.
  index("restaurants_status_market_created_idx").on(t.status, t.market, t.createdAt),
]);

export type RestaurantRow = typeof restaurants.$inferSelect;

/** Independently sourced map points. Never publish location data from the legacy restaurant columns. */
export const restaurantLocations = pgTable("restaurant_locations", {
  restaurantId: text("restaurant_id").notNull().references(() => restaurants.id, { onDelete: "restrict" }),
  overtureId: text("overture_id").notNull(),
  release: text("release").notNull(),
  featureVersion: integer("feature_version").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  // Original feature fields, including property-specific source records and raw address.
  evidence: jsonb("evidence").notNull(),
  identityEvidenceUrl: text("identity_evidence_url"),
  displayName: text("display_name"),
  displayArea: text("display_area"),
  displayAddress: text("display_address"),
  cuisine: text("cuisine"),
  cuisineEvidenceUrl: text("cuisine_evidence_url"),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
}, (t) => [
  primaryKey({ columns: [t.restaurantId, t.overtureId, t.release] }),
  uniqueIndex("restaurant_locations_approved_restaurant").on(t.restaurantId).where(sql`${t.status} = 'approved'`),
  uniqueIndex("restaurant_locations_approved_place").on(t.overtureId).where(sql`${t.status} = 'approved'`),
  check("restaurant_locations_valid_position", sql`${t.lat} between -85.051129 and 85.051129
    and ${t.lng} between -180 and 180 and (${t.lat} <> 0 or ${t.lng} <> 0)`),
  check("restaurant_locations_valid_status", sql`${t.status} in ('pending', 'approved', 'rejected')`),
  check("restaurant_locations_review_required", sql`${t.status} = 'pending' or (
    ${t.reviewedAt} is not null and coalesce(length(trim(${t.reviewedBy})), 0) > 0)`),
  check("restaurant_locations_identity_required", sql`${t.status} <> 'approved' or (
    coalesce(length(trim(${t.displayName})), 0) > 0 and coalesce(${t.identityEvidenceUrl}, '') like 'https://%')`),
  check("restaurant_locations_cuisine_provenance", sql`${t.cuisine} is null or
    coalesce(${t.cuisineEvidenceUrl}, '') like 'https://%'`),
]);
export type NewRestaurantRow = typeof restaurants.$inferInsert;

/**
 * P2C selected hero-media approvals. Stores ONLY durable, policy-safe selection
 * metadata: target, exact Google Place ID, and 1-based Google photo ordinal.
 * It never stores Google photo names/references, ephemeral photoUri values,
 * image bytes, or API keys. Public rendering resolves the selected ordinal fresh
 * at request time and falls back to the normal hero ladder if stale/invalid.
 */
export const restaurantHeroMediaSelections = pgTable("restaurant_hero_media_selections", {
  id: text("id").primaryKey(),
  // "candidate" | "restaurant"
  targetType: text("target_type").notNull(),
  candidateRestaurantId: text("candidate_restaurant_id"),
  restaurantId: text("restaurant_id"),
  // P2C supports exact Google place photos only. Text fields leave room for later
  // sibling-location work without widening this slice.
  sourceProvider: text("source_provider").notNull().default("google_places"),
  relationship: text("relationship").notNull().default("exact_location"),
  sourcePlaceId: text("source_place_id").notNull(),
  // 1-based ordinal in the fresh Google Place Details photo list.
  selectedPhotoOrdinal: integer("selected_photo_ordinal").notNull(),
  // "approved" | "cleared"
  approvalState: text("approval_state").notNull().default("approved"),
  reviewerNotes: text("reviewer_notes"),
  selectionReason: text("selection_reason"),
  riskNote: text("risk_note"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("restaurant_hero_media_candidate_idx").on(t.candidateRestaurantId),
  index("restaurant_hero_media_restaurant_idx").on(t.restaurantId),
  index("restaurant_hero_media_source_place_idx").on(t.sourcePlaceId),
  uniqueIndex("restaurant_hero_media_candidate_active_key")
    .on(t.candidateRestaurantId)
    .where(sql`${t.targetType} = 'candidate' and ${t.approvalState} = 'approved' and ${t.candidateRestaurantId} is not null`),
  uniqueIndex("restaurant_hero_media_restaurant_active_key")
    .on(t.restaurantId)
    .where(sql`${t.targetType} = 'restaurant' and ${t.approvalState} = 'approved' and ${t.restaurantId} is not null`),
  check(
    "restaurant_hero_media_target_check",
    sql`(
      (${t.targetType} = 'candidate' and ${t.candidateRestaurantId} is not null and ${t.restaurantId} is null)
      or
      (${t.targetType} = 'restaurant' and ${t.restaurantId} is not null and ${t.candidateRestaurantId} is null)
    )`,
  ),
  check("restaurant_hero_media_provider_check", sql`${t.sourceProvider} = 'google_places'`),
  check("restaurant_hero_media_relationship_check", sql`${t.relationship} = 'exact_location'`),
  check("restaurant_hero_media_state_check", sql`${t.approvalState} in ('approved', 'cleared')`),
  check("restaurant_hero_media_ordinal_check", sql`${t.selectedPhotoOrdinal} >= 1 and ${t.selectedPhotoOrdinal} <= 10`),
]);

export type RestaurantHeroMediaSelectionRow = typeof restaurantHeroMediaSelections.$inferSelect;
export type NewRestaurantHeroMediaSelectionRow = typeof restaurantHeroMediaSelections.$inferInsert;

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

/**
 * Tag Automation B4 — bounded OFFICIAL-WEBSITE evidence for tag suggestions.
 *
 * Stores CLEANED TEXT (never raw HTML, never media) fetched on-demand by an admin
 * from a restaurant's OWN official website/domain — used only as a private,
 * review-first evidence source for tag suggestions. NOT public, never shown on a
 * profile. Collection is bounded (same-domain only, <=3 pages, short timeouts,
 * capped text); see lib/websiteEvidence.ts. No social/review/search content here.
 */
export const restaurantEvidenceDocuments = pgTable("restaurant_evidence_documents", {
  id: text("id").primaryKey(),
  // "candidate" | "restaurant"
  subjectType: text("subject_type").notNull(),
  candidateRestaurantId: text("candidate_restaurant_id"),
  restaurantSlug: text("restaurant_slug"),
  market: text("market"),
  sourceUrl: text("source_url").notNull(),
  sourceDomain: text("source_domain"),
  // "homepage" | "menu" | "about" | "events" | "unknown"
  sourceType: text("source_type").notNull(),
  title: text("title"),
  // Cleaned, readable text only (scripts/styles/boilerplate stripped) — bounded.
  cleanedText: text("cleaned_text").notNull(),
  extractedSnippets: jsonb("extracted_snippets"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  // "ok" | "empty" | "error" | "blocked"
  fetchStatus: text("fetch_status").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Read evidence back by subject (candidate id or published/seed slug).
  index("restaurant_evidence_candidate_idx").on(t.candidateRestaurantId),
  index("restaurant_evidence_slug_idx").on(t.restaurantSlug),
]);

export type RestaurantEvidenceRow = typeof restaurantEvidenceDocuments.$inferSelect;
export type NewRestaurantEvidenceRow = typeof restaurantEvidenceDocuments.$inferInsert;

/**
 * Admin Hardening B — APPEND-ONLY audit log of consequential admin mutations.
 *
 * One row per meaningful, SUCCESSFUL change. Rows are written by the same single SQL statement
 * (data-modifying CTE) that performs the change, so a change and its event commit or roll back together
 * (see lib/db/audit.ts). Database triggers (migration 0013) reject UPDATE, DELETE and TRUNCATE.
 *
 * Who: `actorIdentity` is a NON-SECRET label derived from which shared admin credential authenticated
 * the request (e.g. "publish-credential" or "draft-credential", or an operator-chosen label). It is NOT a
 * per-person identity: possession of a credential does not prove which human (or agent) used it.
 * `actorAssurance` states that explicitly. Credential values, auth headers, env values and raw request
 * bodies are never stored; `changes` holds allow-listed fields only, long values clipped.
 */
export const adminEvents = pgTable("admin_events", {
  /** Monotonic ordering / cursor. Gaps are possible (rolled-back statements consume values). */
  seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
  id: text("id").primaryKey(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  /** "<resource>.<verb>", e.g. "restaurant_candidate.approved". Taxonomy in lib/adminAudit.ts. */
  action: text("action").notNull(),
  /** "restaurant_candidate" | "restaurant" | "video_candidate" | "restaurant_video" */
  resourceType: text("resource_type").notNull(),
  /** Stable id of the primary record (never a slug; slugs can change at promotion). */
  resourceId: text("resource_id").notNull(),
  relatedResourceType: text("related_resource_type"),
  relatedResourceId: text("related_resource_id"),
  actorIdentity: text("actor_identity").notNull(),
  /** Authorization scope the credential carried: "draft" | "publish". */
  authScope: text("auth_scope").notNull(),
  /** Always "shared-credential" today: the identity names a credential, not a verified person. */
  actorAssurance: text("actor_assurance").notNull().default("shared-credential"),
  /** Correlates the events written by one HTTP request. */
  requestId: text("request_id").notNull(),
  /** { field: { from, to } } for edits, { field: { to } } for creations. Allow-listed fields only. */
  changes: jsonb("changes").notNull().default(sql`'{}'::jsonb`),
  /** Small, non-secret context (override acknowledgements, import source, ...). */
  details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
  /** Human-supplied reason / review note, when the request carried one. */
  reason: text("reason"),
}, (t) => [
  uniqueIndex("admin_events_seq_key").on(t.seq),
  index("admin_events_resource_idx").on(t.resourceType, t.resourceId, t.seq),
  index("admin_events_related_idx").on(t.relatedResourceId, t.seq),
  index("admin_events_request_idx").on(t.requestId),
  index("admin_events_occurred_idx").on(t.occurredAt),
  check("admin_events_scope_check", sql`${t.authScope} in ('draft', 'publish')`),
  check("admin_events_actor_nonblank", sql`length(trim(${t.actorIdentity})) > 0 and length(trim(${t.requestId})) > 0`),
  check("admin_events_resource_nonblank", sql`length(trim(${t.resourceId})) > 0 and length(trim(${t.action})) > 0`),
  check("admin_events_payload_bounded", sql`octet_length(${t.changes}::text) <= 24000 and octet_length(${t.details}::text) <= 4000 and coalesce(length(${t.reason}), 0) <= 1000`),
]);

export type AdminEventRow = typeof adminEvents.$inferSelect;
