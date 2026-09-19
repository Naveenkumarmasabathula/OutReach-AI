import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { patients } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";
import { ehr } from "../ehr/index.js";
import { assertDefined } from "../lib/assert.js";
import { type Pagination, toOffsetLimit } from "../lib/pagination.js";

export const createPatientSchema = z
  .object({
    mrn: z.string().min(1),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    dateOfBirth: z.string().date().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    preferredContactMethod: z.enum(["phone", "sms", "email"]).default("phone"),
    preferredLanguage: z.string().default("en"),
    communicationConsent: z.boolean().default(true),
  })
  // Enforced here too, not just in the frontend form — the API can be
  // called directly (a future import tool, a script), and a patient whose
  // stated preferred contact method has no matching value on file is a
  // patient the outreach queue can never actually reach, silently.
  .refine((input) => input.preferredContactMethod !== "email" || Boolean(input.email), {
    message: "email is required when preferredContactMethod is 'email'",
    path: ["email"],
  })
  .refine(
    (input) => !(input.preferredContactMethod === "phone" || input.preferredContactMethod === "sms") || Boolean(input.phone),
    { message: "phone is required when preferredContactMethod is 'phone' or 'sms'", path: ["phone"] },
  );
export type CreatePatientInput = z.infer<typeof createPatientSchema>;

/** hospitalId always comes from `scope`, never from `input` — see docs/multi-tenancy.md. */
export async function createPatient(scope: HospitalScope, input: CreatePatientInput) {
  return withHospitalScope(scope, async (tx) => {
    const [patient] = await tx
      .insert(patients)
      .values({ ...input, hospitalId: scope.hospitalId })
      .returning();
    return assertDefined(patient, "patient insert returned no row");
  });
}

export async function listPatients(scope: HospitalScope, pagination: Pagination) {
  const { offset, limit } = toOffsetLimit(pagination);
  return withHospitalScope(scope, async (tx) => {
    // Sequential, not Promise.all — see the equivalent comment in
    // encounterService.getPatientTimeline: these share one transaction's
    // single pg connection, which can't run them concurrently anyway.
    const data = await tx
      .select()
      .from(patients)
      .where(eq(patients.hospitalId, scope.hospitalId))
      .orderBy(desc(patients.createdAt))
      .limit(limit)
      .offset(offset);
    const totalRows = await tx.select({ total: count() }).from(patients).where(eq(patients.hospitalId, scope.hospitalId));
    const total = totalRows[0]?.total ?? 0;
    return { data, pagination: { page: pagination.page, limit: pagination.limit, total } };
  });
}

/**
 * Delegates to the EHR interface (server/src/ehr) — this is a direct,
 * single-resource read with no aggregation, exactly the shape the EHR
 * abstraction's `getPatient` covers, so there's no reason for this service
 * to also hold its own query for it. `getPatientTimeline` in
 * encounterService.ts deliberately does NOT delegate its per-resource reads
 * this way — see the comment there for why.
 */
export async function getPatientById(scope: HospitalScope, patientId: string) {
  return ehr.getPatient(scope, patientId);
}
