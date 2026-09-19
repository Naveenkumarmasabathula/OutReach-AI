CREATE TYPE "public"."escalation_status" AS ENUM('open', 'assigned', 'in_review', 'waiting_for_information', 'resolved', 'closed');--> statement-breakpoint
CREATE TABLE "escalations" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"encounter_id" text,
	"trigger" text NOT NULL,
	"clinical_indicators" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"status" "escalation_status" DEFAULT 'open' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "escalations_hospital_id_idx" ON "escalations" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "escalations_patient_id_idx" ON "escalations" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "escalations_status_idx" ON "escalations" USING btree ("status");