import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { hospitals } from "./hospitals.js";

export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft", // being configured
  "ready", // validated and ready to run
  "scheduled", // waiting for its configured start date
  "running", // outreach is active
  "paused", // new calls temporarily stopped
  "completed",
  "cancelled",
  "failed",
]);

/**
 * `eligibilityCriteria` shape (all optional — see src/services/eligibilityService.ts
 * for how each field narrows the candidate pool):
 *   { careSettings?: string[]; minRiskLevel?: number; maxRiskLevel?: number }
 * Communication consent is always required regardless of criteria — it's a
 * compliance floor, not a configurable business rule.
 */
export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    hospitalId: text("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    description: text("description"),
    status: campaignStatusEnum("status").notNull().default("draft"),

    eligibilityCriteria: jsonb("eligibility_criteria").notNull().default(sql`'{}'::jsonb`),
    // Patients are eligible only while within this many hours of their own
    // discharge — the campaign's outreach window, distinct from (and
    // combined with) each patient's individual encounter.followUpWindowHours.
    followUpWindowHours: integer("follow_up_window_hours").notNull().default(72),

    // Narrows the hospital's calling hours; must never widen them (validated
    // at markReady, not just at write time — see eligibilityService.ts).
    // NULL means "use the hospital's calling hours unchanged."
    callingHoursStart: text("calling_hours_start"),
    callingHoursEnd: text("calling_hours_end"),

    // 1 (highest) .. 5 (lowest) — the OPPOSITE direction from
    // encounters.riskLevel (where higher = more severe). This field follows
    // the project-priority convention (P1 = most important); riskLevel
    // follows a severity-scale convention (5 = worst). Used by the Phase 3
    // queue to arbitrate between competing campaigns.
    priority: integer("priority").notNull().default(3),
    // NULL means "use the hospital's maxRetries."
    retryLimit: integer("retry_limit"),
    // NULL means "share the hospital's full outboundCapacity with other
    // campaigns" — a per-campaign cap is a Phase 3 concern to enforce.
    outboundCapacity: integer("outbound_capacity"),

    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),

    // Escalation contact overrides / notification timing for this campaign —
    // kept minimal (jsonb) since full notification chains are Phase 6/7.
    escalationConfig: jsonb("escalation_config").notNull().default(sql`'{}'::jsonb`),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("campaigns_hospital_id_idx").on(table.hospitalId),
    index("campaigns_status_idx").on(table.status),
  ],
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
