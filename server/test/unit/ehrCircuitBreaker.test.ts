import { mintHospitalScope } from "../../src/db/scope.js";
import { CircuitBreakerEHR, ehrCircuitBreaker } from "../../src/ehr/circuitBreakerEhr.js";
import type { EHRInterface } from "../../src/ehr/types.js";
import { NotFoundError, ServiceUnavailableError } from "../../src/lib/errors.js";

/**
 * Fix #1 (reliability audit): PRD §22 circuit-breaking, applied to the EHR
 * interface via `CircuitBreakerEHR` — mirrors `test/unit/circuitBreaker.test.ts`'s
 * treatment of the AI provider breaker, but driven against a fake
 * `EHRInterface` (not a real network dependency) so failures are
 * deterministic and don't require the real docker-compose Postgres to be
 * misbehaving.
 */
function fakeEhr(overrides: Partial<EHRInterface> = {}): EHRInterface {
  const unimplemented = async () => {
    throw new Error("not implemented in this fake — override it for this test");
  };
  return {
    getPatient: unimplemented,
    getEncounter: unimplemented,
    getDischargeInfo: unimplemented,
    getConditions: unimplemented,
    getObservations: unimplemented,
    getCarePlan: unimplemented,
    getMedications: unimplemented,
    getProcedures: unimplemented,
    writeCommunication: unimplemented,
    writeObservation: unimplemented,
    createFollowUpTask: unimplemented,
    createEscalationRecord: unimplemented,
    updateEncounterMock: unimplemented,
    ...overrides,
  } as unknown as EHRInterface;
}

describe("CircuitBreakerEHR (Fix #1 — PRD §22 circuit breaking applied to the EHR interface)", () => {
  const scope = mintHospitalScope("test-hospital-ehr-breaker");

  afterEach(() => {
    ehrCircuitBreaker.recordSuccess(); // reset the shared breaker so later tests/files aren't affected
  });

  it("passes successful calls straight through and keeps the circuit closed", async () => {
    const patient = { id: "p1", firstName: "Ehra" } as never;
    const inner = fakeEhr({ getPatient: async () => patient });
    const wrapped = new CircuitBreakerEHR(inner);

    const result = await wrapped.getPatient(scope, "p1");
    expect(result).toBe(patient);
    expect(ehrCircuitBreaker.isOpen()).toBe(false);
  });

  it("does not trip the breaker on a NotFoundError — an expected 'no such record' answer, not an EHR outage", async () => {
    const inner = fakeEhr({
      getPatient: async () => {
        throw new NotFoundError("Patient not found");
      },
    });
    const wrapped = new CircuitBreakerEHR(inner);

    for (let i = 0; i < 5; i++) {
      await expect(wrapped.getPatient(scope, "missing")).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(ehrCircuitBreaker.isOpen()).toBe(false);
  });

  it("opens after repeated infra-style failures, then fails fast without calling the inner EHR again", async () => {
    let calls = 0;
    const inner = fakeEhr({
      writeCommunication: async () => {
        calls += 1;
        throw new Error("simulated EHR outage");
      },
    });
    const wrapped = new CircuitBreakerEHR(inner);
    const input = { patientId: "p1", channel: "phone" as const, direction: "outbound" as const, summary: "x" };

    await expect(wrapped.writeCommunication(scope, input)).rejects.toThrow("simulated EHR outage");
    await expect(wrapped.writeCommunication(scope, input)).rejects.toThrow("simulated EHR outage");
    await expect(wrapped.writeCommunication(scope, input)).rejects.toThrow("simulated EHR outage");
    expect(calls).toBe(3);
    expect(ehrCircuitBreaker.isOpen()).toBe(true);

    // A 4th call short-circuits: an explicit ServiceUnavailableError, and the
    // inner EHR is never actually invoked (no pointless retry against a
    // dependency already known to be down).
    await expect(wrapped.writeCommunication(scope, input)).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(calls).toBe(3);
  });

  it("an EHR write fails explicitly when the circuit is already open — no silent fallback/no-op, unlike the AI breaker's conservative substitute", async () => {
    ehrCircuitBreaker.recordFailure();
    ehrCircuitBreaker.recordFailure();
    ehrCircuitBreaker.recordFailure();
    expect(ehrCircuitBreaker.isOpen()).toBe(true);

    let calls = 0;
    const inner = fakeEhr({
      createEscalationRecord: async () => {
        calls += 1;
        return { id: "esc1" } as never;
      },
    });
    const wrapped = new CircuitBreakerEHR(inner);

    await expect(
      wrapped.createEscalationRecord(scope, { patientId: "p1", trigger: "t", priority: 1 }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(calls).toBe(0); // never even attempted — fast failure, not a hang or a doomed retry
  });

  it("recovers: closes again after a successful call once the circuit is open", async () => {
    ehrCircuitBreaker.recordFailure();
    ehrCircuitBreaker.recordFailure();
    ehrCircuitBreaker.recordFailure();
    expect(ehrCircuitBreaker.isOpen()).toBe(true);
    ehrCircuitBreaker.recordSuccess();
    expect(ehrCircuitBreaker.isOpen()).toBe(false);

    const inner = fakeEhr({ getEncounter: async () => ({ id: "e1" } as never) });
    const wrapped = new CircuitBreakerEHR(inner);
    await expect(wrapped.getEncounter(scope, "e1")).resolves.toEqual({ id: "e1" });
  });
});
