import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { db } from "./db/client.js";
import { hospitals } from "./db/schema/index.js";
import { mintHospitalScope } from "./db/scope.js";
import { checkEscalationTimeout } from "./events/escalationTimeout.js";
import { processEvent } from "./events/consumer.js";
import { logger } from "./lib/logger.js";
import { redisConnection } from "./queue/connection.js";
import {
  ESCALATION_TIMEOUT_JOB,
  escalationTimeoutQueue,
  eventsQueue,
  maintenanceQueue,
  outreachQueue,
  PROCESS_EVENT_JOB,
  RELEASE_STALE_LOCKS_JOB,
  SCHEDULER_TICK_JOB,
  type EscalationTimeoutJobData,
  type ProcessCallJobData,
  type ProcessEventJobData,
} from "./queue/queues.js";
import * as queueService from "./services/queueService.js";

const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

const SCHEDULER_TICK_MS = 5_000;
const STALE_LOCK_SWEEP_MS = 60_000;

/**
 * Runs every SCHEDULER_TICK_MS. For each hospital, claims as much claimable
 * work as its current capacity allows (queueService.claimNextTasks is the
 * safety boundary — this job is just what calls it on a schedule) and hands
 * each claimed task to the outreach-calls queue as its own job. Iterating
 * hospitals from the unscoped `hospitals` table is safe (it has no RLS,
 * unlike the tables claimNextTasks touches) — see docs/multi-tenancy.md.
 */
async function runSchedulerTick() {
  const allHospitals = await db.select({ id: hospitals.id }).from(hospitals);
  for (const { id: hospitalId } of allHospitals) {
    const scope = mintHospitalScope(hospitalId);
    const claimed = await queueService.claimNextTasks(scope, WORKER_ID);
    for (const task of claimed) {
      // Fix #4 (reliability audit): this job originates from a scheduled
      // tick, not an HTTP request, so there's no real originating
      // correlation id to thread through — a fresh one generated here is
      // exactly what docs/observability-reliability.md says is fine for
      // that case, and it's still what lets every one of this job's log
      // lines (below and in queueService.processTask) be tied together.
      const data: ProcessCallJobData = { hospitalId, taskId: task.id, correlationId: randomUUID() };
      // jobId = task.id: a defense-in-depth dedup guard on top of the DB-level
      // compare-and-swap claim — if a tick somehow ran twice before this job
      // completed, BullMQ itself refuses a duplicate jobId.
      await outreachQueue.add("process-call", data, {
        jobId: task.id,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      });
    }
  }
}

async function runReleaseStaleLocks() {
  const released = await queueService.releaseStaleLocks(queueService.STALE_LOCK_THRESHOLD_MINUTES);
  if (released > 0) {
    logger.info({ released }, "Stale-lock sweep released tasks back into the queue");
  }
}

async function main() {
  await maintenanceQueue.upsertJobScheduler(
    "scheduler-tick-repeat",
    { every: SCHEDULER_TICK_MS },
    { name: SCHEDULER_TICK_JOB },
  );
  await maintenanceQueue.upsertJobScheduler(
    "release-stale-locks-repeat",
    { every: STALE_LOCK_SWEEP_MS },
    { name: RELEASE_STALE_LOCKS_JOB },
  );

  const maintenanceWorker = new Worker(
    maintenanceQueue.name,
    async (job) => {
      if (job.name === SCHEDULER_TICK_JOB) return runSchedulerTick();
      if (job.name === RELEASE_STALE_LOCKS_JOB) return runReleaseStaleLocks();
      logger.warn({ jobName: job.name }, "Unknown maintenance job name");
    },
    { connection: redisConnection, concurrency: 1 },
  );

  const outreachWorker = new Worker(
    outreachQueue.name,
    async (job) => {
      const { hospitalId, taskId, correlationId } = job.data as ProcessCallJobData;
      // job.id (= taskId, see the dedup comment above) is this async
      // workflow's correlation identifier (PRD §21) — logged on every run,
      // not only on failure, so a task's processing can be traced through
      // the logs even when it succeeds. `correlationId` (Fix #4) rides
      // alongside it — every worker log line now carries one, whether it
      // traces back to a real HTTP request or was freshly generated at
      // enqueue time (see runSchedulerTick above).
      logger.info({ jobId: job.id, hospitalId, taskId, correlationId }, "Processing outreach call job");
      const scope = mintHospitalScope(hospitalId);
      await queueService.processTask(scope, taskId);
    },
    // Concurrency here is local parallelism only — capacity was already
    // reserved at claim time, so this can safely run several at once
    // without exceeding any hospital's outboundCapacity.
    { connection: redisConnection, concurrency: 10 },
  );

  // PRD §18's async event bus consumer and its one concrete multi-step
  // workflow (escalation-created -> notify -> timeout -> backup escalation).
  // See src/events/ and docs/workflows-events.md.
  const eventsWorker = new Worker(
    eventsQueue.name,
    async (job) => {
      if (job.name !== PROCESS_EVENT_JOB) return;
      const { hospitalId, eventId, correlationId } = job.data as ProcessEventJobData;
      logger.info({ jobId: job.id, hospitalId, eventId, correlationId }, "Processing event job");
      await processEvent(hospitalId, eventId);
    },
    { connection: redisConnection, concurrency: 5 },
  );

  const escalationTimeoutWorker = new Worker(
    escalationTimeoutQueue.name,
    async (job) => {
      if (job.name !== ESCALATION_TIMEOUT_JOB) return;
      const { hospitalId, escalationId, correlationId } = job.data as EscalationTimeoutJobData;
      logger.info({ jobId: job.id, hospitalId, escalationId, correlationId }, "Processing escalation timeout job");
      await checkEscalationTimeout(hospitalId, escalationId);
    },
    { connection: redisConnection, concurrency: 5 },
  );

  maintenanceWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "Maintenance job failed"));
  outreachWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "Outreach call job failed"));
  eventsWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "Event job failed"));
  escalationTimeoutWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "Escalation timeout job failed"));

  logger.info({ workerId: WORKER_ID }, "Queue worker started");

  const shutdown = async () => {
    logger.info("Shutting down queue worker...");
    await Promise.all([
      maintenanceWorker.close(),
      outreachWorker.close(),
      eventsWorker.close(),
      escalationTimeoutWorker.close(),
    ]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "Queue worker failed to start");
  process.exit(1);
});
