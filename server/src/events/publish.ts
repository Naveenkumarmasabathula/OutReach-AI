import { randomUUID } from "node:crypto";
import { appEvents } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";
import { assertDefined } from "../lib/assert.js";
import { eventsQueue, PROCESS_EVENT_JOB, type ProcessEventJobData } from "../queue/queues.js";
import type { AppEventType } from "./types.js";

/**
 * The durable write happens first (an `app_events` row), the async
 * enqueue happens second — if Redis is briefly unavailable, the event still
 * exists and can be replayed, rather than the publish silently vanishing.
 * `jobId: event.id` gives BullMQ's own dedup a second idempotency layer on
 * top of the consumer's own `processedAt` check (server/src/events/consumer.ts).
 *
 * `correlationId` (Fix #4, reliability audit): an optional 4th argument, not
 * a required one — every pre-existing call site (queueService.ts,
 * campaignService.ts, events/handlers.ts) keeps working unchanged and just
 * gets a fresh id generated here, same as a scheduled-tick-originated job
 * would. A caller that DOES have a real originating id (e.g. a route
 * handler passing `req.id` through a service function) can pass it through
 * to get genuine HTTP-to-worker-log tracing — see escalationService.ts's
 * `acknowledgeEscalation`/`resolveEscalation` for a wired example.
 */
export async function publishEvent(
  scope: HospitalScope,
  type: AppEventType,
  payload: Record<string, unknown>,
  correlationId?: string,
): Promise<void> {
  const event = await withHospitalScope(scope, async (tx) => {
    const [row] = await tx.insert(appEvents).values({ hospitalId: scope.hospitalId, type, payload }).returning();
    return assertDefined(row, "event insert returned no row");
  });

  const jobData: ProcessEventJobData = {
    hospitalId: scope.hospitalId,
    eventId: event.id,
    correlationId: correlationId ?? randomUUID(),
  };
  await eventsQueue.add(PROCESS_EVENT_JOB, jobData, { jobId: event.id, attempts: 3, backoff: { type: "exponential", delay: 2000 } });
}
