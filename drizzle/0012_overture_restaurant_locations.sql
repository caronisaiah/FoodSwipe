CREATE TABLE "restaurant_locations" (
	"restaurant_id" text NOT NULL,
	"overture_id" text NOT NULL,
	"release" text NOT NULL,
	"feature_version" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"evidence" jsonb NOT NULL,
	"identity_evidence_url" text,
	"display_name" text,
	"display_area" text,
	"display_address" text,
	"cuisine" text,
	"cuisine_evidence_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"review_note" text,
	CONSTRAINT "restaurant_locations_restaurant_id_overture_id_release_pk" PRIMARY KEY("restaurant_id","overture_id","release"),
	CONSTRAINT "restaurant_locations_valid_position" CHECK ("restaurant_locations"."lat" between -85.051129 and 85.051129
    and "restaurant_locations"."lng" between -180 and 180 and ("restaurant_locations"."lat" <> 0 or "restaurant_locations"."lng" <> 0)),
	CONSTRAINT "restaurant_locations_valid_status" CHECK ("restaurant_locations"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "restaurant_locations_review_required" CHECK ("restaurant_locations"."status" = 'pending' or (
    "restaurant_locations"."reviewed_at" is not null and coalesce(length(trim("restaurant_locations"."reviewed_by")), 0) > 0)),
	CONSTRAINT "restaurant_locations_identity_required" CHECK ("restaurant_locations"."status" <> 'approved' or (
    coalesce(length(trim("restaurant_locations"."display_name")), 0) > 0 and coalesce("restaurant_locations"."identity_evidence_url", '') like 'https://%')),
	CONSTRAINT "restaurant_locations_cuisine_provenance" CHECK ("restaurant_locations"."cuisine" is null or
    coalesce("restaurant_locations"."cuisine_evidence_url", '') like 'https://%')
);
--> statement-breakpoint
ALTER TABLE "restaurant_locations" ADD CONSTRAINT "restaurant_locations_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_locations_approved_restaurant" ON "restaurant_locations" USING btree ("restaurant_id") WHERE "restaurant_locations"."status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_locations_approved_place" ON "restaurant_locations" USING btree ("overture_id") WHERE "restaurant_locations"."status" = 'approved';