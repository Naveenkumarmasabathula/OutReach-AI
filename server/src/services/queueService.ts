import { and, count, eq, inArray, lte, lt, sql } from "drizzle-orm";
import { campaigns, encounters, outreachAttempts, outreachTasks } from "../db/schema/index.js";
import type { Campaign, OutreachTask } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";
import { recordAudit } from "../lib/audit.js";
import { AIOutputValidationError } from "../ai/types.js";
import { runOutreachAiPipeline, type EscalationDetails } from "../ai/pipeline.js";
import { ehr } from "../ehr/index.js";
import { publishEvent } from "../events/publish.js";
import type { AppEventType } from "../events/types.js";
import { assertDefined } from "../lib/assert.js";
import { nextValidCallingTime } from "../lib/callingHours.js";
import { NotFoundError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { simulateCallOutcome, simulateCallbackTime, type SimulatedOutcome } from "./callSimulator.js";
import { getCampaignById } from "./campaignService.js";
import { evaluateEligiblePatients } from "./eligibilityService.js";
import { getHospitalByScope } from "./hospitalService.js";
import { backoffMinutesForAttempt, computeTaskPriority } from "./priorityService.js";

// Shared with worker.ts's stale-lock sweep (releaseStaleLocks's own caller
// there) so "how stale counts as stuck" is defined once, not duplicated —
// getQueueHealth's `stuckTasksCount` below uses the same number.
export const STALE_LOCK_THRESHOLD_MINUTES = 5;

export const CLAIMABLE_STATUSES: OutreachTask["status"][] = [
  "pending",
  "scheduled",
  "retry_scheduled",
  "callback_scheduled",
];

function hoursBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60);
}

/**
 * Populates the queue for a campaign from the eligibility engine. Safe to
 * call more than once (on resume, or a re-run): a patient/encounter that
 * already has a task for this campaign is skipped, not duplicated — this is
 * the idempotency PRD §11 requires ("prevent duplicate calls").
 */
export async function enqueueEligiblePatients(
  scope: HospitalScope,
  campaign: Campaign,
): Promise<{ enqueued: number; alreadyQueued: number }> {
  const hospital = await getHospitalByScope(scope);
  const eligible = await evaluateEligiblePatients(scope, campaign);
  const maxAttempts = (campaign.retryLimit ?? hospital.maxRetries) + 1;
  const now = new Date();
  const callingHoursStart = campaign.callingHoursStart ?? hospital.callingHoursStart;
  const callingHoursEnd = campaign.callingHoursEnd ?? hospital.callingHoursEnd;

  return withHospitalScope(scope, async (tx) => {
    const existing = await tx
      .select({ patientId: outreachTasks.patientId, encounterId: outreachTasks.encounterId })
      .from(outreachTasks)
      .where(and(eq(outreachTasks.hospitalId, scope.hospitalId), eq(outreachTasks.campaignId, campaign.id)));
    const existingKeys = new Set(existing.map((row) => `${row.patientId}:${row.encounterId}`));

    const toInsert = eligible
      .filter((candidate) => !existingKeys.has(`${candidate.patientId}:${candidate.encounterId}`))
      .map((candidate) => ({
        hospitalId: scope.hospitalId,
        campaignId: campaign.id,
        patientId: candidate.patientId,
        encounterId: candidate.encounterId,
        maxAttempts,
        scheduledFor: nextValidCallingTime(now, hospital.timezone, callingHoursStart, callingHoursEnd),
        clinicalDeadline: new Date(
          candidate.dischargeDate.getTime() + candidate.followUpWindowHours * 60 * 60 * 1000,
        ),
      }));

    let inserted: OutreachTask[] = [];
    if (toInsert.length > 0) {
      // The `existingKeys` check above only prevents duplicates WITHIN this
      // one transaction's own read — it does not stop a second, concurrent
      // `enqueueEligiblePatients` call (e.g. a resume racing a scheduler
      // tick) from reading the same "not yet queued" state and also trying
      // to insert a task for the same patient/campaign/encounter. The
      // `outreach_tasks_active_unique_idx` partial unique index (migration
      // 0020, scoped to non-terminal statuses — see docs/queue-design.md's
      // "Duplicate-enqueue safety" section) is the real backstop for that
      // race. `onConflictDoNothing()` is what makes hitting it graceful: a
      // plain multi-row INSERT aborts its ENTIRE statement on the first
      // constraint violation, which would crash this whole batch over a
      // single racing row; `ON CONFLICT DO NOTHING` instead lets Postgres
      // skip just the conflicting row(s) and still insert every other
      // legitimately-new task in the same statement.
      inserted = await tx.insert(outreachTasks).values(toInsert).onConflictDoNothing().returning();
      if (inserted.length < toInsert.length) {
        logger.warn(
          {
            hospitalId: scope.hospitalId,
            campaignId: campaign.id,
            attempted: toInsert.length,
            inserted: inserted.length,
          },
          "enqueueEligiblePatients: skipped one or more rows that lost a concurrent-enqueue race (unique constraint), rather than failing the batch",
        );
      }
    }

    return { enqueued: inserted.length, alreadyQueued: existingKeys.size };
  });
}

type ScoredCandidate = {
  task: OutreachTask;
  score: number;
  campaignCap: number | null;
};

/**
 * The capacity-safe claim operation — the core of PRD §8/§10's concurrency
 * requirement. Safety comes from two layers, not one:
 *
 *   1. A live count of currently-"calling" tasks per hospital (and per
 *      campaign, if it has its own cap) bounds how many NEW claims this call
 *      will attempt.
 *   2. Each claim is a conditional UPDATE (`WHERE id = X AND status = <the
 *      status just read>`), not a blind write. If another concurrent call to
 *      this same function (a second worker process, or a second scheduler
 *      tick) already claimed that row, this UPDATE matches zero rows and the
 *      loop moves on — Postgres's row-level locking on UPDATE makes this
 *      atomic per row without needing an explicit application-level lock.
 *
 * This is what a concurrency test can actually assert on: fire this
 * function many times concurrently against a small capacity and verify the
 * total claimed never exceeds it and no task is claimed twice — see
 * test/queue/concurrency.test.ts.
 */
export async function claimNextTasks(scope: HospitalScope, workerId: string): Promise<OutreachTask[]> {
  const hospital = await getHospitalByScope(scope);

  return withHospitalScope(scope, async (tx) => {
    const now = new Date();

    // Closes a real race: without this, the `activeCount` SELECT just below
    // is a plain read under READ COMMITTED, with no lock on the aggregate.
    // Two concurrent claimNextTasks calls for the SAME hospital can each
    // read "0 active" before either has committed a claim, each conclude
    // there's room for the full capacity, and each then independently claim
    // up to that many DIFFERENT rows via the (correctly atomic, but only
    // per-row) conditional UPDATE below — exceeding the hospital's real
    // capacity in total even though no single row was ever double-claimed.
    // Found via the full test suite (not the isolated file) failing
    // intermittently under real concurrent load — the race window is too
    // narrow to reliably trigger in a fast, unloaded single-file run, which
    // is exactly why running only the file that "obviously" tests this
    // wasn't enough to catch it. A Postgres advisory transaction lock keyed
    // on the hospital id serializes concurrent claims for the SAME hospital
    // (a different hospital's claims are untouched — the hash key is
    // hospital-specific) without needing a new table or changing the
    // capacity math itself; it's released automatically at commit/rollback.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${scope.hospitalId}))`);

    const [activeRow] = await tx
      .select({ activeCount: count() })
      .from(outreachTasks)
      .where(and(eq(outreachTasks.hospitalId, scope.hospitalId), eq(outreachTasks.status, "calling")));
    const hospitalActive = activeRow?.activeCount ?? 0;
    const hospitalAvailable = hospital.outboundCapacity - hospitalActive;
    if (hospitalAvailable <= 0) return [];

    const activeByCampaignRows = await tx
      .select({ campaignId: outreachTasks.campaignId, activeCount: count() })
      .from(outreachTasks)
      .where(and(eq(outreachTasks.hospitalId, scope.hospitalId), eq(outreachTasks.status, "calling")))
      .groupBy(outreachTasks.campaignId);
    const activeByCampaign = new Map(activeByCampaignRows.map((row) => [row.campaignId, row.activeCount]));

    const candidates = await tx
      .select({
        task: outreachTasks,
        campaignPriority: campaigns.priority,
        campaignOutboundCapacity: campaigns.outboundCapacity,
        encounterRiskLevel: encounters.riskLevel,
        encounterFollowUpWindowHours: encounters.followUpWindowHours,
        dischargeDate: encounters.dischargeDate,
      })
      .from(outreachTasks)
      .innerJoin(campaigns, eq(campaigns.id, outreachTasks.campaignId))
      .innerJoin(encounters, eq(encounters.id, outreachTasks.encounterId))
      .where(
        and(
          eq(outreachTasks.hospitalId, scope.hospitalId),
          inArray(outreachTasks.status, CLAIMABLE_STATUSES),
          lte(outreachTasks.scheduledFor, now),
          eq(campaigns.status, "running"),
        ),
      );

    const scored: ScoredCandidate[] = candidates.map((candidate) => {
      const hoursSinceDischarge = candidate.dischargeDate ? hoursBetween(now, candidate.dischargeDate) : 0;
      const hoursWaiting = Math.max(0, hoursBetween(now, candidate.task.scheduledFor));
      const { score } = computeTaskPriority({
        followUpWindowHours: candidate.encounterFollowUpWindowHours,
        hoursSinceDischarge,
        riskLevel: candidate.encounterRiskLevel,
        campaignPriority: candidate.campaignPriority,
        hoursWaiting,
        attemptCount: candidate.task.attemptCount,
        maxAttempts: candidate.task.maxAttempts,
      });
      return { task: candidate.task, score, campaignCap: candidate.campaignOutboundCapacity };
    });

    scored.sort((a, b) => b.score - a.score);

    const claimed: OutreachTask[] = [];
    const claimedPerCampaign = new Map<string, number>();

    for (const candidate of scored) {
      if (claimed.length >= hospitalAvailable) break;

      const campaignCap = candidate.campaignCap;
      if (campaignCap != null) {
        const currentActive = activeByCampaign.get(candidate.task.campaignId) ?? 0;
        const claimedSoFar = claimedPerCampaign.get(candidate.task.campaignId) ?? 0;
        if (currentActive + claimedSoFar >= campaignCap) continue;
      }

      const [updated] = await tx
        .update(outreachTasks)
        .set({
          status: "calling",
          lockedBy: workerId,
          lockedAt: now,
          attemptCount: candidate.task.attemptCount + 1,
          updatedAt: now,
        })
        .where(and(eq(outreachTasks.id, candidate.task.id), eq(outreachTasks.status, candidate.task.status)))
        .returning();

      if (updated) {
        claimed.push(updated);
        claimedPerCampaign.set(candidate.task.campaignId, (claimedPerCampaign.get(candidate.task.campaignId) ?? 0) + 1);
      }
      // else: another concurrent claim beat us to this row — skip, don't retry it here.
    }

    return claimed;
  });
}

/**
 * Runs one attempt for a task already claimed (status='calling') and
 * transitions it based on the outcome. `simulateCallOutcome` decides
 * *connectivity* only (did the call go through at all — a telephony
 * concern, still a deterministic placeholder pending real Twilio/voice-AI
 * integration). For the two outcomes that mean "a conversation actually
 * happened" ("completed"/"escalated" in its bucket), Phase 5's AI pipeline
 * now decides which of those two it *actually* is, replacing what used to
 * be the hash's own arbitrary pick — see runOutreachAiPipeline's own
 * comment for why that decision, not connectivity, is the seam it replaces.
 * Every other bucket (no_answer/busy/voicemail/...) never reaches the
 * pipeline, matching real life: no conversation, nothing to triage.
 */
export async function processTask(scope: HospitalScope, taskId: string): Promise<OutreachTask> {
  const hospital = await getHospitalByScope(scope);
  const startedAt = new Date();

  const task = await withHospitalScope(scope, async (tx) => {
    const [row] = await tx
      .select()
      .from(outreachTasks)
      .where(and(eq(outreachTasks.id, taskId), eq(outreachTasks.hospitalId, scope.hospitalId)));
    return row;
  });
  if (!task) throw new NotFoundError("Outreach task not found");
  if (task.status !== "calling") {
    logger.warn({ taskId, status: task.status }, "processTask called on a task not in 'calling' status; skipping");
    return task;
  }

  const connectivityOutcome = simulateCallOutcome(task.id, task.attemptCount);

  if (connectivityOutcome !== "completed" && connectivityOutcome !== "escalated") {
    const endedAt = new Date();
    return recordAttemptOutcome(scope, task, connectivityOutcome, startedAt, endedAt, hospital);
  }

  try {
    const result = await runOutreachAiPipeline(scope, task);
    const endedAt = new Date();
    return recordAttemptOutcome(scope, task, result.clinicalOutcome, startedAt, endedAt, hospital, {
      transcript: result.transcript,
      triageResult: result.triageAssessments,
      consensusResult: result.consensus,
      documentationStatus: "generated",
      escalationDetails: result.escalationDetails ?? undefined,
      conversationContextUpdate: result.conversationContextUpdate,
    });
  } catch (err) {
    // PRD §13: "repeated failure must become an explicit operational
    // failure rather than being silently accepted." An AI pipeline failure
    // (e.g. `AIOutputValidationError` after Gemini's one repair attempt
    // fails too) becomes a technical_failure attempt — the same retry/
    // manual-follow-up handling as any other connectivity failure — rather
    // than crashing the worker or silently marking the call "completed".
    logger.error({ err, taskId, aiFailure: err instanceof AIOutputValidationError }, "Outreach AI pipeline failed");
    const endedAt = new Date();
    return recordAttemptOutcome(scope, task, "technical_failure", startedAt, endedAt, hospital);
  }
}

/**
 * Exported (not just used internally by `processTask`) so a specific
 * outcome can be driven directly — both for tests that need deterministic
 * control over which transition happens (rather than working around the
 * outcome simulator's hash), and as the natural extension point for a
 * future manual "record outcome" action if one is ever needed outside the
 * simulator/real-agent path.
 */
export type AiAttemptContext = {
  transcript: unknown;
  triageResult: unknown;
  consensusResult: unknown;
  documentationStatus: string;
  escalationDetails?: EscalationDetails;
  conversationContextUpdate: Record<string, unknown>;
};

export async function recordAttemptOutcome(
  scope: HospitalScope,
  task: OutreachTask,
  outcome: SimulatedOutcome | "technical_failure",
  startedAt: Date,
  endedAt: Date,
  hospital: Awaited<ReturnType<typeof getHospitalByScope>>,
  aiContext?: AiAttemptContext,
): Promise<OutreachTask> {
  // Retry/callback scheduling respects the campaign's own calling-hours
  // narrowing if it set one, same as initial enqueue in
  // enqueueEligiblePatients — falls back to the hospital's otherwise.
  const campaign = await getCampaignById(scope, task.campaignId);
  const callingHoursStart = campaign.callingHoursStart ?? hospital.callingHoursStart;
  const callingHoursEnd = campaign.callingHoursEnd ?? hospital.callingHoursEnd;

  let nextStatus: OutreachTask["status"];
  let scheduledFor = task.scheduledFor;
  let callbackRequestedFor = task.callbackRequestedFor;

  switch (outcome) {
    case "completed":
      nextStatus = "completed";
      break;
    case "escalated":
      nextStatus = "escalated";
      break;
    case "declined":
    case "invalid_number":
      nextStatus = "failed";
      break;
    case "callback_requested": {
      const requested = simulateCallbackTime(task, endedAt);
      callbackRequestedFor = requested;
      scheduledFor = nextValidCallingTime(requested, hospital.timezone, callingHoursStart, callingHoursEnd);
      nextStatus = "callback_scheduled";
      break;
    }
    default: {
      // no_answer | busy | voicemail | dropped | technical_failure
      if (task.attemptCount >= task.maxAttempts) {
        nextStatus = "manual_follow_up";
      } else {
        const backoffMinutes = backoffMinutesForAttempt(task.attemptCount);
        const backoffTime = new Date(endedAt.getTime() + backoffMinutes * 60 * 1000);
        scheduledFor = nextValidCallingTime(backoffTime, hospital.timezone, callingHoursStart, callingHoursEnd);
        nextStatus = "retry_scheduled";
      }
    }
  }

  // What to persist into `conversationContext` for the NEXT attempt to read
  // back (`ai/pipeline.ts`'s `runOutreachAiPipeline` reads `task.
  // conversationContext` unconditionally at the top of every run, regardless
  // of which caller invoked it — so anything written here is automatically
  // picked up next time, with no pipeline change needed). completed/escalated
  // get a real update from the AI pipeline (`aiContext.
  // conversationContextUpdate`, e.g. `lastCallSummary`). A "dropped" outcome
  // never reaches the pipeline at all under the current connectivity-only
  // call simulator (see `processTask`'s own comment on that split) — there is
  // no real transcript-so-far this placeholder telephony layer ever
  // produces, so nothing genuine to save there. What IS real and worth
  // carrying forward is the fact of the drop itself: merged onto whatever
  // context already exists (e.g. a real `lastCallSummary` from an earlier
  // successful attempt in this task's history) rather than overwriting it,
  // so a genuine prior summary survives a later dropped attempt instead of
  // silently vanishing.
  let conversationContextUpdate = aiContext?.conversationContextUpdate;
  if (!conversationContextUpdate && outcome === "dropped") {
    conversationContextUpdate = {
      ...((task.conversationContext as Record<string, unknown> | null) ?? {}),
      lastCallDropped: true,
      lastCallDroppedAt: endedAt.toISOString(),
      lastCallDroppedAttemptNumber: task.attemptCount,
    };
  }

  const updated = await withHospitalScope(scope, async (tx) => {
    await tx.insert(outreachAttempts).values({
      hospitalId: scope.hospitalId,
      outreachTaskId: task.id,
      attemptNumber: task.attemptCount,
      outcome,
      startedAt,
      endedAt,
      transcript: aiContext?.transcript,
      triageResult: aiContext?.triageResult,
      consensusResult: aiContext?.consensusResult,
      documentationStatus: aiContext?.documentationStatus,
    });

    const [row] = await tx
      .update(outreachTasks)
      .set({
        status: nextStatus,
        scheduledFor,
        callbackRequestedFor,
        lockedBy: null,
        lockedAt: null,
        updatedAt: new Date(),
        ...(conversationContextUpdate ? { conversationContext: conversationContextUpdate } : {}),
      })
      .where(eq(outreachTasks.id, task.id))
      .returning();
    return assertDefined(row, "outreach task update returned no row");
  });

  // PRD §18's "important events" list ("call scheduling/start/completion/
  // failure, retry scheduling, callback requests"). Published after the
  // state transition and side effects below commit, not before — an event
  // describes something that already happened, never something about to.
  const TASK_STATUS_EVENT: Partial<Record<OutreachTask["status"], AppEventType>> = {
    completed: "task.completed",
    escalated: "task.escalated",
    failed: "task.failed",
    callback_scheduled: "callback.requested",
    retry_scheduled: "retry.scheduled",
    manual_follow_up: "task.manual_follow_up",
  };

  if (nextStatus === "escalated") {
    // Real clinical details from the Phase 5 AI pipeline when available
    // (the normal case for a live-connected call); a generic placeholder
    // otherwise (only reachable via a test or tool directly forcing an
    // "escalated" outcome without running the pipeline).
    const escalation = await ehr.createEscalationRecord(scope, {
      patientId: task.patientId,
      encounterId: task.encounterId,
      campaignId: task.campaignId,
      outreachTaskId: task.id,
      trigger: aiContext?.escalationDetails?.trigger ?? "queue_forced_escalation",
      clinicalIndicators: aiContext?.escalationDetails?.clinicalIndicators,
      triageResult: aiContext?.escalationDetails?.triageResult,
      consensusResult: aiContext?.escalationDetails?.consensusResult,
      priority: aiContext?.escalationDetails?.priority ?? 2,
      notes:
        aiContext?.escalationDetails?.notes ??
        "Escalated outcome recorded without an AI pipeline run (e.g. a test or manual override) — no triage/consensus detail available.",
    });
    // Drives the Phase 7 workflow: notify reviewers now, schedule the
    // backup-reviewer timeout — see src/events/handlers.ts.
    await publishEvent(scope, "escalation.created", {
      escalationId: escalation.id,
      priority: escalation.priority,
      trigger: escalation.trigger,
    });
    // PRD §21 names "AI escalation assessments, consensus decisions" as
    // their own audit category, distinct from the escalation row itself
    // (which records the resulting state, not "an AI produced this
    // assessment, here's why"). The reason field carries the consensus
    // rationale so this audit row is self-contained, not just a pointer.
    await recordAudit(scope, {
      actor: { type: "ai_agent", id: "outreach-ai-pipeline" },
      action: "escalation.ai_consensus_decision",
      resourceType: "escalation",
      resourceId: escalation.id,
      reason: aiContext?.escalationDetails?.notes,
      metadata: { trigger: escalation.trigger, priority: escalation.priority },
    });
  }
  if (nextStatus === "manual_follow_up") {
    await ehr.createFollowUpTask(scope, {
      patientId: task.patientId,
      encounterId: task.encounterId,
      type: "manual_follow_up",
      notes: `Outreach exhausted ${task.maxAttempts} attempt(s) without success (last outcome: ${outcome}).`,
    });
  }

  const taskEvent = TASK_STATUS_EVENT[nextStatus];
  if (taskEvent) {
    await publishEvent(scope, taskEvent, { taskId: task.id, campaignId: task.campaignId, outcome });
  }

  return updated;
}

/**
 * Crash recovery (PRD §11: "stuck tasks should be recoverable through
 * heartbeat or timeout mechanisms; a failed worker should not permanently
 * consume outbound capacity"). Iterates hospitals globally rather than
 * taking a scope — this is a maintenance sweep, the same pattern
 * docs/multi-tenancy.md describes for cron-style jobs: no ambient tenant
 * context, each row's own hospital_id is re-scoped explicitly as it's
 * processed.
 */
export async function releaseStaleLocks(staleThresholdMinutes: number): Promise<number> {
  // `outreach_tasks` has RLS FORCED (docs/multi-tenancy.md §2) — querying it
  // via the unscoped `db` connection would silently return zero rows always,
  // since that connection never sets app.current_hospital_id and
  // `hospital_id = NULL` never matches. `hospitals` itself has no RLS (it's
  // the tenant root, not tenant-scoped data), so the correct pattern is:
  // enumerate hospitals unscoped, then run a properly *scoped* query per
  // hospital — never a global query against a forced-RLS table.
  const { db } = await import("../db/client.js");
  const { hospitals } = await import("../db/schema/index.js");
  const { mintHospitalScope } = await import("../db/scope.js");

  const cutoff = new Date(Date.now() - staleThresholdMinutes * 60 * 1000);
  const allHospitals = await db.select({ id: hospitals.id }).from(hospitals);

  let released = 0;
  for (const { id: hospitalId } of allHospitals) {
    const scope = mintHospitalScope(hospitalId);
    const staleTasks = await withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(outreachTasks)
        .where(and(eq(outreachTasks.status, "calling"), lt(outreachTasks.lockedAt, cutoff))),
    );
    if (staleTasks.length === 0) continue;

    const hospital = await getHospitalByScope(scope);
    for (const task of staleTasks) {
      await recordAttemptOutcome(scope, task, "technical_failure", task.lockedAt ?? cutoff, new Date(), hospital);
      released += 1;
      logger.warn({ taskId: task.id, hospitalId }, "Released stale outreach task lock (worker crash recovery)");
    }
  }
  return released;
}

export async function getQueueHealth(scope: HospitalScope) {
  return withHospitalScope(scope, async (tx) => {
    const rows = await tx
      .select({ status: outreachTasks.status, total: count() })
      .from(outreachTasks)
      .where(eq(outreachTasks.hospitalId, scope.hospitalId))
      .groupBy(outreachTasks.status);

    const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.total]));

    const [oldestPending] = await tx
      .select({ scheduledFor: outreachTasks.scheduledFor })
      .from(outreachTasks)
      .where(
        and(
          eq(outreachTasks.hospitalId, scope.hospitalId),
          inArray(outreachTasks.status, CLAIMABLE_STATUSES),
        ),
      )
      .orderBy(outreachTasks.scheduledFor)
      .limit(1);

    const now = new Date();
    const cutoffRisk = await tx
      .select({ total: count() })
      .from(outreachTasks)
      .where(
        and(
          eq(outreachTasks.hospitalId, scope.hospitalId),
          inArray(outreachTasks.status, CLAIMABLE_STATUSES),
          lt(outreachTasks.clinicalDeadline, new Date(now.getTime() + 4 * 60 * 60 * 1000)), // due within 4h
        ),
      );

    // PRD §21's queue-specific health fields include "stuck workers" —
    // tasks still marked 'calling' past the same staleness threshold
    // worker.ts's sweep uses to actually recover them. A nonzero count here
    // means either the sweep hasn't run yet (it's due every 60s) or isn't
    // running at all — worth surfacing on a dashboard either way.
    const stuckThreshold = new Date(now.getTime() - STALE_LOCK_THRESHOLD_MINUTES * 60 * 1000);
    const stuckRow = await tx
      .select({ total: count() })
      .from(outreachTasks)
      .where(
        and(
          eq(outreachTasks.hospitalId, scope.hospitalId),
          eq(outreachTasks.status, "calling"),
          lt(outreachTasks.lockedAt, stuckThreshold),
        ),
      );

    return {
      byStatus,
      oldestPendingScheduledFor: oldestPending?.scheduledFor ?? null,
      tasksNearCutoff: cutoffRisk[0]?.total ?? 0,
      stuckTasksCount: stuckRow[0]?.total ?? 0,
    };
  });
}
