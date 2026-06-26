ALTER TABLE "candidate_restaurants" ADD COLUMN "market" text DEFAULT 'dc' NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "market" text DEFAULT 'dc' NOT NULL;--> statement-breakpoint
CREATE INDEX "candidate_restaurants_status_market_created_idx" ON "candidate_restaurants" USING btree ("status","market","created_at");--> statement-breakpoint
CREATE INDEX "restaurants_status_market_created_idx" ON "restaurants" USING btree ("status","market","created_at");