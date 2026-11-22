CREATE TABLE "admin_events" (
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "admin_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"related_resource_type" text,
	"related_resource_id" text,
	"actor_identity" text NOT NULL,
	"auth_scope" text NOT NULL,
	"actor_assurance" text DEFAULT 'shared-credential' NOT NULL,
	"request_id" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	CONSTRAINT "admin_events_scope_check" CHECK ("admin_events"."auth_scope" in ('draft', 'publish')),
	CONSTRAINT "admin_events_actor_nonblank" CHECK (length(trim("admin_events"."actor_identity")) > 0 and length(trim("admin_events"."request_id")) > 0),
	CONSTRAINT "admin_events_resource_nonblank" CHECK (length(trim("admin_events"."resource_id")) > 0 and length(trim("admin_events"."action")) > 0),
	CONSTRAINT "admin_events_payload_bounded" CHECK (octet_length("admin_events"."changes"::text) <= 24000 and octet_length("admin_events"."details"::text) <= 4000 and coalesce(length("admin_events"."reason"), 0) <= 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admin_events_seq_key" ON "admin_events" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "admin_events_resource_idx" ON "admin_events" USING btree ("resource_type","resource_id","seq");--> statement-breakpoint
CREATE INDEX "admin_events_related_idx" ON "admin_events" USING btree ("related_resource_id","seq");--> statement-breakpoint
CREATE INDEX "admin_events_request_idx" ON "admin_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "admin_events_occurred_idx" ON "admin_events" USING btree ("occurred_at");--> statement-breakpoint
-- Append-only: the audit log can be added to but never edited, deleted or truncated through SQL by the
-- application role. (A role with DDL rights could still drop these triggers; see docs/admin-audit-log.md.)
CREATE FUNCTION "admin_events_reject_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'admin_events is append-only: % is not permitted', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "admin_events_no_update_delete" BEFORE UPDATE OR DELETE ON "admin_events" FOR EACH ROW EXECUTE FUNCTION "admin_events_reject_change"();
--> statement-breakpoint
CREATE TRIGGER "admin_events_no_truncate" BEFORE TRUNCATE ON "admin_events" FOR EACH STATEMENT EXECUTE FUNCTION "admin_events_reject_change"();
