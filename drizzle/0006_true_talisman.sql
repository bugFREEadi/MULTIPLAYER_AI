CREATE TABLE "memory_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid,
	"fact" text NOT NULL,
	"embedding" jsonb,
	"source_session_id" uuid,
	"source_event_seq" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "memory_facts" ADD CONSTRAINT "memory_facts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_facts" ADD CONSTRAINT "memory_facts_source_session_id_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_facts_org_id_status_idx" ON "memory_facts" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "memory_facts_source_session_id_idx" ON "memory_facts" USING btree ("source_session_id");
