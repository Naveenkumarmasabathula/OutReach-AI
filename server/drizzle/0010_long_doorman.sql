CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'ai_agent', 'system');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD COLUMN "transcript" jsonb;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD COLUMN "triage_result" jsonb;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD COLUMN "consensus_result" jsonb;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD COLUMN "documentation_status" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_hospital_id_idx" ON "audit_log" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "audit_log_resource_idx" ON "audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_type","actor_id");