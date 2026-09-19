import { createId } from "@paralleldrive/cuid2";
import { index, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { hospitals } from "./hospitals.js";
import { patients } from "./patients.js";

export const careSettingEnum = pgEnum("care_setting", [
  "inpatient",
  "outpatient",
  "emergency",
  "surgical",
  "observation",
]);

export const encounterStatusEnum = pgEnum("encounter_status", ["in_progress", "discharged"]);

/**
 * Simplified FHIR-like Encounter resource — the discharge event that makes a
 * patient eligible for post-discharge outreach. `hospitalId` is denormalized
 * onto this table (not derived only via patients.hospitalId) so every query here
 * can filter tenant scope directly, matching the reference project's convention
 * of denormalizing tenant_id onto every directly-queried table.
 */
export const encounters = pgTable(
  "encounters",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    hospitalId: text("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),

    careSetting: careSettingEnum("care_setting").notNull(),
    status: encounterStatusEnum("status").notNull().default("in_progress"),

    admissionDate: timestamp("admission_date", { withTimezone: true }),
    dischargeDate: timestamp("discharge_date", { withTimezone: true }),
    dischargeDisposition: text("discharge_disposition"),
    dischargeInstructions: text("discharge_instructions"),

    // Clinical follow-up window, in hours from dischargeDate — drives queue
    // deadline pressure (see docs/implementation-plan.md Phase 3).
    followUpWindowHours: integer("follow_up_window_hours").notNull().default(72),

    // 1 (lowest clinical risk) .. 5 (highest) — matches how it's actually
    // used everywhere (frontend severity badges, eligibility min/max
    // filters): higher number = more clinically urgent. Note this is the
    // OPPOSITE direction from campaigns.priority (1 = highest there) — two
    // different fields with two different, independently natural
    // conventions (severity scale vs. project-priority scale). Combined
    // with follow-up window and campaign priority by the queue's scheduling
    // algorithm (server/src/services/queueService.ts), not used alone.
    riskLevel: integer("risk_level").notNull().default(3),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("encounters_hospital_id_idx").on(table.hospitalId),
    index("encounters_patient_id_idx").on(table.patientId),
    index("encounters_discharge_date_idx").on(table.dischargeDate),
  ],
);

export type Encounter = typeof encounters.$inferSelect;
export type NewEncounter = typeof encounters.$inferInsert;
