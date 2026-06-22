ALTER TABLE "ingestion_jobs" ADD COLUMN "dry_run" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD COLUMN "skipped_duplicates" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD COLUMN "error" text;