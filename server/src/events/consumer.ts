import { eq } from "drizzle-orm";
import { appEvents } from "../db/schema/index.js";
import { mintHospitalScope, withHospitalScope } from "../db/scope.js";
import { logger } from "../lib/logger.js";
import { dispatchEvent } from "./handlers.js";
import type { AppEventType } from "./types.js";

/**
 * PRD §18: "must tolerate duplicate events, retries, failed consumers, and
 * out-of-order processing." `processedAt` is the idempotency marker —
 * checked before dispatching, set after, so a redelivered BullMQ job (its
 * own `attempts`/backoff already retries on a thrown error) or a manual
 * replay of the same eventId is always safe to run again.
 */
export async function processEvent(hospitalId: string, eventId: string): Promise<void> {
  const scope = mintHospitalScope(hospitalId);

  const [event] = await withHospitalScope(scope, (tx) => tx.select().from(appEvents).where(eq(appEvents.id, eventId)));
  if (!event) {
    logger.warn({ hospitalId, eventId }, "Event job fired for an event row that no longer exists — skipping");
    return;
  }
  if (event.processedAt) {
    return; // already handled by an earlier delivery of this same job
  }

  await dispatchEvent(scope, event.type as AppEventType, event.payload as Record<string, unknown>);

  await withHospitalScope(scope, (tx) =>
    tx.update(appEvents).set({ processedAt: new Date() }).where(eq(appEvents.id, eventId)),
  );
}
