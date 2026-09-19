-- Backfills SQL for a schema change that was applied directly to a live
-- dev database (via ad-hoc ALTERs during concurrent multi-agent work) but
-- never captured in a committed migration file — found by diffing a
-- from-scratch replay of migrations 0000-0020 against the live dev DB's
-- actual schema. schema.ts (and the 0020 snapshot) already reflect these
-- columns; this migration is what makes a fresh `db:migrate` run actually
-- reproduce that same end state instead of silently omitting it.
ALTER TABLE "communications" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "communications_hospital_id_idempotency_key_idx" ON "communications" USING btree ("hospital_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "escalations" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "escalations_hospital_id_idempotency_key_idx" ON "escalations" USING btree ("hospital_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_hospital_id_idempotency_key_idx" ON "notifications" USING btree ("hospital_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "observations" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "observations_hospital_id_idempotency_key_idx" ON "observations" USING btree ("hospital_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_hospital_id_idempotency_key_idx" ON "tasks" USING btree ("hospital_id","idempotency_key");
