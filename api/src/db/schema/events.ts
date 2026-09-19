import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { hospitals } from "./hospitals.js";

/**
 * PRD §18: an append-only log of the platform's "important events"
 * (campaign lifecycle, task/retry/callback transitions, escalation
 * lifecycle, notification delivery). `processedAt` is the idempotency
 * marker a consumer checks before acting — set once, by whichever consumer
 * run (including a duplicate BullMQ delivery) processes it first, so a
 * redelivered or manually-replayed event is a safe no-op rather than a
 * double side effect. See docs/workflows-events.md.
 */
export const appEvents = pgTable(
  "app_events",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    hospitalId: text("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),

    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    processedAt: timestamp("processed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("app_events_hospital_id_idx").on(table.hospitalId),
    index("app_events_type_idx").on(table.type),
    index("app_events_processed_at_idx").on(table.processedAt),
  ],
);

export type AppEventRow = typeof appEvents.$inferSelect;
export type NewAppEventRow = typeof appEvents.$inferInsert;
