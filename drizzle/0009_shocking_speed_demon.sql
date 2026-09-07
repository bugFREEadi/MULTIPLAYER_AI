CREATE TABLE "guest_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"token" text NOT NULL,
	"role" text NOT NULL,
	"guest_org_name" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"redeemed_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "guest_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "guest_invites" ADD CONSTRAINT "guest_invites_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_invites" ADD CONSTRAINT "guest_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_invites" ADD CONSTRAINT "guest_invites_redeemed_user_id_users_id_fk" FOREIGN KEY ("redeemed_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_invites_session_id_idx" ON "guest_invites" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "guest_invites_token_idx" ON "guest_invites" USING btree ("token");