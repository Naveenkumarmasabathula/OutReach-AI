import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns.js";
import { encounters } from "./encounters.js";
import { hospitals } from "./hospitals.js";
import { outreachTasks } from "./outreach.js";
import { patients } from "./patients.js";
import { users } from "./users.js";

export const escalationStatusEnum = pgEnum("escalation_status", [
  "open",
  "assigned",
  "in_review",
  "waiting_for_information",
  "resolved",
  "closed",
]);

/**
 * Added in Phase 1 as a minimal record (patient, hospital, encounter,
 * trigger, clinical indicators, priority, status) to support the EHR
 * abstraction's `createEscalationRecord` write ahead of full escalation
 * management. Extended here in Phase 6 with the remaining PRD §19 fields
 * (campaign, originating outreach task, both triage results, assigned
 * reviewer, resolution) rather than replaced — every column added below is
 * nullable so Phase 1/3/5's existing inserts (which don't set them) remain
 * valid, and a row created without a pipeline run (see queueService.ts's
 * "queue_forced_escalation" fallback) is still a complete, valid row.
 */
export const escalations = pgTable(
  "escalations",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    hospitalId: text("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    encounterId: text("encounter_id").references(() => encounters.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    outreachTaskId: text("outreach_task_id").references(() => outreachTasks.id, { onDelete: "set null" }),

    trigger: text("trigger").notNull(),
    clinicalIndicators: jsonb("clinical_indicators").notNull().default(sql`'{}'::jsonb`),
    // The two independent Phase 5 assessments and their consensus, kept
    // alongside `clinicalIndicators` (which already held a copy from Phase
    // 5) as their own first-class columns per PRD §19's explicit shape —
    // querying/displaying them doesn't require unpacking clinicalIndicators'
    // looser jsonb structure.
    triageResult: jsonb("triage_result"),
    consensusResult: jsonb("consensus_result"),

    priority: integer("priority").notNull().default(3),
    status: escalationStatusEnum("status").notNull().default("open"),
    notes: text("notes"),

    assignedReviewerId: text("assigned_reviewer_id").references(() => users.id, { onDelete: "set null" }),
    resolution: text("resolution"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    // See `communications.idempotencyKey` (communications.ts) — same dedup
    // mechanism, applied here so a retried/redelivered escalation-creating
    // event can't create a second escalation row for the same trigger.
    idempotencyKey: text("idempotency_key"),
  },
  (table) => [
    index("escalations_hospital_id_idx").on(table.hospitalId),
    index("escalations_patient_id_idx").on(table.patientId),
    index("escalations_status_idx").on(table.status),
    index("escalations_assigned_reviewer_idx").on(table.assignedReviewerId),
    uniqueIndex("escalations_hospital_id_idempotency_key_idx").on(table.hospitalId, table.idempotencyKey),
  ],
);

export type Escalation = typeof escalations.$inferSelect;
export type NewEscalation = typeof escalations.$inferInsert;
