CREATE TABLE "candidate_restaurants" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"google_place_id" text,
	"website_domain" text,
	"address" text,
	"neighborhood" text,
	"lat" double precision,
	"lng" double precision,
	"price_level" integer,
	"cuisine_tags" text[],
	"dietary_tags" text[],
	"vibe_tags" text[],
	"dish_highlights" text[],
	"best_for" text[],
	"reason_text" text,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"query" text,
	"candidates_created" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurant_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"candidate_id" text NOT NULL,
	"source_type" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"raw_name" text,
	"raw_address" text,
	"url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
