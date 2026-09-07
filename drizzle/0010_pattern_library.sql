CREATE TABLE "workflow_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"steps" jsonb NOT NULL,
	"created_from_session_id" uuid,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "workflow_pattern_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "attached_checkpoint_policy_ids" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_patterns" ADD CONSTRAINT "workflow_patterns_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_patterns" ADD CONSTRAINT "workflow_patterns_created_from_session_id_sessions_id_fk" FOREIGN KEY ("created_from_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workflow_pattern_id_workflow_patterns_id_fk" FOREIGN KEY ("workflow_pattern_id") REFERENCES "public"."workflow_patterns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_patterns_org_id_idx" ON "workflow_patterns" USING btree ("org_id");