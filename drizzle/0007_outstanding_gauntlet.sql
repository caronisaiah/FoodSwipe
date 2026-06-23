CREATE TABLE "restaurants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"neighborhood" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"google_place_id" text,
	"website_domain" text,
	"lat" double precision,
	"lng" double precision,
	"distance_miles" double precision DEFAULT 0 NOT NULL,
	"price_level" integer DEFAULT 2 NOT NULL,
	"cuisine_tags" text[],
	"dietary_tags" text[],
	"vibe_tags" text[],
	"dish_highlights" text[],
	"best_for" text[],
	"reason_text" text DEFAULT '' NOT NULL,
	"trend_score" integer DEFAULT 0 NOT NULL,
	"vibe_score" integer DEFAULT 0 NOT NULL,
	"video_count" integer DEFAULT 0 NOT NULL,
	"recent_video_count" integer DEFAULT 0 NOT NULL,
	"save_count" integer DEFAULT 0 NOT NULL,
	"source_candidate_id" text,
	"status" text DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "restaurants_slug_key" ON "restaurants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "restaurants_source_candidate_id_key" ON "restaurants" USING btree ("source_candidate_id") WHERE "restaurants"."source_candidate_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "restaurants_google_place_id_key" ON "restaurants" USING btree ("google_place_id") WHERE "restaurants"."google_place_id" is not null;