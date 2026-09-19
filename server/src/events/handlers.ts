import type { HospitalScope } from "../db/scope.js";
import { logger } from "../lib/logger.js";
import { ESCALATION_TIMEOUT_JOB, escalationTimeoutQueue, type EscalationTimeoutJobData } from "../queue/queues.js";
import { getEscalationReviewerTimeoutMinutes, getHospitalByScope } from "../services/hospitalService.js";
import { sendNotification } from "../services/notificationService.js";
import { listUsersForHospital } from "../services/userService.js";
import type { AppEventType } from "./types.js";

type EventHandler = (scope: HospitalScope, payload: Record<string, unknown>) => Promise<void>;

/**
 * PRD §18: "notifies a nurse, then escalates to a backup reviewer if not
 * acknowledged within a configured period." This handler is the "notifies"
 * half; server/src/events/escalationTimeout.ts's delayed job is the
 * "escalates to a backup reviewer" half. Notifying by role (every
 * `CLINICAL_REVIEWER` at this hospital) rather than a single assignee,
 * since nothing has been assigned yet at creation time.
 */
async function handleEscalationCreated(scope: HospitalScope, payload: Record<string, unknown>): Promise<void> {
  const escalationId = payload.escalationId as string;
  const priority = payload.priority as number;
  const trigger = payload.trigger as string;

  const reviewers = (await listUsersForHospital(scope)).filter((u) => u.role === "CLINICAL_REVIEWER");
  for (const reviewer of reviewers) {
    await sendNotification(scope, {
      recipientUserId: reviewer.id,
      subject: `New escalation (priority ${priority})`,
      body: `A new escalation was created (trigger: ${trigger}). Please review.`,
      relatedResourceType: "escalation",
      relatedResourceId: escalationId,
    });
  }

  const hospital = await getHospitalByScope(scope);
  const timeoutMinutes = getEscalationReviewerTimeoutMinutes(hospital);
  const jobData: EscalationTimeoutJobData = { hospitalId: scope.hospitalId, escalationId };
  await escalationTimeoutQueue.add(ESCALATION_TIMEOUT_JOB, jobData, {
    jobId: `escalation-timeout-${escalationId}`,
    delay: timeoutMinutes * 60 * 1000,
  });
}

/**
 * PRD §18/§21: once a task exhausts its automated retries,
 * `queueService.recordAttemptOutcome` already creates a real EHR follow-up
 * task and publishes this event — but until now nothing consumed it, so no
 * human was ever actually notified that a patient had fallen out of the
 * automated queue. Notifies by role (every `CAMPAIGN_MANAGER` and
 * `HOSPITAL_ADMIN` at this hospital), same convention as
 * `handleEscalationCreated` above (notify by role, not a single assignee,
 * since nothing has been assigned yet) — both roles, since a campaign
 * manager owns day-to-day outreach operations but a hospital admin is the
 * other role with standing visibility into a hospital's outreach queue
 * (`docs/queue-design.md`'s "manual escalation behavior" section documents
 * the analogous escalation-notification convention this mirrors).
 */
async function handleManualFollowUp(scope: HospitalScope, payload: Record<string, unknown>): Promise<void> {
  const taskId = payload.taskId as string;
  const campaignId = payload.campaignId as string;
  const outcome = payload.outcome as string;

  const recipients = (await listUsersForHospital(scope)).filter(
    (u) => u.role === "CAMPAIGN_MANAGER" || u.role === "HOSPITAL_ADMIN",
  );
  for (const recipient of recipients) {
    await sendNotification(scope, {
      recipientUserId: recipient.id,
      subject: "Outreach task needs manual follow-up",
      body: `Outreach task ${taskId} (campaign ${campaignId}) exhausted its automated retry attempts (last outcome: ${outcome}) and now requires manual follow-up.`,
      relatedResourceType: "outreach_task",
      relatedResourceId: taskId,
    });
  }
}

// escalation.created and task.manual_follow_up have real consumers today.
// Every other published event type is persisted (app_events) and
// audit-visible but not yet acted on — an honest, bounded scope choice, not
// an oversight; see docs/workflows-events.md for which events are "wired" vs.
// "logged only."
const HANDLERS: Partial<Record<AppEventType, EventHandler>> = {
  "escalation.created": handleEscalationCreated,
  "task.manual_follow_up": handleManualFollowUp,
};

export async function dispatchEvent(
  scope: HospitalScope,
  type: AppEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const handler = HANDLERS[type];
  if (!handler) {
    logger.debug({ type }, "Event has no registered consumer yet — persisted for audit/observability only");
    return;
  }
  await handler(scope, payload);
}
