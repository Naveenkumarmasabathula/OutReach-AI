import { createId } from "@paralleldrive/cuid2";
import { boolean, date, index, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { hospitals } from "./hospitals.js";

export const contactMethodEnum = pgEnum("contact_method", ["phone", "sms", "email"]);

/**
 * Simplified FHIR-like Patient resource. `mrn` (medical record number) is unique
 * per hospital, not globally — tenant-scoped uniqueness, matching the pattern in
 * docs/multi-tenancy.md (a natural key must never be uniqued across tenants).
 */
export const patients = pgTable(
  "patients",
  {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    hospitalId: text("hospital_id")
      .notNull()
      .references(() => hospitals.id, { onDelete: "cascade" }),
    mrn: text("mrn").notNull(),

    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    dateOfBirth: date("date_of_birth"),

    phone: text("phone"),
    email: text("email"),
    preferredContactMethod: contactMethodEnum("preferred_contact_method").notNull().default("phone"),
    preferredLanguage: text("preferred_language").notNull().default("en"),
    communicationConsent: boolean("communication_consent").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("patients_hospital_id_idx").on(table.hospitalId),
    unique("patients_hospital_mrn_uq").on(table.hospitalId, table.mrn),
  ],
);

export type Patient = typeof patients.$inferSelect;
export type NewPatient = typeof patients.$inferInsert;
