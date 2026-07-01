CREATE TABLE "restaurant_evidence_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"candidate_restaurant_id" text,
	"restaurant_slug" text,
	"market" text,
	"source_url" text NOT NULL,
	"source_domain" text,
	"source_type" text NOT NULL,
	"title" text,
	"cleaned_text" text NOT NULL,
	"extracted_snippets" jsonb,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"fetch_status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "restaurant_evidence_candidate_idx" ON "restaurant_evidence_documents" USING btree ("candidate_restaurant_id");--> statement-breakpoint
CREATE INDEX "restaurant_evidence_slug_idx" ON "restaurant_evidence_documents" USING btree ("restaurant_slug");