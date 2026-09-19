import { createId } from "@paralleldrive/cuid2";
import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { hospitals } from "./hospitals.js";

/**
 * PRD §21/§22's AI observability requirements ("agent/model, latency,
 * success/failure") persisted durably rather than only `logger.info`'d —
 * see server/src/ai/pipeline.ts's "AI triage pipeline run completed" log
 * line, which is the one structured line this table is meant to eventually
 * replace/duplicate into a queryable form. As of this table's creation,
 * nothing writes to it yet: `aiCallLogService.recordAiCall` (the intended
 * write helper) exists but pipeline.ts hasn't been wired to call it —
 * that's a deliberate, separate follow-up (pipeline.ts is owned by another
 * engineer concurrently; see docs/dashboards-analytics.md for the exact
 * status). `getAiUsageStats` in analyticsService.ts reads from this table
 * and will honestly report all-zero/empty results until that wiring lands.
 *
 * Deliberately minimal (PRD §22 asks for "AI usage" in aggregate, not a
 * full observability platform): one row per AI agent call, not per
 * sub-step, with just enough to compute call volume, success/failure rate,
 * and average latency, broken down by agent type and provider/model. Kept
 * free of any transcript/PHI content, matching PRD §21's "sensitive
 * healthcare information must not be unnecessarily written into logs" —
 * the same posture pipeline.ts's existing log line already takes.
 */
export const aiCallLog = pgTable(
  "ai_call_log",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    hospitalId: text("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),

    // e.g. "clinical_triage", "documentation", "escalation_decision" — which
    // AI agent/step in the pipeline made this call. Free-text rather than a
    // pgEnum since the set of agents is owned by ai/pipeline.ts, not this
    // table, and is expected to grow without needing a migration each time.
    agentType: text("agent_type").notNull(),
    // e.g. "gemini" (aiProvider.name in ai/pipeline.ts). Free-text for the
    // same reason as agentType.
    provider: text("provider").notNull(),
    model: text("model"),

    latencyMs: integer("latency_ms").notNull(),
    success: boolean("success").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ai_call_log_hospital_id_idx").on(table.hospitalId),
    index("ai_call_log_agent_type_idx").on(table.agentType),
    index("ai_call_log_created_at_idx").on(table.createdAt),
  ],
);

export type AiCallLogRow = typeof aiCallLog.$inferSelect;
export type NewAiCallLogRow = typeof aiCallLog.$inferInsert;
