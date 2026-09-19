import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { hospitals } from "./hospitals.js";

export const userRoleEnum = pgEnum("user_role", [
  "PLATFORM_ADMIN",
  "HOSPITAL_ADMIN",
  "CAMPAIGN_MANAGER",
  "CLINICAL_REVIEWER",
]);

export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);

/**
 * hospital_id is nullable only for PLATFORM_ADMIN (cross-hospital, no single
 * tenant). Every other role must belong to exactly one hospital — enforced by
 * the check constraint below, not just application code.
 */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    hospitalId: text("hospital_id").references(() => hospitals.id, { onDelete: "cascade" }),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: userRoleEnum("role").notNull(),
    status: userStatusEnum("status").notNull().default("active"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("users_hospital_id_idx").on(table.hospitalId),
    check(
      "users_platform_admin_has_no_hospital",
      sql`(${table.role} = 'PLATFORM_ADMIN' AND ${table.hospitalId} IS NULL) OR (${table.role} != 'PLATFORM_ADMIN' AND ${table.hospitalId} IS NOT NULL)`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
