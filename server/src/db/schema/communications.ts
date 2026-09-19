import { createId } from "@paralleldrive/cuid2";
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { encounters } from "./encounters.js";
import { hospitals } from "./hospitals.js";
import { patients } from "./patients.js";
import { users } from "./users.js";

export const communicationChannelEnum = pgEnum("communication_channel", ["phone", "sms", "email"]);
export const communicationDirectionEnum = pgEnum("communication_direction", ["outbound", "inbound"]);

/**
 * Simplified FHIR-like Communication resource — the record of what was
 * communicated to/from a patient. `callId` is added in Phase 3/5 once the
 * outreach-task/call tables exist, linking this back to the conversation that
 * produced it.
 */
export const communications = pgTable(
  "communications",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    hospitalId: text("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    encounterId: text("encounter_id").references(() => encounters.id, { onDelete: "cascade" }),

    channel: communicationChannelEnum("channel").notNull(),
    direction: communicationDirectionEnum("direction").notNull(),
    summary: text("summary").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // Fix #2 (reliability audit): an optional caller-supplied dedup key
    // (e.g. `<outreachTaskId>:communication`) so a retried job/event can't
    // double-insert the same communication row — see mockEhr.ts's
    // check-then-insert. Nullable and NOT part of a partial index: Postgres
    // treats every NULL as distinct in a unique index, so rows from callers
    // that don't supply one (the common case today) never collide with each
    // other.
    idempotencyKey: text("idempotency_key"),
  },
  (table) => [
    index("communications_hospital_id_idx").on(table.hospitalId),
    index("communications_patient_id_idx").on(table.patientId),
    uniqueIndex("communications_hospital_id_idempotency_key_idx").on(table.hospitalId, table.idempotencyKey),
  ],
);

export const taskTypeEnum = pgEnum("task_type", ["manual_follow_up", "callback", "escalation_follow_up"]);
export const taskStatusEnum = pgEnum("task_status", ["requested", "in_progress", "completed", "cancelled"]);

/** Simplified FHIR-like Task resource — manual follow-ups and callbacks. */
export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    hospitalId: text("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    encounterId: text("encounter_id").references(() => encounters.id, { onDelete: "cascade" }),
    assignedToUserId: text("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),

    type: taskTypeEnum("type").notNull(),
    status: taskStatusEnum("status").notNull().default("requested"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    // See `communications.idempotencyKey` above — same dedup mechanism.
    idempotencyKey: text("idempotency_key"),
  },
  (table) => [
    index("tasks_hospital_id_idx").on(table.hospitalId),
    index("tasks_patient_id_idx").on(table.patientId),
    index("tasks_status_idx").on(table.status),
    uniqueIndex("tasks_hospital_id_idempotency_key_idx").on(table.hospitalId, table.idempotencyKey),
  ],
);

export type Communication = typeof communications.$inferSelect;
export type NewCommunication = typeof communications.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
