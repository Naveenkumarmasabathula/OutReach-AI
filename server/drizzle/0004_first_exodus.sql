CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'ready', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"eligibility_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"follow_up_window_hours" integer DEFAULT 72 NOT NULL,
	"calling_hours_start" text,
	"calling_hours_end" text,
	"priority" integer DEFAULT 3 NOT NULL,
	"retry_limit" integer,
	"outbound_capacity" integer,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"escalation_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_hospital_id_idx" ON "campaigns" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");