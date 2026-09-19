CREATE TYPE "public"."notification_channel" AS ENUM('dashboard', 'email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('simulated', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"hospital_id" text NOT NULL,
	"recipient_user_id" text,
	"channel" "notification_channel" DEFAULT 'dashboard' NOT NULL,
	"status" "notification_status" DEFAULT 'simulated' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"related_resource_type" text NOT NULL,
	"related_resource_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_hospital_id_hospitals_id_fk" FOREIGN KEY ("hospital_id") REFERENCES "public"."hospitals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_hospital_id_idx" ON "notifications" USING btree ("hospital_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "notifications_resource_idx" ON "notifications" USING btree ("related_resource_type","related_resource_id");