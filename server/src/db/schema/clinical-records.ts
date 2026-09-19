import { createId } from "@paralleldrive/cuid2";
import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { encounters } from "./encounters.js";
import { hospitals } from "./hospitals.js";
import { patients } from "./patients.js";

const tenantScoped = {
  hospitalId: text("hospital_id")
    .notNull()
    .references(() => hospitals.id, { onDelete: "cascade" }),
  patientId: text("patient_id")
    .notNull()
    .references(() => patients.id, { onDelete: "cascade" }),
  encounterId: text("encounter_id").references(() => encounters.id, { onDelete: "cascade" }),
};

export const clinicalStatusEnum = pgEnum("clinical_status", ["active", "resolved", "inactive"]);

/** Simplified FHIR-like Condition resource. */
export const conditions = pgTable(
  "conditions",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    ...tenantScoped,
    description: text("description").notNull(),
    clinicalStatus: clinicalStatusEnum("clinical_status").notNull().default("active"),
    severity: text("severity"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("conditions_hospital_id_idx").on(table.hospitalId),
    index("conditions_patient_id_idx").on(table.patientId),
  ],
);

/** Simplified FHIR-like MedicationRequest/Medication resource. */
export const medications = pgTable(
  "medications",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    ...tenantScoped,
    name: text("name").notNull(),
    dosage: text("dosage"),
    frequency: text("frequency"),
    instructions: text("instructions"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("medications_hospital_id_idx").on(table.hospitalId),
    index("medications_patient_id_idx").on(table.patientId),
  ],
);

/** Simplified FHIR-like Procedure resource. */
export const procedures = pgTable(
  "procedures",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    ...tenantScoped,
    name: text("name").notNull(),
    performedAt: timestamp("performed_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("procedures_hospital_id_idx").on(table.hospitalId),
    index("procedures_patient_id_idx").on(table.patientId),
  ],
);

export const carePlanStatusEnum = pgEnum("care_plan_status", ["active", "completed"]);

/** Simplified FHIR-like CarePlan resource. */
export const carePlans = pgTable(
  "care_plans",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    ...tenantScoped,
    instructions: text("instructions").notNull(),
    status: carePlanStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("care_plans_hospital_id_idx").on(table.hospitalId),
    index("care_plans_patient_id_idx").on(table.patientId),
  ],
);

export const observationSourceEnum = pgEnum("observation_source", [
  "clinical_record",
  "ai_conversation",
  "manual",
]);

/**
 * Simplified FHIR-like Observation resource. Used both for baseline clinical
 * data imported at discharge and for structured indicators captured during an
 * AI outreach conversation (Phase 5) — `source` distinguishes the two, and
 * `callId` (added when the calls table exists in Phase 3/5) links the latter
 * back to the conversation that produced it, per docs/multi-tenancy.md's
 * traceability requirement for regulated/PHI reads.
 */
export const observations = pgTable(
  "observations",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    ...tenantScoped,
    category: text("category").notNull(), // e.g. "vital", "symptom", "red_flag"
    value: jsonb("value").notNull(),
    unit: text("unit"),
    source: observationSourceEnum("source").notNull().default("clinical_record"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // See communications.idempotencyKey (communications.ts) — same dedup
    // mechanism, used by MockEHR.writeObservation's check-then-insert.
    idempotencyKey: text("idempotency_key"),
  },
  (table) => [
    index("observations_hospital_id_idx").on(table.hospitalId),
    index("observations_patient_id_idx").on(table.patientId),
    uniqueIndex("observations_hospital_id_idempotency_key_idx").on(table.hospitalId, table.idempotencyKey),
  ],
);

export type Condition = typeof conditions.$inferSelect;
export type Medication = typeof medications.$inferSelect;
export type Procedure = typeof procedures.$inferSelect;
export type CarePlan = typeof carePlans.$inferSelect;
export type Observation = typeof observations.$inferSelect;
export type NewObservation = typeof observations.$inferInsert;
