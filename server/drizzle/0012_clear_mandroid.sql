ALTER TABLE "escalations" ADD COLUMN "campaign_id" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "outreach_task_id" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "triage_result" jsonb;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "consensus_result" jsonb;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "assigned_reviewer_id" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_outreach_task_id_outreach_tasks_id_fk" FOREIGN KEY ("outreach_task_id") REFERENCES "public"."outreach_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_assigned_reviewer_id_users_id_fk" FOREIGN KEY ("assigned_reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "escalations_assigned_reviewer_idx" ON "escalations" USING btree ("assigned_reviewer_id");