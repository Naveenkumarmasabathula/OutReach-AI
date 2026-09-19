import { CircuitBreaker } from "../ai/circuitBreaker.js";
import type { HospitalScope } from "../db/scope.js";
import { NotFoundError, ServiceUnavailableError } from "../lib/errors.js";
import type { EHRInterface } from "./types.js";

/**
 * PRD §22's circuit-breaking requirement, applied to the EHR interface —
 * previously only the AI provider had this (ai/circuitBreaker.ts). Reuses
 * that exact `CircuitBreaker` class (same closed/open/half-open state
 * machine, same failureThreshold/cooldown shape), not a new mechanism.
 *
 * What "degraded" means operationally for EHR, unlike AI: there is no safe
 * conservative fallback for a failed EHR call the way there is for a triage
 * classification (`degradedFallbackAssessment` in clinicalTriageAgent.ts).
 * A communication log, observation, follow-up task, or escalation record
 * that silently didn't get written would be a silent data-loss bug, not a
 * graceful degradation — and a read that returned fabricated data would be
 * worse than an explicit failure. So unlike the AI breaker, this decorator
 * never substitutes anything: every call, read or write, either succeeds
 * normally or throws a `ServiceUnavailableError` (503) — fast, not hung,
 * and never silently swallowed. Callers already treat a thrown error from
 * an EHR call as an operational failure today (BullMQ's own retry/backoff
 * on the outreach queue, or a 5xx surfaced to an HTTP caller); this only
 * makes the "EHR is currently unhealthy" case fail fast instead of
 * retrying/hanging against a dependency already known to be down.
 *
 * A `NotFoundError` (patient/encounter genuinely out of scope, or doesn't
 * exist) is deliberately NOT counted as a circuit failure and is rethrown
 * as-is without touching the breaker — that's the EHR correctly answering
 * "no such record," not the EHR being unreachable. Counting expected 404s
 * as outages would trip the breaker open on ordinary, well-formed traffic.
 */
export const ehrCircuitBreaker = new CircuitBreaker("ehr", 3, 60_000);

export class CircuitBreakerEHR implements EHRInterface {
  constructor(private readonly inner: EHRInterface) {}

  private async guarded<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    if (ehrCircuitBreaker.isOpen()) {
      throw new ServiceUnavailableError(
        `EHR circuit breaker is open — short-circuiting '${operation}' without attempting the call (repeated recent EHR failures; see docs/observability-reliability.md)`,
      );
    }
    try {
      const result = await fn();
      ehrCircuitBreaker.recordSuccess();
      return result;
    } catch (err) {
      if (err instanceof NotFoundError) throw err; // expected outcome, not an EHR failure
      ehrCircuitBreaker.recordFailure();
      throw err;
    }
  }

  getPatient: EHRInterface["getPatient"] = (scope, patientId) =>
    this.guarded("getPatient", () => this.inner.getPatient(scope, patientId));
  getEncounter: EHRInterface["getEncounter"] = (scope, encounterId) =>
    this.guarded("getEncounter", () => this.inner.getEncounter(scope, encounterId));
  getDischargeInfo: EHRInterface["getDischargeInfo"] = (scope, encounterId) =>
    this.guarded("getDischargeInfo", () => this.inner.getDischargeInfo(scope, encounterId));
  getConditions: EHRInterface["getConditions"] = (scope, patientId) =>
    this.guarded("getConditions", () => this.inner.getConditions(scope, patientId));
  getObservations: EHRInterface["getObservations"] = (scope, patientId) =>
    this.guarded("getObservations", () => this.inner.getObservations(scope, patientId));
  getCarePlan: EHRInterface["getCarePlan"] = (scope, patientId) =>
    this.guarded("getCarePlan", () => this.inner.getCarePlan(scope, patientId));
  getMedications: EHRInterface["getMedications"] = (scope, patientId) =>
    this.guarded("getMedications", () => this.inner.getMedications(scope, patientId));
  getProcedures: EHRInterface["getProcedures"] = (scope, patientId) =>
    this.guarded("getProcedures", () => this.inner.getProcedures(scope, patientId));

  writeCommunication: EHRInterface["writeCommunication"] = (scope, input) =>
    this.guarded("writeCommunication", () => this.inner.writeCommunication(scope, input));
  writeObservation: EHRInterface["writeObservation"] = (scope, input) =>
    this.guarded("writeObservation", () => this.inner.writeObservation(scope, input));
  createFollowUpTask: EHRInterface["createFollowUpTask"] = (scope, input) =>
    this.guarded("createFollowUpTask", () => this.inner.createFollowUpTask(scope, input));
  createEscalationRecord: EHRInterface["createEscalationRecord"] = (scope, input) =>
    this.guarded("createEscalationRecord", () => this.inner.createEscalationRecord(scope, input));
  updateEncounterMock: EHRInterface["updateEncounterMock"] = (scope, encounterId, input) =>
    this.guarded("updateEncounterMock", () => this.inner.updateEncounterMock(scope, encounterId, input));
}
