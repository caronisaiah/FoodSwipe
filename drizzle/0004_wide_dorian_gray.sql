ALTER TABLE "candidate_restaurants" ADD COLUMN "review_likelihood_score" integer;--> statement-breakpoint
ALTER TABLE "candidate_restaurants" ADD COLUMN "review_likelihood_reasons" text[];