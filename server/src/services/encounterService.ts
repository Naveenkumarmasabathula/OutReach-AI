import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  carePlans,
  communications,
  conditions,
  encounters,
  escalations,
  medications,
  observations,
  outreachAttempts,
  outreachTasks,
  procedures,
  tasks,
} from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";
import { ehr } from "../ehr/index.js";
import { assertDefined } from "../lib/assert.js";
import { getPatientById } from "./patientService.js";

export const createEncounterSchema = z.object({
  patientId: z.string().min(1),
  careSetting: z.enum(["inpatient", "outpatient", "emergency", "surgical", "observation"]),
  admissionDate: z.coerce.date().optional(),
  dischargeDate: z.coerce.date().optional(),
  dischargeDisposition: z.string().optional(),
  dischargeInstructions: z.string().optional(),
  followUpWindowHours: z.number().int().positive().default(72),
  riskLevel: z.number().int().min(1).max(5).default(3),
});
export type CreateEncounterInput = z.infer<typeof createEncounterSchema>;

export async function createEncounter(scope: HospitalScope, input: CreateEncounterInput) {
  // Confirms the patient belongs to this hospital before creating the
  // encounter — a bare patientId is never trusted on its own.
  await getPatientById(scope, input.patientId);

  return withHospitalScope(scope, async (tx) => {
    const [encounter] = await tx
      .insert(encounters)
      // Every encounter created through this endpoint already carries
      // discharge fields (dischargeDate/disposition/instructions) — it
      // represents a completed discharge, not an admission still in
      // progress. Without this, the row silently kept the table's
      // "in_progress" default, which made every such patient invisible to
      // the eligibility engine (status must be "discharged" to qualify) —
      // found via campaign-lifecycle.test.ts's workload-estimate assertion.
      .values({ ...input, hospitalId: scope.hospitalId, status: "discharged" })
      .returning();
    return assertDefined(encounter, "encounter insert returned no row");
  });
}

/** Delegates to the EHR interface — see the equivalent comment on patientService.getPatientById. */
export async function getEncounterById(scope: HospitalScope, encounterId: string) {
  return ehr.getEncounter(scope, encounterId);
}

/**
 * Patient history/timeline view (PRD §31 must-have): every clinical
 * sub-resource for one patient, all filtered by the same hospital scope.
 *
 * Deliberately does NOT delegate its per-resource reads to the EHR
 * interface's getConditions/getObservations/getCarePlan, even though they
 * cover 3 of these 8 resources: those each open their own
 * `withHospitalScope` transaction, and this view's whole point is fetching
 * all 8 resource types as one consistent snapshot in a single transaction
 * via `Promise.all`. Splitting that into several independent transactions
 * would weaken the consistency guarantee and add round trips for a
 * UI-specific aggregate that isn't itself an EHR read/write operation.
 */
export async function getPatientTimeline(scope: HospitalScope, patientId: string) {
  await getPatientById(scope, patientId);

  return withHospitalScope(scope, async (tx) => {
    const byPatient = (
      table:
        | typeof encounters
        | typeof conditions
        | typeof medications
        | typeof procedures
        | typeof carePlans
        | typeof observations
        | typeof communications
        | typeof tasks
        | typeof outreachTasks
        | typeof escalations,
    ) =>
      and(eq(table.patientId, patientId), eq(table.hospitalId, scope.hospitalId));

    // Sequential, not Promise.all: these all share one transaction's single
    // pg connection, and node-postgres only tolerates (and is deprecating)
    // concurrent queries issued on one Client without awaiting each in turn.
    // A single Postgres transaction can't run its statements in parallel
    // anyway, so this costs nothing — a single connection processes them one
    // at a time either way.
    const patientEncounters = await tx.select().from(encounters).where(byPatient(encounters));
    const patientConditions = await tx.select().from(conditions).where(byPatient(conditions));
    const patientMedications = await tx.select().from(medications).where(byPatient(medications));
    const patientProcedures = await tx.select().from(procedures).where(byPatient(procedures));
    const patientCarePlans = await tx.select().from(carePlans).where(byPatient(carePlans));
    const patientObservations = await tx.select().from(observations).where(byPatient(observations));
    const patientCommunications = await tx.select().from(communications).where(byPatient(communications));
    const patientTasks = await tx.select().from(tasks).where(byPatient(tasks));
    // PRD §20's patient operational view also wants "outreach status, call
    // history, outcomes, escalations" — added here (Phase 8) rather than a
    // separate endpoint, since this is already the one "give me everything
    // about this patient" call every prior phase has extended in place.
    const patientOutreachTasks = await tx.select().from(outreachTasks).where(byPatient(outreachTasks));
    const patientOutreachAttempts =
      patientOutreachTasks.length > 0
        ? await tx
            .select()
            .from(outreachAttempts)
            .where(
              and(
                eq(outreachAttempts.hospitalId, scope.hospitalId),
                inArray(
                  outreachAttempts.outreachTaskId,
                  patientOutreachTasks.map((t) => t.id),
                ),
              ),
            )
        : [];
    const patientEscalations = await tx.select().from(escalations).where(byPatient(escalations));

    return {
      encounters: patientEncounters,
      conditions: patientConditions,
      medications: patientMedications,
      procedures: patientProcedures,
      carePlans: patientCarePlans,
      observations: patientObservations,
      communications: patientCommunications,
      tasks: patientTasks,
      outreachTasks: patientOutreachTasks,
      outreachAttempts: patientOutreachAttempts,
      escalations: patientEscalations,
    };
  });
}
