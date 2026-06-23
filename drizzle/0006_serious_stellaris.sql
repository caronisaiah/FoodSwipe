-- One-time dedupe so the partial unique index below can build over any existing
-- duplicate google_place_id rows (the bug this migration closes). For each
-- google_place_id we KEEP the most-recently-updated row (ties broken by id),
-- preserving review work, and delete the redundant copies. Manual rows with a
-- NULL google_place_id are never touched. (restaurant_sources has no FK, so any
-- provenance rows for deleted candidates are left as harmless audit orphans.)
DELETE FROM "candidate_restaurants" AS a
USING "candidate_restaurants" AS b
WHERE a."google_place_id" IS NOT NULL
  AND a."google_place_id" = b."google_place_id"
  AND (
    a."updated_at" < b."updated_at"
    OR (a."updated_at" = b."updated_at" AND a."id" < b."id")
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_restaurants_google_place_id_key" ON "candidate_restaurants" USING btree ("google_place_id") WHERE "candidate_restaurants"."google_place_id" is not null;
