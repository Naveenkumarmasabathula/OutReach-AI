import { createId } from "@paralleldrive/cuid2";
import { boolean, index, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { hospitals } from "./hospitals.js";

// PRD §5's own grouping of what a hospital's post-discharge protocols/knowledge
// covers — used to let retrieval narrow by "kind of thing needed" (e.g. an
// agent asking for red-flag indicators shouldn't also get escalation contacts).
export const protocolCategoryEnum = pgEnum("protocol_category", [
  "follow_up_questions",
  "red_flag_indicator",
  "specialty_instruction",
  "patient_guidance",
  "escalation_contact",
  "operational_rule",
]);

/**
 * Hospital-specific post-discharge protocol/knowledge entry (PRD §5).
 * `tags` narrows retrieval further within a category (e.g. specialty or
 * condition keywords like "cardiac", "diabetes", "general") without needing
 * a separate taxonomy table — see docs/protocols-knowledge-retrieval.md for
 * why a tag/keyword match is enough for now and how it upgrades later.
 *
 * `sourceReference` is required (not optional) because PRD §5 explicitly
 * requires clinical guidance to "preserve its source/protocol reference for
 * traceability" — every retrieval result must be able to cite where it came
 * from, so the field can't be blank.
 */
export const protocols = pgTable(
  "protocols",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    hospitalId: text("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),

    category: protocolCategoryEnum("category").notNull(),
    title: text("title").notNull(),
    tags: text("tags").array().notNull().default([]),
    content: text("content").notNull(),
    sourceReference: text("source_reference").notNull(),

    // Superseding a protocol keeps history instead of destructively editing
    // it out from under anything that already cited it (an escalation record,
    // a past AI retrieval) — see docs/protocols-knowledge-retrieval.md.
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("protocols_hospital_id_idx").on(table.hospitalId),
    index("protocols_category_idx").on(table.category),
    index("protocols_is_active_idx").on(table.isActive),
  ],
);

export type ProtocolCategory = (typeof protocolCategoryEnum.enumValues)[number];
export type Protocol = typeof protocols.$inferSelect;
export type NewProtocol = typeof protocols.$inferInsert;
