CREATE TYPE "public"."protocol_category" AS ENUM('follow_up_questions', 'red_flag_indicator', 'specialty_instruction', 'patient_guidance', 'escalation_contact', 'operational_rule');--> statement-breakpoint
CREATE TABLE "protocols" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"category" "protocol_category" NOT NULL,
	"title" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"content" text NOT NULL,
	"source_reference" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "protocols_hospital_id_idx" ON "protocols" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "protocols_category_idx" ON "protocols" USING btree ("category");--> statement-breakpoint
CREATE INDEX "protocols_is_active_idx" ON "protocols" USING btree ("is_active");