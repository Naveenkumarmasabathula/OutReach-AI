import { and, desc, eq } from "drizzle-orm";
import { notifications } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";
import { assertDefined } from "../lib/assert.js";
import { logger } from "../lib/logger.js";
import { getDefaultNotificationChannel, getHospitalByScope } from "./hospitalService.js";

export type SendNotificationInput = {
  recipientUserId?: string;
  channel?: "dashboard" | "email" | "sms";
  subject: string;
  body: string;
  relatedResourceType: string;
  relatedResourceId: string;
  // Fix #2 (reliability audit): optional caller-supplied dedup key (e.g.
  // `escalation-acknowledged-<escalationId>`) — see the check-then-insert
  // below and `notifications.idempotencyKey`
  // (db/schema/notifications.ts). Omitting it (every pre-existing caller)
  // behaves exactly as before: a plain insert, no dedup.
  idempotencyKey?: string;
};

/**
 * Simulated/logged for now (Decision #6, docs/implementation-plan.md) — see
 * notifications.ts's own comment for why this is a real table, not just a
 * log line. Every call both writes the observable row AND logs
 * structurally, since PRD §21's AI/operational observability section also
 * wants important events in the structured log stream, not only in a table
 * a human has to think to query.
 */
export async function sendNotification(scope: HospitalScope, input: SendNotificationInput) {
  // PRD §4's "notification preferences": a caller-specified channel always
  // wins, but absent one, fall back to the hospital's own configured default
  // (hospitalSettingsSchema's `notificationPreferences.defaultChannel`)
  // rather than a hardcoded channel.
  const channel = input.channel ?? getDefaultNotificationChannel(await getHospitalByScope(scope));
  const { idempotencyKey } = input;

  const { notification, deduped } = await withHospitalScope(scope, async (tx) => {
    if (idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(notifications)
        .where(and(eq(notifications.hospitalId, scope.hospitalId), eq(notifications.idempotencyKey, idempotencyKey)));
      if (existing) return { notification: existing, deduped: true };
    }

    const [record] = await tx
      .insert(notifications)
      .values({
        hospitalId: scope.hospitalId,
        recipientUserId: input.recipientUserId,
        channel,
        status: "simulated",
        subject: input.subject,
        body: input.body,
        relatedResourceType: input.relatedResourceType,
        relatedResourceId: input.relatedResourceId,
        idempotencyKey: idempotencyKey ?? null,
      })
      .onConflictDoNothing({ target: [notifications.hospitalId, notifications.idempotencyKey] })
      .returning();
    if (record) return { notification: record, deduped: false };

    // Raced: a concurrent call with the same idempotencyKey won the insert.
    const [raced] = await tx
      .select()
      .from(notifications)
      .where(and(eq(notifications.hospitalId, scope.hospitalId), eq(notifications.idempotencyKey, idempotencyKey!)));
    return {
      notification: assertDefined(raced, "notification insert returned no row and no existing row found after conflict"),
      deduped: true,
    };
  });

  if (deduped) {
    logger.info(
      { notificationId: notification.id, hospitalId: scope.hospitalId, idempotencyKey },
      "Notification send skipped — an existing notification with this idempotency key was found (duplicate job/event, not a new send)",
    );
    return notification;
  }

  logger.info(
    { notificationId: notification.id, hospitalId: scope.hospitalId, ...input, channel },
    "Notification simulated (no real email/SMS delivery — see docs/implementation-plan.md Decision #6)",
  );

  return notification;
}

export async function listNotificationsForResource(
  scope: HospitalScope,
  relatedResourceType: string,
  relatedResourceId: string,
) {
  return withHospitalScope(scope, (tx) =>
    tx
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.relatedResourceType, relatedResourceType),
          eq(notifications.relatedResourceId, relatedResourceId),
        ),
      )
      .orderBy(desc(notifications.createdAt)),
  );
}
