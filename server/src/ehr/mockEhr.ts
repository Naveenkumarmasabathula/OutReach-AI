import { and, eq } from "drizzle-orm";
import { assertDefined } from "../lib/assert.js";
import { AppError, NotFoundError } from "../lib/errors.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";
import {
  carePlans,
  communications,
  conditions,
  encounters,
  escalations,
  medications,
  observations,
  patients,
  procedures,
  tasks,
} from "../db/schema/index.js";
import { getHospitalByScope, getMockEhrConfig } from "../services/hospitalService.js";
import type {
  CreateEscalationInput,
  CreateFollowUpTaskInput,
  DischargeInfo,
  EHRInterface,
  MockEncounterUpdateInput,
  WriteCommunicationInput,
  WriteObservationInput,
} from "./types.js";

/**
 * Backs the EHR interface with our own database. See types.ts for the
 * contract this implements and why it exists. Every method opens its own
 * `withHospitalScope` transaction (the RLS session-variable boundary) —
 * callers never pass a raw DB handle in, only a `HospitalScope`.
 */
export class MockEHR implements EHRInterface {
  /**
   * PRD §4's "mock EHR integration settings" made real: reads the calling
   * hospital's `mockEhrConfig` (server/src/db/schema/hospitals.ts, validated
   * by `hospitalService.getMockEhrConfig`) and actually applies it — an
   * artificial delay to stand in for a real EHR's network latency, and a
   * random simulated failure to demonstrate the platform's reliability story
   * against an unreliable upstream integration. Both default to zero, so a
   * hospital that never configures this behaves exactly as before. Called at
   * the top of every public method below (this is the "EHR round trip" each
   * one represents).
   */
  private async simulateEhrCall(scope: HospitalScope): Promise<void> {
    const hospital = await getHospitalByScope(scope);
    const { simulatedLatencyMs, simulatedFailureRate } = getMockEhrConfig(hospital);

    if (simulatedLatencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, simulatedLatencyMs));
    }
    if (simulatedFailureRate > 0 && Math.random() < simulatedFailureRate) {
      throw new AppError(
        "Simulated EHR failure (hospital's configured mockEhrConfig.simulatedFailureRate triggered)",
        502,
        "EHR_SIMULATED_FAILURE",
      );
    }
  }

  async getPatient(scope: HospitalScope, patientId: string) {
    await this.simulateEhrCall(scope);
    const [patient] = await withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(patients)
        .where(and(eq(patients.id, patientId), eq(patients.hospitalId, scope.hospitalId))),
    );
    if (!patient) throw new NotFoundError("Patient not found");
    return patient;
  }

  async getEncounter(scope: HospitalScope, encounterId: string) {
    await this.simulateEhrCall(scope);
    const [encounter] = await withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(encounters)
        .where(and(eq(encounters.id, encounterId), eq(encounters.hospitalId, scope.hospitalId))),
    );
    if (!encounter) throw new NotFoundError("Encounter not found");
    return encounter;
  }

  async getDischargeInfo(scope: HospitalScope, encounterId: string): Promise<DischargeInfo> {
    const encounter = await this.getEncounter(scope, encounterId);
    return {
      encounterId: encounter.id,
      dischargeDate: encounter.dischargeDate,
      dischargeDisposition: encounter.dischargeDisposition,
      dischargeInstructions: encounter.dischargeInstructions,
      followUpWindowHours: encounter.followUpWindowHours,
    };
  }

  async getConditions(scope: HospitalScope, patientId: string) {
    await this.getPatient(scope, patientId); // confirms the patient is in scope, 404s otherwise
    await this.simulateEhrCall(scope);
    return withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(conditions)
        .where(and(eq(conditions.patientId, patientId), eq(conditions.hospitalId, scope.hospitalId))),
    );
  }

  async getObservations(scope: HospitalScope, patientId: string) {
    await this.getPatient(scope, patientId);
    await this.simulateEhrCall(scope);
    return withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(observations)
        .where(and(eq(observations.patientId, patientId), eq(observations.hospitalId, scope.hospitalId))),
    );
  }

  async getCarePlan(scope: HospitalScope, patientId: string) {
    await this.getPatient(scope, patientId);
    await this.simulateEhrCall(scope);
    return withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(carePlans)
        .where(and(eq(carePlans.patientId, patientId), eq(carePlans.hospitalId, scope.hospitalId))),
    );
  }

  // Fix #7 (reliability audit): `medications`/`procedures` (db/schema/clinical-records.ts)
  // existed as dead schema — never inserted by anything, never read through
  // the EHR interface — until seed.ts started populating them. Mirrors
  // getConditions/getObservations/getCarePlan exactly: confirm the patient
  // is in scope (404s otherwise), pay the same simulated-EHR-call cost, then
  // a plain scoped select.
  async getMedications(scope: HospitalScope, patientId: string) {
    await this.getPatient(scope, patientId);
    await this.simulateEhrCall(scope);
    return withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(medications)
        .where(and(eq(medications.patientId, patientId), eq(medications.hospitalId, scope.hospitalId))),
    );
  }

  async getProcedures(scope: HospitalScope, patientId: string) {
    await this.getPatient(scope, patientId);
    await this.simulateEhrCall(scope);
    return withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(procedures)
        .where(and(eq(procedures.patientId, patientId), eq(procedures.hospitalId, scope.hospitalId))),
    );
  }

  // Fix #2 (reliability audit): when `idempotencyKey` is supplied below, a
  // check-then-insert against the table's `(hospital_id, idempotency_key)`
  // unique index (see db/schema/*.ts) — first look for an existing row with
  // that key and return it unchanged if found, otherwise insert with
  // `onConflictDoNothing` as a second, DB-enforced guard against a genuine
  // race (two concurrent retries of the same duplicated job/event), then
  // re-select if the insert itself no-opped. Omitting `idempotencyKey`
  // (every pre-existing caller) skips straight to a plain insert — identical
  // to the old behavior. Written out per-table (not a shared generic helper)
  // so each insert stays fully typed against Drizzle's per-table column set.

  async writeCommunication(scope: HospitalScope, input: WriteCommunicationInput) {
    await this.getPatient(scope, input.patientId);
    if (input.encounterId) await this.getEncounter(scope, input.encounterId);
    await this.simulateEhrCall(scope);

    return withHospitalScope(scope, async (tx) => {
      const { idempotencyKey } = input;
      if (idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(communications)
          .where(and(eq(communications.hospitalId, scope.hospitalId), eq(communications.idempotencyKey, idempotencyKey)));
        if (existing) return existing;
      }

      const [record] = await tx
        .insert(communications)
        .values({
          hospitalId: scope.hospitalId,
          patientId: input.patientId,
          encounterId: input.encounterId ?? null,
          channel: input.channel,
          direction: input.direction,
          summary: input.summary,
          idempotencyKey: idempotencyKey ?? null,
          ...(input.sentAt ? { sentAt: input.sentAt } : {}),
        })
        .onConflictDoNothing({ target: [communications.hospitalId, communications.idempotencyKey] })
        .returning();
      if (record) return record;

      const [raced] = await tx
        .select()
        .from(communications)
        .where(and(eq(communications.hospitalId, scope.hospitalId), eq(communications.idempotencyKey, idempotencyKey!)));
      return assertDefined(raced, "communication insert returned no row and no existing row found after conflict");
    });
  }

  async writeObservation(scope: HospitalScope, input: WriteObservationInput) {
    await this.getPatient(scope, input.patientId);
    if (input.encounterId) await this.getEncounter(scope, input.encounterId);
    await this.simulateEhrCall(scope);

    return withHospitalScope(scope, async (tx) => {
      const { idempotencyKey } = input;
      if (idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(observations)
          .where(and(eq(observations.hospitalId, scope.hospitalId), eq(observations.idempotencyKey, idempotencyKey)));
        if (existing) return existing;
      }

      const [record] = await tx
        .insert(observations)
        .values({
          hospitalId: scope.hospitalId,
          patientId: input.patientId,
          encounterId: input.encounterId ?? null,
          category: input.category,
          value: input.value ?? null,
          unit: input.unit,
          source: input.source,
          idempotencyKey: idempotencyKey ?? null,
          ...(input.recordedAt ? { recordedAt: input.recordedAt } : {}),
        })
        .onConflictDoNothing({ target: [observations.hospitalId, observations.idempotencyKey] })
        .returning();
      if (record) return record;

      const [raced] = await tx
        .select()
        .from(observations)
        .where(and(eq(observations.hospitalId, scope.hospitalId), eq(observations.idempotencyKey, idempotencyKey!)));
      return assertDefined(raced, "observation insert returned no row and no existing row found after conflict");
    });
  }

  async createFollowUpTask(scope: HospitalScope, input: CreateFollowUpTaskInput) {
    await this.getPatient(scope, input.patientId);
    if (input.encounterId) await this.getEncounter(scope, input.encounterId);
    await this.simulateEhrCall(scope);

    return withHospitalScope(scope, async (tx) => {
      const { idempotencyKey } = input;
      if (idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.hospitalId, scope.hospitalId), eq(tasks.idempotencyKey, idempotencyKey)));
        if (existing) return existing;
      }

      const [record] = await tx
        .insert(tasks)
        .values({
          hospitalId: scope.hospitalId,
          patientId: input.patientId,
          encounterId: input.encounterId ?? null,
          type: input.type,
          dueAt: input.dueAt,
          notes: input.notes,
          assignedToUserId: input.assignedToUserId,
          idempotencyKey: idempotencyKey ?? null,
        })
        .onConflictDoNothing({ target: [tasks.hospitalId, tasks.idempotencyKey] })
        .returning();
      if (record) return record;

      const [raced] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.hospitalId, scope.hospitalId), eq(tasks.idempotencyKey, idempotencyKey!)));
      return assertDefined(raced, "task insert returned no row and no existing row found after conflict");
    });
  }

  async createEscalationRecord(scope: HospitalScope, input: CreateEscalationInput) {
    await this.getPatient(scope, input.patientId);
    if (input.encounterId) await this.getEncounter(scope, input.encounterId);
    await this.simulateEhrCall(scope);

    return withHospitalScope(scope, async (tx) => {
      const { idempotencyKey } = input;
      if (idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(escalations)
          .where(and(eq(escalations.hospitalId, scope.hospitalId), eq(escalations.idempotencyKey, idempotencyKey)));
        if (existing) return existing;
      }

      const [record] = await tx
        .insert(escalations)
        .values({
          hospitalId: scope.hospitalId,
          patientId: input.patientId,
          encounterId: input.encounterId ?? null,
          campaignId: input.campaignId ?? null,
          outreachTaskId: input.outreachTaskId ?? null,
          trigger: input.trigger,
          clinicalIndicators: input.clinicalIndicators ?? {},
          triageResult: input.triageResult,
          consensusResult: input.consensusResult,
          priority: input.priority,
          notes: input.notes,
          idempotencyKey: idempotencyKey ?? null,
        })
        .onConflictDoNothing({ target: [escalations.hospitalId, escalations.idempotencyKey] })
        .returning();
      if (record) return record;

      const [raced] = await tx
        .select()
        .from(escalations)
        .where(and(eq(escalations.hospitalId, scope.hospitalId), eq(escalations.idempotencyKey, idempotencyKey!)));
      return assertDefined(raced, "escalation insert returned no row and no existing row found after conflict");
    });
  }

  async updateEncounterMock(scope: HospitalScope, encounterId: string, input: MockEncounterUpdateInput) {
    await this.getEncounter(scope, encounterId); // 404s if out of scope before attempting the update
    await this.simulateEhrCall(scope);

    return withHospitalScope(scope, async (tx) => {
      const [updated] = await tx
        .update(encounters)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(encounters.id, encounterId), eq(encounters.hospitalId, scope.hospitalId)))
        .returning();
      return assertDefined(updated, "encounter update returned no row");
    });
  }
}
