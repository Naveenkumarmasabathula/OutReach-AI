import { CircuitBreakerEHR } from "./circuitBreakerEhr.js";
import { MockEHR } from "./mockEhr.js";
import type { EHRInterface } from "./types.js";

export type * from "./types.js";
export { MockEHR };
export { ehrCircuitBreaker } from "./circuitBreakerEhr.js";

/**
 * The bound EHR implementation. Everything in the app imports `ehr` from
 * here rather than instantiating `MockEHR` itself — swapping in a future
 * `RealEHR` (implementing the same `EHRInterface`) is a one-line change to
 * this file and nothing else, per PRD §6's "replaceable" requirement.
 *
 * One shared instance, not one per hospital: every `EHRInterface` method
 * already takes a `HospitalScope`, so `MockEHR` reads that hospital's own
 * `mockEhrConfig` (simulated latency/failure rate) from the database on
 * each call rather than needing per-hospital construction — see
 * `MockEHR.simulateEhrCall` in mockEhr.ts.
 *
 * Wrapped in `CircuitBreakerEHR` (Fix #1, reliability audit) the same way
 * `AuditedEHR` wraps this same singleton at its own call sites (see
 * ai/pipeline.ts) — both are decorators over `EHRInterface`, so this one
 * line gives every caller of `ehr` (and everything `AuditedEHR` further
 * wraps around it) circuit-breaker protection for free, no other file
 * touched.
 */
export const ehr: EHRInterface = new CircuitBreakerEHR(new MockEHR());
