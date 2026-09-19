import { and, desc, eq } from "drizzle-orm";
import { escalations, outreachAttempts, patients } from "../db/schema/index.js";
import type { Escalation } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";
import { publishEvent } from "../events/publish.js";
import { assertDefined } from "../lib/assert.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { toOffsetLimit, type Pagination } from "../lib/pagination.js";
import { sendNotification } from "./notificationService.js";

type EscalationStatus = Escalation["status"];

const NON_TERMINAL: EscalationStatus[] = ["open", "assigned", "in_review", "waiting_for_information"];

async function getRow(scope: HospitalScope, escalationId: string): Promise<Escalation> {
  const [row] = await withHospitalScope(scope, (tx) =>
    tx
      .select()
      .from(escalations)
      .where(and(eq(escalations.id, escalationId), eq(escalations.hospitalId, scope.hospitalId))),
  );
  if (!row) throw new NotFoundError("Escalation not found");
  return row;
}

async function transition(
  scope: HospitalScope,
  escalationId: string,
  allowedFrom: EscalationStatus[],
  updates: Partial<Pick<Escalation, "status" | "assignedReviewerId" | "resolution" | "resolvedAt" | "notes">>,
): Promise<Escalation> {
  return withHospitalScope(scope, async (tx) => {
    const [existing] = await tx
      .select()
      .from(escalations)
      .where(and(eq(escalations.id, escalationId), eq(escalations.hospitalId, scope.hospitalId)));
    if (!existing) throw new NotFoundError("Escalation not found");
    if (!allowedFrom.includes(existing.status)) {
      throw new ConflictError(`Cannot perform this action on an escalation with status '${existing.status}'`);
    }

    const [updated] = await tx
      .update(escalations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(escalations.id, escalationId))
      .returning();
    return assertDefined(updated, "escalation update returned no row");
  });
}

export async function listEscalations(
  scope: HospitalScope,
  pagination: Pagination,
  filters: { status?: EscalationStatus; priority?: number } = {},
) {
  const { offset, limit } = toOffsetLimit(pagination);
  const conditions = [eq(escalations.hospitalId, scope.hospitalId)];
  if (filters.status) conditions.push(eq(escalations.status, filters.status));
  if (filters.priority) conditions.push(eq(escalations.priority, filters.priority));

  return withHospitalScope(scope, (tx) =>
    tx
      .select()
      .from(escalations)
      .where(and(...conditions))
      .orderBy(desc(escalations.priority), desc(escalations.createdAt))
      .limit(limit)
      .offset(offset),
  );
}

export async function getEscalationById(scope: HospitalScope, escalationId: string): Promise<Escalation> {
  return getRow(scope, escalationId);
}

/**
 * PRD §19: "Authorized staff must be able to inspect patient context,
 * conversation, AI outputs, protocol evidence, and escalation rationale
 * before resolving the case." One call assembles everything a reviewer
 * needs rather than making the frontend stitch together several endpoints
 * (patient, transcript, triage) itself.
 */
export async function getEscalationDetail(scope: HospitalScope, escalationId: string) {
  const escalation = await getRow(scope, escalationId);

  return withHospitalScope(scope, async (tx) => {
    const [patient] = await tx.select().from(patients).where(eq(patients.id, escalation.patientId));

    const attempt = escalation.outreachTaskId
      ? (
          await tx
            .select()
            .from(outreachAttempts)
            .where(eq(outreachAttempts.outreachTaskId, escalation.outreachTaskId))
            .orderBy(desc(outreachAttempts.createdAt))
            .limit(1)
        )[0]
      : undefined;

    return {
      escalation,
      patient: patient ?? null,
      transcript: attempt?.transcript ?? null,
      triageResult: escalation.triageResult ?? attempt?.triageResult ?? null,
      consensusResult: escalation.consensusResult ?? attempt?.consensusResult ?? null,
    };
  });
}

/**
 * A reviewer claiming an unassigned escalation for themselves — PRD §19's
 * "acknowledge". `correlationId` (Fix #4, reliability audit) is optional —
 * when the route handler passes the originating HTTP request's id through,
 * it rides along on the `escalation.acknowledged` event's BullMQ job and
 * shows up on the worker's "Processing event job" log line, so this
 * specific action's whole HTTP-request -> async-event -> worker-log path is
 * genuinely traceable end to end, not just tagged with a fresh id at the
 * queue boundary.
 */
export async function acknowledgeEscalation(
  scope: HospitalScope,
  escalationId: string,
  reviewerId: string,
  correlationId?: string,
): Promise<Escalation> {
  const updated = await transition(scope, escalationId, ["open"], {
    status: "assigned",
    assignedReviewerId: reviewerId,
  });
  await sendNotification(scope, {
    recipientUserId: reviewerId,
    subject: `Escalation acknowledged (priority ${updated.priority})`,
    body: `You acknowledged escalation ${updated.id} (trigger: ${updated.trigger}).`,
    relatedResourceType: "escalation",
    relatedResourceId: updated.id,
    // Fix #2: `transition` above already guards this whole action against
    // being applied twice (it throws ConflictError once status is no longer
    // "open"), so this key is defense-in-depth for the notification
    // specifically — e.g. a retried route handler that reaches this line a
    // second time only because the first attempt's response was lost, not
    // because the transition itself re-ran.
    idempotencyKey: `escalation-acknowledged-${updated.id}`,
  });
  await publishEvent(scope, "escalation.acknowledged", { escalationId: updated.id, reviewerId }, correlationId);
  return updated;
}

/** An explicit assign/reassign action — e.g. a Hospital Admin routing work, not just self-claiming. */
export async function assignEscalation(
  scope: HospitalScope,
  escalationId: string,
  reviewerId: string,
): Promise<Escalation> {
  const updated = await transition(scope, escalationId, NON_TERMINAL, {
    status: "assigned",
    assignedReviewerId: reviewerId,
  });
  await sendNotification(scope, {
    recipientUserId: reviewerId,
    subject: `Escalation assigned to you (priority ${updated.priority})`,
    body: `Escalation ${updated.id} (trigger: ${updated.trigger}) has been assigned to you.`,
    relatedResourceType: "escalation",
    relatedResourceId: updated.id,
    // Keyed on (escalation, reviewer) rather than just the escalation — this
    // action IS legitimately repeatable (reassigning to a different
    // reviewer), so only a retry naming the SAME reviewer should dedup.
    idempotencyKey: `escalation-assigned-${updated.id}-${reviewerId}`,
  });
  return updated;
}

export async function startReview(scope: HospitalScope, escalationId: string): Promise<Escalation> {
  return transition(scope, escalationId, ["assigned"], { status: "in_review" });
}

export async function requestInformation(
  scope: HospitalScope,
  escalationId: string,
  notes: string,
): Promise<Escalation> {
  return transition(scope, escalationId, ["in_review"], { status: "waiting_for_information", notes });
}

export async function resumeReview(scope: HospitalScope, escalationId: string): Promise<Escalation> {
  return transition(scope, escalationId, ["waiting_for_information"], { status: "in_review" });
}

export async function resolveEscalation(
  scope: HospitalScope,
  escalationId: string,
  resolution: string,
  correlationId?: string,
): Promise<Escalation> {
  const updated = await transition(scope, escalationId, ["in_review", "assigned"], {
    status: "resolved",
    resolution,
    resolvedAt: new Date(),
  });
  await publishEvent(scope, "escalation.resolved", { escalationId: updated.id }, correlationId);
  return updated;
}

export async function closeEscalation(scope: HospitalScope, escalationId: string): Promise<Escalation> {
  return transition(scope, escalationId, ["resolved"], { status: "closed" });
}

/**
 * PRD §18's worked example: "an escalation... escalates to a backup
 * reviewer if not acknowledged within a configured period." Not a status
 * transition (it stays "open" — still needs a reviewer to actually
 * acknowledge it) — only its priority and an explanatory note change. Called
 * by the escalation-timeout job (server/src/events/escalationTimeout.ts),
 * which independently re-checks the escalation is still "open" before
 * calling this, so this function itself doesn't need its own guard against
 * being invoked on an already-handled escalation.
 */
export async function escalateToBackupReviewer(
  scope: HospitalScope,
  escalationId: string,
  newPriority: number,
): Promise<Escalation> {
  return withHospitalScope(scope, async (tx) => {
    const [existing] = await tx
      .select()
      .from(escalations)
      .where(and(eq(escalations.id, escalationId), eq(escalations.hospitalId, scope.hospitalId)));
    if (!existing) throw new NotFoundError("Escalation not found");

    const [updated] = await tx
      .update(escalations)
      .set({
        priority: newPriority,
        notes: [existing.notes, `Escalated to backup review after reviewer timeout (priority ${existing.priority} -> ${newPriority}).`]
          .filter(Boolean)
          .join(" "),
        updatedAt: new Date(),
      })
      .where(eq(escalations.id, escalationId))
      .returning();
    return assertDefined(updated, "escalation update returned no row");
  });
}
