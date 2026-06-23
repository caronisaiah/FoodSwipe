ALTER TABLE "candidate_restaurants" ADD COLUMN "suggestion_confidence" text;--> statement-breakpoint
ALTER TABLE "candidate_restaurants" ADD COLUMN "suggestion_reasons" text[];--> statement-breakpoint
ALTER TABLE "candidate_restaurants" ADD COLUMN "suggested_tags" jsonb;