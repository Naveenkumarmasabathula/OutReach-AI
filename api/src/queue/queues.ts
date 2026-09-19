import { Queue } from "bullmq";
import { redisConnection } from "./connection.js";

/**
 * One job per claimed outreach task — a job only ever exists for a task
 * that has *already* been claimed (capacity already reserved in Postgres),
 * so this queue's own concurrency setting (on the Worker, in worker.ts)
 * only controls local parallelism, not tenant capacity. The two layers are
 * deliberately independent: Postgres is the source of truth for "is there
 * room," BullMQ is just the distribution mechanism for work already granted
 * room. See docs/queue-design.md.
 */
export const outreachQueue = new Queue("outreach-calls", { connection: redisConnection });

/** Scheduler tick + stale-lock sweep — see worker.ts for what each does. */
export const maintenanceQueue = new Queue("outreach-maintenance", { connection: redisConnection });

export const SCHEDULER_TICK_JOB = "scheduler-tick";
export const RELEASE_STALE_LOCKS_JOB = "release-stale-locks";

// Fix #4 (reliability audit): `correlationId` on every job-data type below,
// so a job's processing can be tied back to whatever produced it in the
// structured logs (PRD §21). Optional, not required — a job that genuinely
// originates from a scheduled tick rather than an HTTP request (most of
// `ProcessCallJobData`'s traffic — see worker.ts's `runSchedulerTick`) gets
// a fresh one generated at enqueue time instead of a fabricated HTTP
// correlation id; one that DOES originate synchronously from an HTTP
// request (e.g. `publishEvent` called from an escalation-review route
// handler) can thread the real `req.id` through.
export type ProcessCallJobData = { hospitalId: string; taskId: string; correlationId?: string };

/**
 * PRD §18's async event bus. Publishing (server/src/events/publish.ts)
 * inserts an append-only `app_events` row first, then enqueues a job here —
 * the row is the durable record even if Redis is unavailable at enqueue
 * time; the job is just what drives asynchronous consumption of it.
 */
export const eventsQueue = new Queue("app-events", { connection: redisConnection });
export const PROCESS_EVENT_JOB = "process-event";
export type ProcessEventJobData = { hospitalId: string; eventId: string; correlationId?: string };

/**
 * The one concrete multi-step workflow PRD §18 asks to demonstrate: "an
 * escalation notifies a nurse, then escalates to a backup reviewer if not
 * acknowledged within a configured period." A delayed job per escalation,
 * `jobId`-deduped (`escalation-timeout-<id>` — no `:`, which BullMQ's custom
 * job IDs reject) so scheduling it twice for the same escalation is a
 * no-op, and its handler independently re-checks current status before
 * acting — see server/src/events/escalationTimeout.ts.
 */
export const escalationTimeoutQueue = new Queue("escalation-timeouts", { connection: redisConnection });
export const ESCALATION_TIMEOUT_JOB = "check-escalation-timeout";
export type EscalationTimeoutJobData = { hospitalId: string; escalationId: string; correlationId?: string };
