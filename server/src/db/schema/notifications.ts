import { createId } from "@paralleldrive/cuid2";
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { hospitals } from "./hospitals.js";
import { users } from "./users.js";

export const notificationChannelEnum = pgEnum("notification_channel", ["dashboard", "email", "sms"]);
export const notificationStatusEnum = pgEnum("notification_status", ["simulated", "delivered", "failed"]);

/**
 * PRD §19: "Notifications may use an internal dashboard, email, SMS, or
 * another configurable mechanism, and delivery must be observable."
 * Resolved with the user (docs/implementation-plan.md Decision #6):
 * simulated/logged for now, matching the voice/AI placeholder posture — so
 * every row here has `status = 'simulated'` today, never a real send. The
 * table exists (rather than just a log line) specifically so "delivery must
 * be observable" means something a human or the frontend can actually query,
 * not just something that scrolls past in server logs. Swapping in a real
 * channel later (e.g. an email/SMS provider) only changes what
 * `notificationService.sendNotification` does after inserting this row —
 * the row itself, and everything that reads it, doesn't change.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    hospitalId: text("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    recipientUserId: text("recipient_user_id").references(() => users.id, { onDelete: "set null" }),

    channel: notificationChannelEnum("channel").notNull().default("dashboard"),
    status: notificationStatusEnum("status").notNull().default("simulated"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),

    relatedResourceType: text("related_resource_type").notNull(),
    relatedResourceId: text("related_resource_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // Fix #2 (reliability audit): same optional dedup key as the EHR write
    // tables (communications.idempotencyKey) — `sendNotification` does a
    // check-then-insert against it when a caller supplies one, so a retried
    // event/job can't create a duplicate notification row. Nullable/not
    // partial: Postgres unique indexes already treat every NULL as distinct.
    idempotencyKey: text("idempotency_key"),
  },
  (table) => [
    index("notifications_hospital_id_idx").on(table.hospitalId),
    index("notifications_recipient_idx").on(table.recipientUserId),
    index("notifications_resource_idx").on(table.relatedResourceType, table.relatedResourceId),
    uniqueIndex("notifications_hospital_id_idempotency_key_idx").on(table.hospitalId, table.idempotencyKey),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
