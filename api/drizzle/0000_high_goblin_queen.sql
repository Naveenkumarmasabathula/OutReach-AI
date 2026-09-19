CREATE TYPE "public"."hospital_status" AS ENUM('draft', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('PLATFORM_ADMIN', 'HOSPITAL_ADMIN', 'CAMPAIGN_MANAGER', 'CLINICAL_REVIEWER');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."contact_method" AS ENUM('phone', 'sms', 'email');--> statement-breakpoint
CREATE TYPE "public"."care_setting" AS ENUM('inpatient', 'outpatient', 'emergency', 'surgical', 'observation');--> statement-breakpoint
CREATE TYPE "public"."encounter_status" AS ENUM('in_progress', 'discharged');--> statement-breakpoint
CREATE TYPE "public"."care_plan_status" AS ENUM('active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."clinical_status" AS ENUM('active', 'resolved', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."observation_source" AS ENUM('clinical_record', 'ai_conversation', 'manual');--> statement-breakpoint
CREATE TYPE "public"."communication_channel" AS ENUM('phone', 'sms', 'email');--> statement-breakpoint
CREATE TYPE "public"."communication_direction" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('requested', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('manual_follow_up', 'callback', 'escalation_follow_up');--> statement-breakpoint
CREATE TABLE "hospitals" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "hospital_status" DEFAULT 'draft' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"calling_hours_start" text DEFAULT '08:00' NOT NULL,
	"calling_hours_end" text DEFAULT '20:00' NOT NULL,
	"outbound_capacity" integer DEFAULT 10 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospitals_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_platform_admin_has_no_hospital" CHECK (("users"."role" = 'PLATFORM_ADMIN' AND "users"."hospital_id" IS NULL) OR ("users"."role" != 'PLATFORM_ADMIN' AND "users"."hospital_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"mrn" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date,
	"phone" text,
	"email" text,
	"preferred_contact_method" "contact_method" DEFAULT 'phone' NOT NULL,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"communication_consent" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_hospital_mrn_uq" UNIQUE("hospital_id","mrn")
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"care_setting" "care_setting" NOT NULL,
	"status" "encounter_status" DEFAULT 'in_progress' NOT NULL,
	"admission_date" timestamp with time zone,
	"discharge_date" timestamp with time zone,
	"discharge_disposition" text,
	"discharge_instructions" text,
	"follow_up_window_hours" integer DEFAULT 72 NOT NULL,
	"risk_level" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"encounter_id" text,
	"instructions" text NOT NULL,
	"status" "care_plan_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conditions" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"encounter_id" text,
	"description" text NOT NULL,
	"clinical_status" "clinical_status" DEFAULT 'active' NOT NULL,
	"severity" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"encounter_id" text,
	"name" text NOT NULL,
	"dosage" text,
	"frequency" text,
	"instructions" text,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"encounter_id" text,
	"category" text NOT NULL,
	"value" jsonb NOT NULL,
	"unit" text,
	"source" "observation_source" DEFAULT 'clinical_record' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procedures" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"encounter_id" text,
	"name" text NOT NULL,
	"performed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communications" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"encounter_id" text,
	"channel" "communication_channel" NOT NULL,
	"direction" "communication_direction" NOT NULL,
	"summary" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"encounter_id" text,
	"assigned_to_user_id" text,
	"type" "task_type" NOT NULL,
	"status" "task_status" DEFAULT 'requested' NOT NULL,
	"due_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_plans" ADD CONSTRAINT "care_plans_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conditions" ADD CONSTRAINT "conditions_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_hospital_id_idx" ON "users" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "patients_hospital_id_idx" ON "patients" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "encounters_hospital_id_idx" ON "encounters" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "encounters_patient_id_idx" ON "encounters" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "encounters_discharge_date_idx" ON "encounters" USING btree ("discharge_date");--> statement-breakpoint
CREATE INDEX "care_plans_hospital_id_idx" ON "care_plans" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "care_plans_patient_id_idx" ON "care_plans" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "conditions_hospital_id_idx" ON "conditions" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "conditions_patient_id_idx" ON "conditions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "medications_hospital_id_idx" ON "medications" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "medications_patient_id_idx" ON "medications" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "observations_hospital_id_idx" ON "observations" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "observations_patient_id_idx" ON "observations" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "procedures_hospital_id_idx" ON "procedures" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "procedures_patient_id_idx" ON "procedures" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "communications_hospital_id_idx" ON "communications" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "communications_patient_id_idx" ON "communications" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "tasks_hospital_id_idx" ON "tasks" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "tasks_patient_id_idx" ON "tasks" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");