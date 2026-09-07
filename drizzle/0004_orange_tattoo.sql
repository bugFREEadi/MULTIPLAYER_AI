CREATE TABLE "agent_tool_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_id" uuid,
	"tool_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "agent_tool_permissions_org_id_tool_id_unique" UNIQUE("org_id","tool_id")
);
--> statement-breakpoint
CREATE TABLE "connected_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"auth_config" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "connected_tools_org_id_tool_name_unique" UNIQUE("org_id","tool_name")
);
--> statement-breakpoint
ALTER TABLE "agent_tool_permissions" ADD CONSTRAINT "agent_tool_permissions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_permissions" ADD CONSTRAINT "agent_tool_permissions_tool_id_connected_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."connected_tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_tools" ADD CONSTRAINT "connected_tools_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_tool_permissions_org_id_idx" ON "agent_tool_permissions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "connected_tools_org_id_idx" ON "connected_tools" USING btree ("org_id");