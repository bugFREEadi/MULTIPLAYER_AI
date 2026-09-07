CREATE TABLE "budget_limits" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"monthly_limit_usd" numeric NOT NULL,
	"alert_threshold_pct" integer DEFAULT 80 NOT NULL,
	"soft_locked" boolean DEFAULT false NOT NULL,
	"alert_active" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "budget_limits" ADD CONSTRAINT "budget_limits_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;