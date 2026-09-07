CREATE TABLE "task_graphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_session_id" uuid NOT NULL,
	"goal" text NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_graph_id" uuid NOT NULL,
	"title" text NOT NULL,
	"assigned_to_type" text NOT NULL,
	"assigned_to_id" uuid,
	"child_session_id" uuid,
	"depends_on" uuid[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "task_graphs" ADD CONSTRAINT "task_graphs_parent_session_id_sessions_id_fk" FOREIGN KEY ("parent_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_nodes" ADD CONSTRAINT "task_nodes_task_graph_id_task_graphs_id_fk" FOREIGN KEY ("task_graph_id") REFERENCES "public"."task_graphs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_nodes" ADD CONSTRAINT "task_nodes_child_session_id_sessions_id_fk" FOREIGN KEY ("child_session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_graphs_parent_session_id_idx" ON "task_graphs" USING btree ("parent_session_id");--> statement-breakpoint
CREATE INDEX "task_nodes_task_graph_id_idx" ON "task_nodes" USING btree ("task_graph_id");