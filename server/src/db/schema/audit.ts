import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { index, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { hospitals } from "./hospitals.js";

export const auditActorTypeEnum = pgEnum("audit_actor_type", ["user", "ai_agent", "system"]);

/**
 * The "regulated subject" pattern (docs/multi-tenancy.md §2): every read of
 * patient-identifying clinical data by a new class of reader (Phase 5's AI
 * agents) produces an audit row naming which actor read which patient's
 * data, and why — not just writes. Scoped exactly like every other
 * hospital-scoped table (RLS forced, see migration 0011).
 *
 * This table starts scoped to the AI-agent read path introduced in Phase 5
 * (see server/src/ehr/auditedEhr.ts) rather than every pre-existing
 * human-facing route — extending it to those is a real, separate, larger
 * refactor tracked as a Phase 10 follow-up in docs/known-limitations.md, not
 * silently skipped.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    hospitalId: text("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),

    actorType: auditActorTypeEnum("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    reason: text("reason"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_hospital_id_idx").on(table.hospitalId),
    index("audit_log_resource_idx").on(table.resourceType, table.resourceId),
    index("audit_log_actor_idx").on(table.actorType, table.actorId),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
