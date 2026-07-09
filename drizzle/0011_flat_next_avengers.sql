CREATE TABLE "restaurant_hero_media_selections" (
	"id" text PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"candidate_restaurant_id" text,
	"restaurant_id" text,
	"source_provider" text DEFAULT 'google_places' NOT NULL,
	"relationship" text DEFAULT 'exact_location' NOT NULL,
	"source_place_id" text NOT NULL,
	"selected_photo_ordinal" integer NOT NULL,
	"approval_state" text DEFAULT 'approved' NOT NULL,
	"reviewer_notes" text,
	"selection_reason" text,
	"risk_note" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_hero_media_target_check" CHECK ((
      ("restaurant_hero_media_selections"."target_type" = 'candidate' and "restaurant_hero_media_selections"."candidate_restaurant_id" is not null and "restaurant_hero_media_selections"."restaurant_id" is null)
      or
      ("restaurant_hero_media_selections"."target_type" = 'restaurant' and "restaurant_hero_media_selections"."restaurant_id" is not null and "restaurant_hero_media_selections"."candidate_restaurant_id" is null)
    )),
	CONSTRAINT "restaurant_hero_media_provider_check" CHECK ("restaurant_hero_media_selections"."source_provider" = 'google_places'),
	CONSTRAINT "restaurant_hero_media_relationship_check" CHECK ("restaurant_hero_media_selections"."relationship" = 'exact_location'),
	CONSTRAINT "restaurant_hero_media_state_check" CHECK ("restaurant_hero_media_selections"."approval_state" in ('approved', 'cleared')),
	CONSTRAINT "restaurant_hero_media_ordinal_check" CHECK ("restaurant_hero_media_selections"."selected_photo_ordinal" >= 1 and "restaurant_hero_media_selections"."selected_photo_ordinal" <= 10)
);
--> statement-breakpoint
CREATE INDEX "restaurant_hero_media_candidate_idx" ON "restaurant_hero_media_selections" USING btree ("candidate_restaurant_id");--> statement-breakpoint
CREATE INDEX "restaurant_hero_media_restaurant_idx" ON "restaurant_hero_media_selections" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "restaurant_hero_media_source_place_idx" ON "restaurant_hero_media_selections" USING btree ("source_place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_hero_media_candidate_active_key" ON "restaurant_hero_media_selections" USING btree ("candidate_restaurant_id") WHERE "restaurant_hero_media_selections"."target_type" = 'candidate' and "restaurant_hero_media_selections"."approval_state" = 'approved' and "restaurant_hero_media_selections"."candidate_restaurant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_hero_media_restaurant_active_key" ON "restaurant_hero_media_selections" USING btree ("restaurant_id") WHERE "restaurant_hero_media_selections"."target_type" = 'restaurant' and "restaurant_hero_media_selections"."approval_state" = 'approved' and "restaurant_hero_media_selections"."restaurant_id" is not null;