import { z } from "zod";
import type { Campaign, Communication, Encounter, Escalation, Observation, Patient, Task } from "../db/schema/index.js";
import { protocolCategoryEnum } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { AuditedEHR } from "../ehr/auditedEhr.js";
import { ehr } from "../ehr/index.js";
import {
  createEscalationSchema,
  createFollowUpTaskSchema,
  mockEncounterUpdateSchema,
  writeCommunicationSchema,
  writeObservationSchema,
  type CreateEscalationInput,
  type MockEncounterUpdateInput,
  type WriteCommunicationInput,
  type WriteObservationInput,
} from "../ehr/types.js";
import type { AuditActor } from "../lib/audit.js";
import { recordAudit } from "../lib/audit.js";
import { ForbiddenError } from "../lib/errors.js";
import { getCampaignById } from "../services/campaignService.js";
import { sendNotification, type SendNotificationInput } from "../services/notificationService.js";
import { retrieveRelevantProtocols, type ScoredProtocol } from "../services/protocolRetrievalService.js";

/**
 * The "controlled AI tool" boundary PRD §18 describes: "AI request ->
 * authorization -> schema validation -> business rules -> execution ->
 * audit -> result", for each of the PRD's named operations, as one
 * explicit, individually-exported function per operation.
 *
 * Honesty about what this is (and isn't) — see docs/ai-usage.md's
 * "Controlled tools" section for the full explanation, in short: this is
 * NOT LLM function-calling. The model in `ai/pipeline.ts` still doesn't
 * dynamically choose which of these to invoke — `pipeline.ts` (standing in
 * for that decision) calls them directly, in a fixed order, exactly as it
 * called the underlying services/EHR methods before this file existed. What
 * changes is that pipeline.ts is no longer ALLOWED to reach a service/EHR
 * method directly for any operation this file names — every one of those
 * calls must go through the matching function here, so the six-step shape
 * PRD §18 describes is a real, enforced code path for every actual
 * side-effecting (or PHI-reading) operation the AI layer's output leads to,
 * not just a description in a doc.
 *
 * Every function below follows the same six steps, in this order:
 *   1. authorization  — `authorizeAiTool`: only an `ai_agent` actor may call
 *      a controlled tool (a real, if minimal, gate — a `user`/`system`
 *      actor accidentally routed through here is rejected, not silently
 *      allowed).
 *   2. schema validation — the tool's Zod input schema (reusing
 *      `ehr/types.ts`'s existing write schemas where one already exists,
 *      rather than redefining them).
 *   3. business rules — enforced by the underlying service/EHR call itself
 *      (e.g. `HospitalScope`'s RLS tenant isolation, `getCampaignById`'s
 *      not-found check, `createEscalationSchema`'s priority clamp). Nothing
 *      here reimplements that logic — the comment on each tool says which
 *      rule the call below it enforces.
 *   4. execution — the existing service/EHR call, unchanged.
 *   5. audit — one `ai_tool.<name>` audit row per call, via `recordAudit`.
 *      This is deliberately separate from `AuditedEHR`'s own per-PHI-read
 *      audit rows (still written for the EHR reads this file wraps): that
 *      one records "PHI was read"; this one records "the AI layer requested
 *      this specific controlled operation", which matters even for
 *      non-PHI tools like protocol search.
 *   6. typed result — every function returns the same typed value its
 *      wrapped service call already returned; nothing here reshapes it.
 */

export class ToolAuthorizationError extends ForbiddenError {}

function authorizeAiTool(actor: AuditActor, toolName: string): void {
  // Step 1: authorization. Deliberately minimal — a real deployment might
  // check the actor id against an allowlist of registered agent instances,
  // but the property that actually matters for PRD §18 is that SOME
  // authorization check runs before every tool executes, not none. A
  // non-`ai_agent` actor reaching this file at all would itself be a bug
  // (only the AI pipeline calls these), so this also doubles as a guard
  // against that.
  if (actor.type !== "ai_agent") {
    throw new ToolAuthorizationError(
      `Actor ${actor.type}:${actor.id} is not authorized to invoke AI tool "${toolName}" (ai_agent actors only)`,
    );
  }
}

async function auditToolCall(
  scope: HospitalScope,
  actor: AuditActor,
  toolName: string,
  resourceType: string,
  resourceId: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // Step 5: audit — see the module comment for why this is separate from
  // AuditedEHR's PHI-read auditing.
  await recordAudit(scope, {
    actor,
    action: `ai_tool.${toolName}`,
    resourceType,
    resourceId,
    reason: `AI tool invocation: ${toolName}`,
    metadata,
  });
}

function auditedEhrFor(actor: AuditActor, toolName: string): AuditedEHR {
  return new AuditedEHR(ehr, actor, `ai tool: ${toolName}`);
}

// ---------------------------------------------------------------------------
// 1. Patient lookup
// ---------------------------------------------------------------------------

const lookupPatientInputSchema = z.object({ patientId: z.string().min(1) });
export type LookupPatientInput = z.infer<typeof lookupPatientInputSchema>;

export async function lookupPatient(scope: HospitalScope, actor: AuditActor, input: LookupPatientInput): Promise<Patient> {
  authorizeAiTool(actor, "lookupPatient");
  const { patientId } = lookupPatientInputSchema.parse(input);
  // Business rule: `HospitalScope`'s RLS confines the read to the caller's
  // own hospital; `MockEHR.getPatient` throws `NotFoundError` if no such
  // patient exists in that scope.
  const patient = await auditedEhrFor(actor, "lookupPatient").getPatient(scope, patientId);
  // AuditedEHR already wrote its own `patient.read` row; this adds the
  // "an AI tool call happened" row on top of it.
  await auditToolCall(scope, actor, "lookupPatient", "patient", patientId);
  return patient;
}

// ---------------------------------------------------------------------------
// 2. Encounter lookup
// ---------------------------------------------------------------------------

const lookupEncounterInputSchema = z.object({ encounterId: z.string().min(1) });
export type LookupEncounterInput = z.infer<typeof lookupEncounterInputSchema>;

export async function lookupEncounter(
  scope: HospitalScope,
  actor: AuditActor,
  input: LookupEncounterInput,
): Promise<Encounter> {
  authorizeAiTool(actor, "lookupEncounter");
  const { encounterId } = lookupEncounterInputSchema.parse(input);
  // Business rule: same RLS scoping + not-found check as lookupPatient.
  const encounter = await auditedEhrFor(actor, "lookupEncounter").getEncounter(scope, encounterId);
  await auditToolCall(scope, actor, "lookupEncounter", "encounter", encounterId);
  return encounter;
}

// ---------------------------------------------------------------------------
// 3. Protocol search
// ---------------------------------------------------------------------------

const lookupProtocolsInputSchema = z.object({
  category: z.enum(protocolCategoryEnum.enumValues).optional(),
  tags: z.array(z.string()).optional(),
  keywords: z.string().optional(),
  limit: z.number().int().positive().max(20).optional(),
});
export type LookupProtocolsInput = z.infer<typeof lookupProtocolsInputSchema>;

export async function lookupProtocols(
  scope: HospitalScope,
  actor: AuditActor,
  input: LookupProtocolsInput,
): Promise<ScoredProtocol[]> {
  authorizeAiTool(actor, "lookupProtocols");
  const { category, tags, keywords, limit } = lookupProtocolsInputSchema.parse(input);
  // Business rule: `retrieveRelevantProtocols` only ever queries the
  // caller's own hospital and only active protocols, and a query that
  // matches nothing scores 0 and is dropped rather than returning the
  // hospital's entire library (protocolRetrievalService.ts).
  const results = await retrieveRelevantProtocols(scope, { category, tags, keywords }, limit);
  await auditToolCall(scope, actor, "lookupProtocols", "protocol_search", category ?? "multi_category", {
    tags,
    keywords,
    resultCount: results.length,
  });
  return results;
}

// ---------------------------------------------------------------------------
// 4. Observation lookup
// ---------------------------------------------------------------------------

const lookupObservationsInputSchema = z.object({ patientId: z.string().min(1) });
export type LookupObservationsInput = z.infer<typeof lookupObservationsInputSchema>;

export async function lookupObservations(
  scope: HospitalScope,
  actor: AuditActor,
  input: LookupObservationsInput,
): Promise<Observation[]> {
  authorizeAiTool(actor, "lookupObservations");
  const { patientId } = lookupObservationsInputSchema.parse(input);
  // Business rule: RLS scoping, same as every other EHR read.
  const observations = await auditedEhrFor(actor, "lookupObservations").getObservations(scope, patientId);
  await auditToolCall(scope, actor, "lookupObservations", "observations", patientId, { count: observations.length });
  return observations;
}

// ---------------------------------------------------------------------------
// 5. Campaign status lookup
// ---------------------------------------------------------------------------

const lookupCampaignStatusInputSchema = z.object({ campaignId: z.string().min(1) });
export type LookupCampaignStatusInput = z.infer<typeof lookupCampaignStatusInputSchema>;

export async function lookupCampaignStatus(
  scope: HospitalScope,
  actor: AuditActor,
  input: LookupCampaignStatusInput,
): Promise<Campaign> {
  authorizeAiTool(actor, "lookupCampaignStatus");
  const { campaignId } = lookupCampaignStatusInputSchema.parse(input);
  // Business rule: `getCampaignById` throws `NotFoundError` scoped to the
  // caller's own hospital (campaignService.ts) — not reimplemented here.
  const campaign = await getCampaignById(scope, campaignId);
  await auditToolCall(scope, actor, "lookupCampaignStatus", "campaign", campaignId, { status: campaign.status });
  return campaign;
}

// ---------------------------------------------------------------------------
// 6. Callback scheduling
// ---------------------------------------------------------------------------

const scheduleCallbackInputSchema = z.object({
  patientId: z.string().min(1),
  encounterId: z.string().min(1).optional(),
  dueAt: z.coerce.date().optional(),
  notes: z.string().optional(),
});
export type ScheduleCallbackInput = z.infer<typeof scheduleCallbackInputSchema>;

export async function scheduleCallback(
  scope: HospitalScope,
  actor: AuditActor,
  input: ScheduleCallbackInput,
): Promise<Task> {
  authorizeAiTool(actor, "scheduleCallback");
  const parsed = scheduleCallbackInputSchema.parse(input);
  // Step 2 (continued): reuse `createFollowUpTaskSchema` itself, fixing
  // `type: "callback"` — this tool is a narrower, fixed-purpose view onto
  // the same validated write `ehr.createFollowUpTask` already accepts,
  // rather than a second, parallel schema to keep in sync.
  const validated = createFollowUpTaskSchema.parse({ ...parsed, type: "callback" as const });
  const task = await ehr.createFollowUpTask(scope, validated);
  await auditToolCall(scope, actor, "scheduleCallback", "task", task.id, { patientId: parsed.patientId });
  return task;
}

// ---------------------------------------------------------------------------
// 7. Call outcome recording (structured observations captured during a call)
// ---------------------------------------------------------------------------

export async function recordCallOutcome(
  scope: HospitalScope,
  actor: AuditActor,
  input: WriteObservationInput,
): Promise<Observation> {
  authorizeAiTool(actor, "recordCallOutcome");
  const validated = writeObservationSchema.parse(input);
  // Business rule: `source` defaults to "manual" unless given — pipeline.ts
  // always passes "ai_conversation" explicitly for symptoms captured on a
  // call, per `writeObservationSchema` (ehr/types.ts).
  const observation = await ehr.writeObservation(scope, validated);
  await auditToolCall(scope, actor, "recordCallOutcome", "observation", observation.id, {
    patientId: validated.patientId,
    category: validated.category,
  });
  return observation;
}

// ---------------------------------------------------------------------------
// 8. Escalation creation
// ---------------------------------------------------------------------------

export async function createEscalation(
  scope: HospitalScope,
  actor: AuditActor,
  input: CreateEscalationInput,
): Promise<Escalation> {
  authorizeAiTool(actor, "createEscalation");
  const validated = createEscalationSchema.parse(input);
  // Business rule: `priority` is clamped to 1-5 by `createEscalationSchema`
  // itself; `ehr.createEscalationRecord` enforces RLS scoping.
  const escalation = await ehr.createEscalationRecord(scope, validated);
  await auditToolCall(scope, actor, "createEscalation", "escalation", escalation.id, {
    trigger: escalation.trigger,
    priority: escalation.priority,
  });
  return escalation;
}

// ---------------------------------------------------------------------------
// 9. Notification requests
// ---------------------------------------------------------------------------

const requestNotificationInputSchema = z.object({
  recipientUserId: z.string().min(1).optional(),
  channel: z.enum(["dashboard", "email", "sms"]).optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
  relatedResourceType: z.string().min(1),
  relatedResourceId: z.string().min(1),
});
export type RequestNotificationInput = z.infer<typeof requestNotificationInputSchema>;

export async function requestNotification(
  scope: HospitalScope,
  actor: AuditActor,
  input: RequestNotificationInput,
) {
  authorizeAiTool(actor, "requestNotification");
  const validated: SendNotificationInput = requestNotificationInputSchema.parse(input);
  // Business rule: `sendNotification` (notificationService.ts) is
  // simulated/logged, never a real send — see docs/implementation-plan.md
  // Decision #6; not reimplemented here, just called.
  const notification = await sendNotification(scope, validated);
  await auditToolCall(scope, actor, "requestNotification", "notification", notification.id, {
    relatedResourceType: validated.relatedResourceType,
    relatedResourceId: validated.relatedResourceId,
  });
  return notification;
}

// ---------------------------------------------------------------------------
// 10. Communication recording
// ---------------------------------------------------------------------------

export async function recordCommunication(
  scope: HospitalScope,
  actor: AuditActor,
  input: WriteCommunicationInput,
): Promise<Communication> {
  authorizeAiTool(actor, "recordCommunication");
  const validated = writeCommunicationSchema.parse(input);
  const communication = await ehr.writeCommunication(scope, validated);
  await auditToolCall(scope, actor, "recordCommunication", "communication", communication.id, {
    patientId: validated.patientId,
    channel: validated.channel,
  });
  return communication;
}

// ---------------------------------------------------------------------------
// 11. Mock EHR updates
// ---------------------------------------------------------------------------

const updateMockEhrInputSchema = z.object({
  encounterId: z.string().min(1),
  update: mockEncounterUpdateSchema,
});
export type UpdateMockEhrInput = z.infer<typeof updateMockEhrInputSchema>;

export async function updateMockEhr(
  scope: HospitalScope,
  actor: AuditActor,
  input: UpdateMockEhrInput,
): Promise<Encounter> {
  authorizeAiTool(actor, "updateMockEhr");
  const { encounterId, update } = updateMockEhrInputSchema.parse(input);
  // Business rule: `mockEncounterUpdateSchema` bounds `riskLevel` (1-5) and
  // `status`; `ehr.updateEncounterMock` enforces RLS scoping and throws
  // `NotFoundError` if the encounter doesn't exist in this hospital.
  const encounter = await ehr.updateEncounterMock(scope, encounterId, update);
  await auditToolCall(scope, actor, "updateMockEhr", "encounter", encounterId, { fields: Object.keys(update) });
  return encounter;
}
