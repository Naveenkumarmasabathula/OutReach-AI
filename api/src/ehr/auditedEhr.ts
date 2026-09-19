import type { HospitalScope } from "../db/scope.js";
import type { AuditActor } from "../lib/audit.js";
import { recordAudit } from "../lib/audit.js";
import type { EHRInterface } from "./types.js";

/**
 * Decorates any `EHRInterface` implementation with per-read PHI audit
 * logging for a given actor — the "regulated subject" pattern
 * (docs/multi-tenancy.md §2), applied first to the AI agent layer (Phase 5)
 * since that's the new class of PHI reader this phase introduces. A
 * decorator, not a change to `MockEHR` itself, so Phase 1's tested
 * implementation is untouched; extending this same wrapping to
 * human-facing routes is a documented Phase 10 follow-up (see
 * docs/known-limitations.md), not done here.
 *
 * Writes are not wrapped — PRD §5/§21's traceability requirement is about
 * reads of clinical data, and every write already produces its own durable
 * row (a communication, observation, escalation, task) that is itself the
 * record.
 */
export class AuditedEHR implements EHRInterface {
  constructor(
    private readonly inner: EHRInterface,
    private readonly actor: AuditActor,
    private readonly reason: string,
  ) {}

  private async audit(scope: HospitalScope, resourceType: string, resourceId: string) {
    await recordAudit(scope, {
      actor: this.actor,
      action: `${resourceType}.read`,
      resourceType,
      resourceId,
      reason: this.reason,
    });
  }

  async getPatient(scope: HospitalScope, patientId: string) {
    const result = await this.inner.getPatient(scope, patientId);
    await this.audit(scope, "patient", patientId);
    return result;
  }

  async getEncounter(scope: HospitalScope, encounterId: string) {
    const result = await this.inner.getEncounter(scope, encounterId);
    await this.audit(scope, "encounter", encounterId);
    return result;
  }

  async getDischargeInfo(scope: HospitalScope, encounterId: string) {
    const result = await this.inner.getDischargeInfo(scope, encounterId);
    await this.audit(scope, "discharge_info", encounterId);
    return result;
  }

  async getConditions(scope: HospitalScope, patientId: string) {
    const result = await this.inner.getConditions(scope, patientId);
    await this.audit(scope, "conditions", patientId);
    return result;
  }

  async getObservations(scope: HospitalScope, patientId: string) {
    const result = await this.inner.getObservations(scope, patientId);
    await this.audit(scope, "observations", patientId);
    return result;
  }

  async getCarePlan(scope: HospitalScope, patientId: string) {
    const result = await this.inner.getCarePlan(scope, patientId);
    await this.audit(scope, "care_plan", patientId);
    return result;
  }

  async getMedications(scope: HospitalScope, patientId: string) {
    const result = await this.inner.getMedications(scope, patientId);
    await this.audit(scope, "medications", patientId);
    return result;
  }

  async getProcedures(scope: HospitalScope, patientId: string) {
    const result = await this.inner.getProcedures(scope, patientId);
    await this.audit(scope, "procedures", patientId);
    return result;
  }

  writeCommunication: EHRInterface["writeCommunication"] = (scope, input) =>
    this.inner.writeCommunication(scope, input);
  writeObservation: EHRInterface["writeObservation"] = (scope, input) => this.inner.writeObservation(scope, input);
  createFollowUpTask: EHRInterface["createFollowUpTask"] = (scope, input) =>
    this.inner.createFollowUpTask(scope, input);
  createEscalationRecord: EHRInterface["createEscalationRecord"] = (scope, input) =>
    this.inner.createEscalationRecord(scope, input);
  updateEncounterMock: EHRInterface["updateEncounterMock"] = (scope, encounterId, input) =>
    this.inner.updateEncounterMock(scope, encounterId, input);
}
