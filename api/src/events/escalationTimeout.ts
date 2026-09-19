import { mintHospitalScope } from "../db/scope.js";
import { logger } from "../lib/logger.js";
import * as escalationService from "../services/escalationService.js";
import { sendNotification } from "../services/notificationService.js";
import { listUsersForHospital } from "../services/userService.js";

/**
 * The delayed half of PRD §18's worked example — see handlers.ts's
 * `handleEscalationCreated` for the immediate-notification half. Idempotent
 * by construction: re-checks the escalation's current status before doing
 * anything, so running this twice (a redelivered/duplicate BullMQ job, or a
 * manually replayed one) is a safe no-op if the escalation was already
 * acknowledged, assigned, resolved, or closed by the time it fires — or even
 * if it already went through this exact path once before.
 */
export async function checkEscalationTimeout(hospitalId: string, escalationId: string): Promise<void> {
  const scope = mintHospitalScope(hospitalId);

  const escalation = await escalationService.getEscalationById(scope, escalationId).catch(() => null);
  if (!escalation) {
    logger.warn({ hospitalId, escalationId }, "Escalation timeout check found no matching escalation — skipping");
    return;
  }
  if (escalation.status !== "open") {
    return; // acknowledged/assigned/resolved/closed already — nothing to do
  }

  const bumpedPriority = Math.max(1, escalation.priority - 1);
  await escalationService.escalateToBackupReviewer(scope, escalationId, bumpedPriority);

  const admins = (await listUsersForHospital(scope)).filter((u) => u.role === "HOSPITAL_ADMIN");
  for (const admin of admins) {
    await sendNotification(scope, {
      recipientUserId: admin.id,
      subject: `Escalation unacknowledged after timeout (now priority ${bumpedPriority})`,
      body: `Escalation ${escalationId} was not acknowledged within the configured reviewer timeout and has been escalated to backup review.`,
      relatedResourceType: "escalation",
      relatedResourceId: escalationId,
      // Fix #2 (reliability audit): unlike the status-guarded actions in
      // escalationService.ts, nothing above stops two concurrent runs of
      // this function for the same escalation (e.g. a redelivered BullMQ
      // job racing the original) from both passing the `status === "open"`
      // check and both reaching this loop — `escalateToBackupReviewer`
      // doesn't change status away from "open". This key is the actual
      // guard against duplicate admin notifications in that case, not just
      // defense-in-depth.
      idempotencyKey: `escalation-timeout-${escalationId}-${admin.id}`,
    });
  }
}
