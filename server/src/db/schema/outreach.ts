import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns.js";
import { encounters } from "./encounters.js";
import { hospitals } from "./hospitals.js";
import { patients } from "./patients.js";

/**
 * The queue's *disposition* for a task — where it currently sits in the
 * outreach lifecycle. Deliberately distinct from `attemptOutcomeEnum` below
 * (what happened on one specific call): PRD §9 lists NO_ANSWER/BUSY/
 * VOICEMAIL/DROPPED as states, but treating them as resting task statuses
 * would blur "what happened last" with "what the queue should do about it."
 * Here they're outcomes that drive a transition to one of these statuses
 * instead — see docs/queue-design.md for the full state machine and why.
 */
export const outreachTaskStatusEnum = pgEnum("outreach_task_status", [
  "pending", // newly enqueued, claimable as soon as capacity/calling-hours allow
  "scheduled", // claimable only once scheduledFor arrives (calling-hours deferral)
  "calling", // claimed by a worker, attempt in progress (holds a capacity slot)
  "retry_scheduled",
  "callback_scheduled",
  "escalated",
  "manual_follow_up",
  "completed",
  "cancelled",
  "failed",
]);

export const attemptOutcomeEnum = pgEnum("attempt_outcome", [
  "completed",
  "no_answer",
  "busy",
  "voicemail",
  "dropped",
  "invalid_number",
  "declined",
  "callback_requested",
  "escalated",
  "technical_failure",
]);

/**
 * The actual queue-managed unit of work: one patient's outreach for one
 * campaign. `hospitalId` is both the tenant-scope column and the
 * concurrency-semaphore key the scheduler enforces capacity against — see
 * docs/queue-design.md.
 */
export const outreachTasks = pgTable(
  "outreach_tasks",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    hospitalId: text("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    patientId: text("patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    encounterId: text("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),

    status: outreachTaskStatusEnum("status").notNull().default("pending"),

    attemptCount: integer("attempt_count").notNull().default(0),
    // Denormalized at task creation from campaign.retryLimit ?? hospital.maxRetries,
    // so a later config change doesn't retroactively change in-flight tasks'
    // budgets. Total attempts allowed, including the first (retryLimit + 1).
    maxAttempts: integer("max_attempts").notNull(),

    // Earliest time this task may be claimed. Governs retry backoff,
    // calling-hours deferral, and callback timing all through one field.
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    callbackRequestedFor: timestamp("callback_requested_for", { withTimezone: true }),

    // encounter.dischargeDate + encounter.followUpWindowHours, snapshotted at
    // creation — the clinical deadline driving deadline-pressure scoring.
    clinicalDeadline: timestamp("clinical_deadline", { withTimezone: true }).notNull(),

    // Set only while status = 'calling'; a worker crash leaves this stale,
    // which is exactly what the recovery sweep looks for.
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),

    // Persisted across attempts — prior symptoms discussed, unanswered
    // questions, dropped-call partial state. Phase 5 populates/reads this;
    // the shape is intentionally open (jsonb) until that agent exists.
    conversationContext: jsonb("conversation_context").notNull().default(sql`'{}'::jsonb`),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("outreach_tasks_hospital_id_idx").on(table.hospitalId),
    index("outreach_tasks_campaign_id_idx").on(table.campaignId),
    index("outreach_tasks_patient_id_idx").on(table.patientId),
    index("outreach_tasks_status_idx").on(table.status),
    index("outreach_tasks_scheduled_for_idx").on(table.scheduledFor),
    // DB-level backstop for enqueueEligiblePatients's own app-level dedup
    // check (a `SELECT` inside the same transaction as the `INSERT`, which
    // only prevents a race within a single transaction, not across two
    // concurrent transactions — e.g. a resume racing a scheduler tick). A
    // plain (non-partial) unique index would also block a patient from ever
    // being re-enrolled in the same campaign after a prior task there
    // legitimately finished (completed/cancelled/failed) — so this is
    // *partial*, only covering non-terminal statuses, matching PRD §11's
    // "prevent duplicate calls" without also blocking legitimate
    // re-enrollment. See docs/queue-design.md's "Duplicate-enqueue safety"
    // section for the full justification.
    uniqueIndex("outreach_tasks_active_unique_idx")
      .on(table.hospitalId, table.campaignId, table.patientId, table.encounterId)
      .where(sql`${table.status} NOT IN ('completed', 'cancelled', 'failed')`),
  ],
);

/**
 * One row per call attempt — the audit trail `outreach_tasks.attemptCount`
 * summarizes. Kept separate from the task so a task's full attempt history
 * survives even though the task itself only tracks current disposition.
 */
export const outreachAttempts = pgTable(
  "outreach_attempts",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    hospitalId: text("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    outreachTaskId: text("outreach_task_id")
      .notNull()
      .references(() => outreachTasks.id, { onDelete: "cascade" }),

    attemptNumber: integer("attempt_number").notNull(),
    outcome: attemptOutcomeEnum("outcome").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    notes: text("notes"),

    // Added in Phase 5 (AI Agent Layer) — null for every non-connected outcome
    // (no_answer/busy/voicemail/...), since no conversation happened. PRD §12's
    // "every call maintains a record... conversation record/transcript where
    // available, AI outputs, triage result, escalation result, documentation
    // status" — this is that record. See docs/ai-usage.md.
    transcript: jsonb("transcript"),
    triageResult: jsonb("triage_result"),
    consensusResult: jsonb("consensus_result"),
    documentationStatus: text("documentation_status"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("outreach_attempts_hospital_id_idx").on(table.hospitalId),
    index("outreach_attempts_task_id_idx").on(table.outreachTaskId),
  ],
);

export type OutreachTask = typeof outreachTasks.$inferSelect;
export type NewOutreachTask = typeof outreachTasks.$inferInsert;
export type OutreachAttempt = typeof outreachAttempts.$inferSelect;
export type NewOutreachAttempt = typeof outreachAttempts.$inferInsert;
