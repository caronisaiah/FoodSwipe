CREATE TABLE "video_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'needs_review' NOT NULL,
	"platform" text NOT NULL,
	"source_url" text NOT NULL,
	"normalized_source_url" text NOT NULL,
	"platform_video_id" text,
	"restaurant_slug" text,
	"candidate_restaurant_id" text,
	"proposed_restaurant_name" text,
	"creator_handle" text,
	"creator_name" text,
	"caption" text,
	"thumbnail_url" text,
	"embed_url" text,
	"attribution_text" text,
	"published_at" timestamp with time zone,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_fetched_at" timestamp with time zone,
	"source_expires_at" timestamp with time zone,
	"match_confidence" integer,
	"match_reasons" text[],
	"legal_display_status" text DEFAULT 'source-link-only' NOT NULL,
	"resolver_status" text NOT NULL,
	"resolver_error" text,
	"review_notes" text,
	"attached_video_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "video_candidates_normalized_source_url_key" ON "video_candidates" USING btree ("normalized_source_url");--> statement-breakpoint
CREATE UNIQUE INDEX "video_candidates_platform_video_id_key" ON "video_candidates" USING btree ("platform","platform_video_id") WHERE "video_candidates"."platform_video_id" is not null;