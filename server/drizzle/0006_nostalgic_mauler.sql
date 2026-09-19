CREATE TYPE "public"."attempt_outcome" AS ENUM('completed', 'no_answer', 'busy', 'voicemail', 'dropped', 'invalid_number', 'declined', 'callback_requested', 'escalated', 'technical_failure');--> statement-breakpoint
CREATE TYPE "public"."outreach_task_status" AS ENUM('pending', 'scheduled', 'calling', 'retry_scheduled', 'callback_scheduled', 'escalated', 'manual_follow_up', 'completed', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "outreach_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"outreach_task_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" "attempt_outcome" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"encounter_id" text NOT NULL,
	"status" "outreach_task_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"callback_requested_for" timestamp with time zone,
	"clinical_deadline" timestamp with time zone NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"conversation_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_attempts" ADD CONSTRAINT "outreach_attempts_outreach_task_id_outreach_tasks_id_fk" FOREIGN KEY ("outreach_task_id") REFERENCES "public"."outreach_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_tasks" ADD CONSTRAINT "outreach_tasks_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_tasks" ADD CONSTRAINT "outreach_tasks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_tasks" ADD CONSTRAINT "outreach_tasks_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_tasks" ADD CONSTRAINT "outreach_tasks_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outreach_attempts_hospital_id_idx" ON "outreach_attempts" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "outreach_attempts_task_id_idx" ON "outreach_attempts" USING btree ("outreach_task_id");--> statement-breakpoint
CREATE INDEX "outreach_tasks_hospital_id_idx" ON "outreach_tasks" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "outreach_tasks_campaign_id_idx" ON "outreach_tasks" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "outreach_tasks_patient_id_idx" ON "outreach_tasks" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "outreach_tasks_status_idx" ON "outreach_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outreach_tasks_scheduled_for_idx" ON "outreach_tasks" USING btree ("scheduled_for");