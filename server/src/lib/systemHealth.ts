import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { aiProviderCircuitBreaker } from "../ai/circuitBreaker.js";
import { hospitals } from "../db/schema/index.js";
import { mintHospitalScope } from "../db/scope.js";
import { redisConnection } from "../queue/connection.js";
import { CLAIMABLE_STATUSES, getQueueHealth as getHospitalQueueHealth } from "../services/queueService.js";

export type HealthState = "healthy" | "degraded" | "unavailable";

/**
 * PRD §21's 7 queue-health fields (active calls, capacity, pending work,
 * oldest task, cutoff-risk tasks, failed tasks, stuck workers), rolled up
 * platform-wide rather than per-campaign/per-hospital — see
 * `getAggregateQueueHealth` below. Every field here is an aggregate count or
 * timestamp; nothing patient- or hospital-identifying, since `GET /health`
 * is deliberately unauthenticated (Fix #3, reliability audit).
 */
export type AggregateQueueHealth = {
  activeCalls: number;
  capacity: number;
  pendingWork: number;
  oldestPendingScheduledFor: Date | null;
  tasksNearCutoff: number;
  failedTasks: number;
  stuckWorkers: number;
};

export type SystemHealthReport = {
  status: HealthState;
  checks: {
    database: "ok" | "failed";
    redis: "ok" | "failed";
    aiProvider: "ok" | "degraded";
  };
  queue: AggregateQueueHealth | null;
};

const CHECK_TIMEOUT_MS = 2000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("health check timed out")), ms)),
  ]);
}

/**
 * Fix #3 (reliability audit): the 7 PRD §21 queue-health fields already
 * exist per-campaign (`queueService.getQueueHealth`, reached only via the
 * authenticated `GET /api/v1/campaigns/:id/queue-health`) but were never
 * surfaced on the platform-wide, unauthenticated `/health` endpoint. Rather
 * than reimplement that logic against the raw tables, this calls the exact
 * same exported `getQueueHealth(scope)` once per active hospital (mirroring
 * how `queueService.releaseStaleLocks` already enumerates hospitals from
 * the unscoped, non-RLS `hospitals` table and then runs a properly *scoped*
 * query per hospital — `outreach_tasks` has RLS FORCED, so a single global
 * query against it via the unscoped `db` connection would silently return
 * zero rows) and sums the per-hospital results client-side. A handful of
 * hospitals (this is a prototype, not a multi-region platform) makes N
 * small scoped queries perfectly fine — no need for a cross-tenant raw SQL
 * aggregate that would have to reimplement `getQueueHealth`'s own
 * cutoff/stuck-worker thresholds a second time.
 */
async function getAggregateQueueHealth(): Promise<AggregateQueueHealth> {
  const activeHospitals = await db
    .select({ id: hospitals.id, outboundCapacity: hospitals.outboundCapacity })
    .from(hospitals)
    .where(eq(hospitals.status, "active"));

  const perHospital = await Promise.all(
    activeHospitals.map((hospital) => getHospitalQueueHealth(mintHospitalScope(hospital.id))),
  );

  const aggregate: AggregateQueueHealth = {
    activeCalls: 0,
    capacity: activeHospitals.reduce((sum, h) => sum + h.outboundCapacity, 0),
    pendingWork: 0,
    oldestPendingScheduledFor: null,
    tasksNearCutoff: 0,
    failedTasks: 0,
    stuckWorkers: 0,
  };

  for (const health of perHospital) {
    aggregate.activeCalls += health.byStatus.calling ?? 0;
    aggregate.failedTasks += health.byStatus.failed ?? 0;
    aggregate.pendingWork += CLAIMABLE_STATUSES.reduce((sum, status) => sum + (health.byStatus[status] ?? 0), 0);
    aggregate.tasksNearCutoff += health.tasksNearCutoff;
    aggregate.stuckWorkers += health.stuckTasksCount;
    if (
      health.oldestPendingScheduledFor &&
      (!aggregate.oldestPendingScheduledFor || health.oldestPendingScheduledFor < aggregate.oldestPendingScheduledFor)
    ) {
      aggregate.oldestPendingScheduledFor = health.oldestPendingScheduledFor;
    }
  }

  return aggregate;
}

/**
 * PRD §21: "Health states: Healthy, Degraded, Unavailable." Database and
 * Redis are both hard dependencies — the platform genuinely cannot function
 * without either, so either one failing means `unavailable`, not merely
 * `degraded`. A degraded AI provider (its circuit breaker open — see
 * ai/circuitBreaker.ts) doesn't take the whole platform down: outreach
 * calls that don't need triage (still connecting, retrying, etc.) keep
 * working, and connected calls fall back to a conservative single-assessment
 * mode rather than failing outright — so that alone is only `degraded`.
 * Each check has its own timeout so a hung dependency can't hang the health
 * endpoint itself.
 */
export async function getSystemHealth(): Promise<SystemHealthReport> {
  const [databaseOk, redisOk, queue] = await Promise.all([
    withTimeout(db.execute(sql`SELECT 1`), CHECK_TIMEOUT_MS)
      .then(() => true)
      .catch(() => false),
    withTimeout(redisConnection.ping(), CHECK_TIMEOUT_MS)
      .then(() => true)
      .catch(() => false),
    // Its own timeout, same as the database/redis checks, and never lets a
    // failure here (e.g. the database check above already failing) take
    // down the whole endpoint — `queue: null` just means this particular
    // rollup couldn't be computed right now, not that the platform is down.
    withTimeout(getAggregateQueueHealth(), CHECK_TIMEOUT_MS).catch(() => null),
  ]);

  const aiProviderDegraded = aiProviderCircuitBreaker.getState() !== "closed";

  let status: HealthState = "healthy";
  if (!databaseOk || !redisOk) {
    status = "unavailable";
  } else if (aiProviderDegraded) {
    status = "degraded";
  }

  return {
    status,
    checks: {
      database: databaseOk ? "ok" : "failed",
      redis: redisOk ? "ok" : "failed",
      aiProvider: aiProviderDegraded ? "degraded" : "ok",
    },
    queue,
  };
}
