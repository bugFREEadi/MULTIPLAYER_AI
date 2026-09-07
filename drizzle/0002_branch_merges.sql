CREATE TABLE "branch_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_session_id" uuid NOT NULL,
	"target_session_id" uuid NOT NULL,
	"merged_by" uuid,
	"merge_summary" text,
	"rejected_branches" uuid[],
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "branch_merges" ADD CONSTRAINT "branch_merges_source_session_id_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_merges" ADD CONSTRAINT "branch_merges_target_session_id_sessions_id_fk" FOREIGN KEY ("target_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_merges" ADD CONSTRAINT "branch_merges_merged_by_users_id_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;