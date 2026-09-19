import { and, eq, gte, inArray } from "drizzle-orm";
import { count } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  aiCallLog,
  campaigns,
  communications,
  escalations,
  hospitals,
  observations,
  outreachAttempts,
  outreachTasks,
  protocols,
  tasks,
  users,
} from "../db/schema/index.js";
import type { HospitalScope, ScopedDb } from "../db/scope.js";
import { mintHospitalScope, withHospitalScope } from "../db/scope.js";
import { evaluateEligiblePatients } from "./eligibilityService.js";
import { getHospitalByScope } from "./hospitalService.js";
import { CLAIMABLE_STATUSES } from "./queueService.js";

// PRD §22 ("Hospital Admin dashboard: ... EHR synchronization status").
// The EHR here is `MockEHR` (server/src/ehr/mockEhr.ts) — there is no real
// external system to "sync" with, so a literal sync-status field would be
// fabricated. What IS real and queryable is how much (and how recently) the
// app has written to the EHR-backed tables on a patient's behalf. 24h is an
// arbitrary but reasonable "is this hospital's outreach currently
// producing EHR activity" window — see getHospitalAnalytics's
// `ehrWriteActivity` and docs/dashboards-analytics.md for the honesty
// framing.
const EHR_WRITE_ACTIVITY_WINDOW_HOURS = 24;

function hoursBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Shared by `getAiUsageStats` (its own tenant-scoped transaction) and
 * `getHospitalAnalytics` (the transaction it already has open) so the
 * latter doesn't pay for a second pool connection per hospital just to
 * compute this — `getPlatformAggregateAnalytics` calls `getHospitalAnalytics`
 * once per hospital on the whole platform, so an extra `pool.connect()` in
 * there is an extra connection-acquisition round trip times every hospital,
 * not a rounding error.
 */
async function computeAiUsageStats(tx: ScopedDb, hospitalId: string) {
  const agentTypeRows = await tx
    .select({ agentType: aiCallLog.agentType, total: count() })
    .from(aiCallLog)
    .where(eq(aiCallLog.hospitalId, hospitalId))
    .groupBy(aiCallLog.agentType);

  const outcomeRows = await tx
    .select({ success: aiCallLog.success, total: count() })
    .from(aiCallLog)
    .where(eq(aiCallLog.hospitalId, hospitalId))
    .groupBy(aiCallLog.success);

  const latencyRows = await tx
    .select({ latencyMs: aiCallLog.latencyMs })
    .from(aiCallLog)
    .where(eq(aiCallLog.hospitalId, hospitalId));

  const totalCalls = agentTypeRows.reduce((sum, r) => sum + r.total, 0);
  const successCount = outcomeRows.find((r) => r.success === true)?.total ?? 0;
  const failureCount = outcomeRows.find((r) => r.success === false)?.total ?? 0;

  return {
    totalCalls,
    byAgentType: Object.fromEntries(agentTypeRows.map((r) => [r.agentType, r.total])),
    successCount,
    failureCount,
    successRate: totalCalls > 0 ? successCount / totalCalls : null,
    averageLatencyMs: average(latencyRows.map((r) => r.latencyMs)),
  };
}

/**
 * PRD §22's "AI usage" (Platform Admin dashboard, in aggregate — but scoped
 * per-hospital here, same "one hospital-scoped function, summed by the
 * platform aggregate" shape as everything else in this file). Reads the new
 * `ai_call_log` table (db/schema/aiCallLog.ts).
 *
 * Honesty note: nothing writes to `ai_call_log` yet. server/src/ai/
 * pipeline.ts still only `logger.info`s AI call outcomes (its "AI triage
 * pipeline run completed" log line) rather than calling
 * `aiCallLogService.recordAiCall` — wiring that in is a follow-up left to
 * whoever owns pipeline.ts next (it's being actively worked on
 * concurrently with this change), tracked in docs/dashboards-analytics.md.
 * Until then this function correctly, honestly returns all-zero/null stats
 * for every hospital — not a stub that fakes data, a real aggregation over
 * a real (currently empty) table.
 *
 * Takes a `HospitalScope`, not a bare hospital id, matching every other
 * service function in this codebase (db/scope.ts: a `HospitalScope` is
 * proof an access check ran). Exported as a standalone entry point (e.g.
 * for a future dedicated "AI usage" call); `getHospitalAnalytics` below
 * does NOT call this directly — see `computeAiUsageStats`'s own comment for
 * why — but produces an identical shape via the same shared query logic,
 * and `getPlatformAggregateAnalytics` sums that per hospital, exactly like
 * it already does for campaigns/escalations/etc.
 */
export async function getAiUsageStats(scope: HospitalScope) {
  return withHospitalScope(scope, (tx) => computeAiUsageStats(tx, scope.hospitalId));
}

export type AiUsageStats = Awaited<ReturnType<typeof getAiUsageStats>>;

/**
 * PRD §20's "Analytics cover eligible patients, attempted/completed
 * outreach, contact outcomes, average attempts, time-to-contact, queue
 * wait, retry behavior, capacity utilization, escalations, manual
 * follow-ups" — one function per hospital rather than a metric per
 * endpoint, since a dashboard needs all of them together and every metric
 * here is a plain aggregation, not something that benefits from being
 * independently callable. Feeds both the Campaign Manager/Hospital Admin
 * dashboards (this scoped call) and the Platform Admin aggregate dashboard
 * (getPlatformAggregateAnalytics below, which sums many of these).
 */
export async function getHospitalAnalytics(scope: HospitalScope) {
  const hospital = await getHospitalByScope(scope);
  const now = new Date();

  return withHospitalScope(scope, async (tx) => {
    const campaignStatusRows = await tx
      .select({ status: campaigns.status, total: count() })
      .from(campaigns)
      .where(eq(campaigns.hospitalId, scope.hospitalId))
      .groupBy(campaigns.status);

    const taskStatusRows = await tx
      .select({ status: outreachTasks.status, total: count() })
      .from(outreachTasks)
      .where(eq(outreachTasks.hospitalId, scope.hospitalId))
      .groupBy(outreachTasks.status);
    const taskStatusCounts = Object.fromEntries(taskStatusRows.map((r) => [r.status, r.total]));
    const totalTasks = taskStatusRows.reduce((sum, r) => sum + r.total, 0);
    const completedCount = taskStatusCounts["completed"] ?? 0;

    const outcomeRows = await tx
      .select({ outcome: outreachAttempts.outcome, total: count() })
      .from(outreachAttempts)
      .where(eq(outreachAttempts.hospitalId, scope.hospitalId))
      .groupBy(outreachAttempts.outcome);

    const completedTasks = await tx
      .select({ attemptCount: outreachTasks.attemptCount })
      .from(outreachTasks)
      .where(and(eq(outreachTasks.hospitalId, scope.hospitalId), eq(outreachTasks.status, "completed")));
    const averageAttemptsPerCompletedTask = average(completedTasks.map((t) => t.attemptCount));

    // Time-to-contact: how long after a task was created its first attempt
    // actually started. Queue wait: how long a task *currently* waiting has
    // been overdue past its own scheduledFor — a live backlog-staleness
    // signal, deliberately distinct from the historical time-to-contact
    // metric above (PRD §20 lists both).
    const firstAttempts = await tx
      .select({ startedAt: outreachAttempts.startedAt, taskCreatedAt: outreachTasks.createdAt })
      .from(outreachAttempts)
      .innerJoin(outreachTasks, eq(outreachTasks.id, outreachAttempts.outreachTaskId))
      .where(and(eq(outreachAttempts.hospitalId, scope.hospitalId), eq(outreachAttempts.attemptNumber, 1)));
    const averageTimeToContactHours = average(
      firstAttempts.map((r) => hoursBetween(r.startedAt, r.taskCreatedAt)),
    );

    const pendingTasks = await tx
      .select({ scheduledFor: outreachTasks.scheduledFor })
      .from(outreachTasks)
      .where(and(eq(outreachTasks.hospitalId, scope.hospitalId), inArray(outreachTasks.status, CLAIMABLE_STATUSES)));
    const averageQueueWaitHours = average(
      pendingTasks.map((r) => Math.max(0, hoursBetween(now, r.scheduledFor))),
    );

    const [activeCallsRow] = await tx
      .select({ activeCount: count() })
      .from(outreachTasks)
      .where(and(eq(outreachTasks.hospitalId, scope.hospitalId), eq(outreachTasks.status, "calling")));
    const activeCalls = activeCallsRow?.activeCount ?? 0;

    const escalationStatusRows = await tx
      .select({ status: escalations.status, total: count() })
      .from(escalations)
      .where(eq(escalations.hospitalId, scope.hospitalId))
      .groupBy(escalations.status);
    const escalationPriorityRows = await tx
      .select({ priority: escalations.priority, total: count() })
      .from(escalations)
      .where(eq(escalations.hospitalId, scope.hospitalId))
      .groupBy(escalations.priority);

    const [protocolCountRow] = await tx
      .select({ total: count() })
      .from(protocols)
      .where(and(eq(protocols.hospitalId, scope.hospitalId), eq(protocols.isActive, true)));

    const staffRows = await tx
      .select({ role: users.role, total: count() })
      .from(users)
      .where(eq(users.hospitalId, scope.hospitalId))
      .groupBy(users.role);

    const runningCampaigns = await tx
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.hospitalId, scope.hospitalId), eq(campaigns.status, "running")));
    let eligiblePatientCount = 0;
    for (const campaign of runningCampaigns) {
      const eligible = await evaluateEligiblePatients(scope, campaign);
      eligiblePatientCount += eligible.length;
    }

    // PRD §22: Platform Admin dashboard aggregate "AI usage" — computed
    // per-hospital here, reusing the transaction already open in this
    // function rather than calling `getAiUsageStats` (which would open a
    // second pool connection per hospital — see `computeAiUsageStats`'s own
    // comment). See that same comment for why this is real-but-currently-
    // empty, not faked.
    const aiUsage = await computeAiUsageStats(tx, scope.hospitalId);

    // PRD §22: Hospital Admin dashboard "EHR synchronization status" — see
    // this file's EHR_WRITE_ACTIVITY_WINDOW_HOURS comment for why this is
    // "EHR write activity" rather than a literal sync status. Counts rows
    // actually written through the EHR interface (server/src/ehr/mockEhr.ts)
    // on this hospital's behalf in the last window, across every
    // EHR-backed write path: outreach call summaries (communications),
    // AI-reported symptoms (observations), manual follow-ups (tasks of
    // type manual_follow_up), and escalation records.
    const ehrWriteActivityWindowStart = new Date(
      now.getTime() - EHR_WRITE_ACTIVITY_WINDOW_HOURS * 60 * 60 * 1000,
    );
    const [communicationsWriteRow] = await tx
      .select({ total: count() })
      .from(communications)
      .where(
        and(
          eq(communications.hospitalId, scope.hospitalId),
          gte(communications.createdAt, ehrWriteActivityWindowStart),
        ),
      );
    const [observationsWriteRow] = await tx
      .select({ total: count() })
      .from(observations)
      .where(
        and(
          eq(observations.hospitalId, scope.hospitalId),
          gte(observations.createdAt, ehrWriteActivityWindowStart),
        ),
      );
    const [followUpTaskWriteRow] = await tx
      .select({ total: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.hospitalId, scope.hospitalId),
          eq(tasks.type, "manual_follow_up"),
          gte(tasks.createdAt, ehrWriteActivityWindowStart),
        ),
      );
    const [escalationWriteRow] = await tx
      .select({ total: count() })
      .from(escalations)
      .where(
        and(eq(escalations.hospitalId, scope.hospitalId), gte(escalations.createdAt, ehrWriteActivityWindowStart)),
      );
    const ehrWriteActivityCounts = {
      communications: communicationsWriteRow?.total ?? 0,
      observations: observationsWriteRow?.total ?? 0,
      manualFollowUpTasks: followUpTaskWriteRow?.total ?? 0,
      escalationRecords: escalationWriteRow?.total ?? 0,
    };

    return {
      campaigns: {
        total: campaignStatusRows.reduce((sum, r) => sum + r.total, 0),
        byStatus: Object.fromEntries(campaignStatusRows.map((r) => [r.status, r.total])),
      },
      outreach: {
        totalTasks,
        byStatus: taskStatusCounts,
        byOutcome: Object.fromEntries(outcomeRows.map((r) => [r.outcome, r.total])),
        averageAttemptsPerCompletedTask,
        contactRate: totalTasks > 0 ? completedCount / totalTasks : 0,
        manualFollowUps: taskStatusCounts["manual_follow_up"] ?? 0,
      },
      timing: {
        averageTimeToContactHours,
        averageQueueWaitHours,
      },
      capacity: {
        outboundCapacity: hospital.outboundCapacity,
        activeCalls,
        utilization: hospital.outboundCapacity > 0 ? activeCalls / hospital.outboundCapacity : 0,
      },
      escalations: {
        total: escalationStatusRows.reduce((sum, r) => sum + r.total, 0),
        byStatus: Object.fromEntries(escalationStatusRows.map((r) => [r.status, r.total])),
        byPriority: Object.fromEntries(escalationPriorityRows.map((r) => [r.priority, r.total])),
      },
      eligiblePatientCount,
      activeProtocolCount: protocolCountRow?.total ?? 0,
      staffByRole: Object.fromEntries(staffRows.map((r) => [r.role, r.total])),
      aiUsage,
      // Honest proxy metric, not a literal EHR sync status — see
      // EHR_WRITE_ACTIVITY_WINDOW_HOURS's comment above and
      // docs/dashboards-analytics.md.
      ehrWriteActivity: {
        windowHours: EHR_WRITE_ACTIVITY_WINDOW_HOURS,
        ...ehrWriteActivityCounts,
        total:
          ehrWriteActivityCounts.communications +
          ehrWriteActivityCounts.observations +
          ehrWriteActivityCounts.manualFollowUpTasks +
          ehrWriteActivityCounts.escalationRecords,
      },
    };
  });
}

export type HospitalAnalytics = Awaited<ReturnType<typeof getHospitalAnalytics>>;

/**
 * PRD §20: "authorized aggregate visibility across hospitals... but
 * aggregate analytics must never bypass patient-level access controls."
 * Satisfied by construction, not by a permission check alone: this sums
 * numbers already aggregated per-hospital by `getHospitalAnalytics` (which
 * never returns a patient name, MRN, or any individually-identifying row) —
 * there is no patient-level data anywhere in this function to leak.
 * `PLATFORM_ADMIN` has no `patient.read`/`campaign.read` grant at all (see
 * config/roles.ts), so this is the only view that role can ever get.
 */
export async function getPlatformAggregateAnalytics() {
  const allHospitals = await db.select().from(hospitals);

  // Sequential, deliberately not Promise.all: each getHospitalAnalytics call
  // opens several of its own pool connections (withHospitalScope grabs a
  // fresh one per call, and evaluateEligiblePatients grabs another per
  // running campaign). Firing all of them concurrently across every hospital
  // on the platform would fan out to many times the Postgres pool's max
  // connections at once — fine for a handful of hospitals, but a real
  // problem once there are dozens+ (found by running this against a dev
  // database that had accumulated 200+ test-created hospitals across a long
  // session: the concurrent version stalled well past a reasonable timeout).
  // A platform-wide dashboard isn't latency-critical enough to be worth the
  // connection-pool risk sequential processing avoids.
  const perHospital: (HospitalAnalytics & { hospitalId: string; hospitalName: string })[] = [];
  for (const hospital of allHospitals) {
    const scope = mintHospitalScope(hospital.id);
    const analytics = await getHospitalAnalytics(scope);
    perHospital.push({ hospitalId: hospital.id, hospitalName: hospital.name, ...analytics });
  }

  const totals = perHospital.reduce(
    (acc, h) => {
      acc.campaignCount += h.campaigns.total;
      acc.activeCalls += h.capacity.activeCalls;
      acc.outboundCapacity += h.capacity.outboundCapacity;
      acc.escalationCount += h.escalations.total;
      acc.manualFollowUps += h.outreach.manualFollowUps;
      // PRD §22 "errors": queue-level failure signals that already exist on
      // every hospital's own analytics — a task that permanently failed
      // (byStatus.failed) and an attempt that failed for technical reasons
      // (byOutcome.technical_failure) — summed platform-wide rather than
      // computed fresh, so this can never drift from what
      // getHospitalAnalytics itself reports per hospital.
      acc.failedTaskCount += h.outreach.byStatus["failed"] ?? 0;
      acc.technicalFailureCount += h.outreach.byOutcome["technical_failure"] ?? 0;
      // PRD §22 "AI usage": summed from each hospital's own getAiUsageStats
      // result (see that function's comment — all-zero until pipeline.ts is
      // wired to aiCallLogService.recordAiCall). averageLatencyMs is
      // recovered as latencySum/totalCalls at the end rather than averaged
      // here, so a hospital with more calls is weighted correctly rather
      // than every hospital's average counting equally regardless of volume.
      acc.aiTotalCalls += h.aiUsage.totalCalls;
      acc.aiSuccessCount += h.aiUsage.successCount;
      acc.aiFailureCount += h.aiUsage.failureCount;
      acc.aiLatencySumMs += (h.aiUsage.averageLatencyMs ?? 0) * h.aiUsage.totalCalls;
      return acc;
    },
    {
      campaignCount: 0,
      activeCalls: 0,
      outboundCapacity: 0,
      escalationCount: 0,
      manualFollowUps: 0,
      failedTaskCount: 0,
      technicalFailureCount: 0,
      aiTotalCalls: 0,
      aiSuccessCount: 0,
      aiFailureCount: 0,
      aiLatencySumMs: 0,
    },
  );

  const queueUtilization = totals.outboundCapacity > 0 ? totals.activeCalls / totals.outboundCapacity : 0;

  return {
    hospitalCount: allHospitals.length,
    totals: {
      campaignCount: totals.campaignCount,
      activeCalls: totals.activeCalls,
      outboundCapacity: totals.outboundCapacity,
      escalationCount: totals.escalationCount,
      manualFollowUps: totals.manualFollowUps,
      queueUtilization,
    },
    // PRD §22: Platform Admin dashboard "AI usage, errors, and system
    // performance" in aggregate across hospitals. See getAiUsageStats and
    // the EHR_WRITE_ACTIVITY_WINDOW_HOURS comment above for what's live
    // data today versus what's honestly zero pending other work.
    aiUsage: {
      totalCalls: totals.aiTotalCalls,
      successCount: totals.aiSuccessCount,
      failureCount: totals.aiFailureCount,
      successRate: totals.aiTotalCalls > 0 ? totals.aiSuccessCount / totals.aiTotalCalls : null,
      averageLatencyMs: totals.aiTotalCalls > 0 ? totals.aiLatencySumMs / totals.aiTotalCalls : null,
    },
    errors: {
      failedTaskCount: totals.failedTaskCount,
      technicalFailureCount: totals.technicalFailureCount,
    },
    // "System performance" reuses the same capacity/utilization numbers
    // already computed above (`totals`) rather than a second, separately
    // computed signal — PRD §22 doesn't ask for a distinct metric here, and
    // duplicating the computation would only risk the two disagreeing.
    systemPerformance: {
      activeCalls: totals.activeCalls,
      outboundCapacity: totals.outboundCapacity,
      queueUtilization,
    },
    perHospital: perHospital.map((h) => ({
      hospitalId: h.hospitalId,
      hospitalName: h.hospitalName,
      campaigns: h.campaigns,
      capacity: h.capacity,
      escalations: h.escalations,
      aiUsage: h.aiUsage,
      errors: {
        failedTaskCount: h.outreach.byStatus["failed"] ?? 0,
        technicalFailureCount: h.outreach.byOutcome["technical_failure"] ?? 0,
      },
    })),
  };
}
