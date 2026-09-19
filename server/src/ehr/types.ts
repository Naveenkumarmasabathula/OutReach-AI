import { z } from "zod";
import type { HospitalScope } from "../db/scope.js";
import type {
  CarePlan,
  Communication,
  Condition,
  Encounter,
  Escalation,
  Medication,
  Observation,
  Patient,
  Procedure,
  Task,
} from "../db/schema/index.js";

export type DischargeInfo = {
  encounterId: string;
  dischargeDate: Date | null;
  dischargeDisposition: string | null;
  dischargeInstructions: string | null;
  followUpWindowHours: number;
};

// Zod schemas for every write operation. These are the "validation" step in
// the AI -> controlled tool -> authorization -> validation -> EHR interface
// -> MockEHR -> database pipeline (PRD §6/§16): a future controlled-tool
// layer (Phase 5) parses an AI-proposed operation against these same
// schemas before ever calling the EHR interface, so validation happens
// once, not per-implementation.

// `idempotencyKey` (Fix #2, reliability audit): optional on every insert-style
// write below. When a caller supplies one (a natural key such as
// `<outreachTaskId>:<operation>`, e.g. from a retried BullMQ job or a
// redelivered event), `MockEHR` checks for an existing row with the same
// (hospitalId, idempotencyKey) before inserting and returns that row instead
// of inserting a duplicate — see mockEhr.ts and the
// `*_hospital_id_idempotency_key_idx` unique indexes in the schema. Omitting
// it (every existing caller, unchanged) behaves exactly as before: a plain
// insert, no dedup. Not applied to `updateEncounterMock` — a `SET` of
// specific fields is already idempotent by construction (re-applying the
// same update twice yields the same row state), unlike an insert.
const idempotencyKeyField = z.string().min(1).optional();

export const writeCommunicationSchema = z.object({
  patientId: z.string().min(1),
  encounterId: z.string().min(1).optional(),
  channel: z.enum(["phone", "sms", "email"]),
  direction: z.enum(["outbound", "inbound"]),
  summary: z.string().min(1),
  sentAt: z.coerce.date().optional(),
  idempotencyKey: idempotencyKeyField,
});
export type WriteCommunicationInput = z.infer<typeof writeCommunicationSchema>;

export const writeObservationSchema = z.object({
  patientId: z.string().min(1),
  encounterId: z.string().min(1).optional(),
  category: z.string().min(1),
  value: z.unknown(),
  unit: z.string().optional(),
  source: z.enum(["clinical_record", "ai_conversation", "manual"]).default("manual"),
  recordedAt: z.coerce.date().optional(),
  idempotencyKey: idempotencyKeyField,
});
export type WriteObservationInput = z.infer<typeof writeObservationSchema>;

export const createFollowUpTaskSchema = z.object({
  patientId: z.string().min(1),
  encounterId: z.string().min(1).optional(),
  type: z.enum(["manual_follow_up", "callback", "escalation_follow_up"]),
  dueAt: z.coerce.date().optional(),
  notes: z.string().optional(),
  assignedToUserId: z.string().min(1).optional(),
  idempotencyKey: idempotencyKeyField,
});
export type CreateFollowUpTaskInput = z.infer<typeof createFollowUpTaskSchema>;

export const createEscalationSchema = z.object({
  patientId: z.string().min(1),
  encounterId: z.string().min(1).optional(),
  campaignId: z.string().min(1).optional(),
  outreachTaskId: z.string().min(1).optional(),
  trigger: z.string().min(1),
  clinicalIndicators: z.unknown().optional(),
  triageResult: z.unknown().optional(),
  consensusResult: z.unknown().optional(),
  priority: z.number().int().min(1).max(5).default(3),
  notes: z.string().optional(),
  idempotencyKey: idempotencyKeyField,
});
export type CreateEscalationInput = z.infer<typeof createEscalationSchema>;

export const mockEncounterUpdateSchema = z.object({
  dischargeDisposition: z.string().optional(),
  dischargeInstructions: z.string().optional(),
  followUpWindowHours: z.number().int().positive().optional(),
  riskLevel: z.number().int().min(1).max(5).optional(),
  status: z.enum(["in_progress", "discharged"]).optional(),
});
export type MockEncounterUpdateInput = z.infer<typeof mockEncounterUpdateSchema>;

/**
 * The single boundary through which application logic (and, from Phase 5
 * on, controlled AI tools) touches clinical data — PRD §6. Nothing outside
 * this module runs a Drizzle query against patients/encounters/conditions/
 * observations/carePlans/communications/tasks/escalations directly once a
 * given read/write is covered here.
 *
 * Every method takes a `HospitalScope`, never a bare hospitalId — the same
 * "evidence a check ran" pattern as everywhere else (docs/multi-tenancy.md).
 * That's the "authorization" step already done by the time a call reaches
 * here; write inputs are the Zod-inferred types above, so "validation" is
 * also already done by the time a call reaches here. This interface is
 * only the last step: EHR interface -> (Mock|Real)EHR -> database.
 *
 * `MockEHR` (mockEhr.ts) is the only implementation today, backed by our
 * own tables. A future `RealEHR` (a real FHIR API integration, say) would
 * implement this same interface and could be swapped in at the single
 * binding point in `index.ts` — no calling code changes.
 */
export interface EHRInterface {
  getPatient(scope: HospitalScope, patientId: string): Promise<Patient>;
  getEncounter(scope: HospitalScope, encounterId: string): Promise<Encounter>;
  getDischargeInfo(scope: HospitalScope, encounterId: string): Promise<DischargeInfo>;
  getConditions(scope: HospitalScope, patientId: string): Promise<Condition[]>;
  getObservations(scope: HospitalScope, patientId: string): Promise<Observation[]>;
  getCarePlan(scope: HospitalScope, patientId: string): Promise<CarePlan[]>;
  getMedications(scope: HospitalScope, patientId: string): Promise<Medication[]>;
  getProcedures(scope: HospitalScope, patientId: string): Promise<Procedure[]>;

  writeCommunication(scope: HospitalScope, input: WriteCommunicationInput): Promise<Communication>;
  writeObservation(scope: HospitalScope, input: WriteObservationInput): Promise<Observation>;
  createFollowUpTask(scope: HospitalScope, input: CreateFollowUpTaskInput): Promise<Task>;
  createEscalationRecord(scope: HospitalScope, input: CreateEscalationInput): Promise<Escalation>;
  updateEncounterMock(scope: HospitalScope, encounterId: string, input: MockEncounterUpdateInput): Promise<Encounter>;
}
