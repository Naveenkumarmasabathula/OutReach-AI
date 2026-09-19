CREATE TABLE "app_events" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_events" ADD CONSTRAINT "app_events_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_events_hospital_id_idx" ON "app_events" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "app_events_type_idx" ON "app_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "app_events_processed_at_idx" ON "app_events" USING btree ("processed_at");