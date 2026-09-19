import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const hospitalStatusEnum = pgEnum("hospital_status", [
  "draft", // being configured, not yet ready for campaigns
  "active",
  "suspended",
]);

/**
 * The tenant root. Every hospital-scoped table carries a `hospital_id` FK back to
 * this table (see docs/multi-tenancy.md). Hospital-level `slug` is globally unique
 * on purpose (unlike sub-tenant resources such as campaigns, which must use
 * tenant-scoped uniqueness) since it's the tenant identifier itself.
 */
export const hospitals = pgTable("hospitals", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: hospitalStatusEnum("status").notNull().default("draft"),

  timezone: text("timezone").notNull().default("UTC"),
  // Default permitted outbound calling window, hospital-local time, "HH:mm".
  // Campaigns may narrow this further but must never widen it.
  callingHoursStart: text("calling_hours_start").notNull().default("08:00"),
  callingHoursEnd: text("calling_hours_end").notNull().default("20:00"),

  // Max concurrent outbound calls for this hospital — the queue's concurrency
  // semaphore key is hospital_id, so this is also the tenant capacity limit.
  outboundCapacity: integer("outbound_capacity").notNull().default(10),
  maxRetries: integer("max_retries").notNull().default(3),

  // Non-engineering-configurable operational preferences: escalation reviewer
  // timeout, notification preferences (default delivery channel). Validated
  // by `hospitalSettingsSchema` and read via the getters in
  // hospitalService.ts. Kept as jsonb rather than dedicated columns because
  // shape varies per hospital and is not queried relationally.
  //
  // NOT stored here: mock-EHR connection settings (see the dedicated
  // `mockEhrConfig` column below) and knowledge resources (there is no
  // separate "knowledge resource" table/field — PRD §5's protocols and PRD
  // §4's knowledge resources are deliberately modeled as the same `protocols`
  // table; see docs/protocols-knowledge-retrieval.md).
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),

  // Per-hospital MockEHR simulation parameters (simulated call latency,
  // simulated failure rate) — read by MockEHR (server/src/ehr/mockEhr.ts) on
  // every EHR interface call via hospitalService.getMockEhrConfig, validated
  // by `mockEhrConfigSchema` in hospitalService.ts. A distinct column rather
  // than folded into `settings` because it configures the EHR abstraction
  // layer's simulated behavior, not hospital operational preferences.
  mockEhrConfig: jsonb("mock_ehr_config").notNull().default(sql`'{}'::jsonb`),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Hospital = typeof hospitals.$inferSelect;
export type NewHospital = typeof hospitals.$inferInsert;
