CREATE TABLE "ai_call_log" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"agent_type" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"latency_ms" integer NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_call_log" ADD CONSTRAINT "ai_call_log_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_call_log_hospital_id_idx" ON "ai_call_log" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "ai_call_log_agent_type_idx" ON "ai_call_log" USING btree ("agent_type");--> statement-breakpoint
CREATE INDEX "ai_call_log_created_at_idx" ON "ai_call_log" USING btree ("created_at");