import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { pool } from "../../src/db/client.js";
import { notifications } from "../../src/db/schema/index.js";
import { mintHospitalScope, withHospitalScope } from "../../src/db/scope.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import { listNotificationsForResource, sendNotification } from "../../src/services/notificationService.js";

/**
 * Fix #2 (reliability audit): `sendNotification` had no dedup key, so a
 * retried event/job (e.g. the escalation-timeout job re-running after a
 * redelivery) could double-notify a reviewer. Proves a duplicated call with
 * the same `idempotencyKey` returns the original row rather than inserting
 * a second one, and that omitting it (every pre-existing caller) still
 * behaves exactly like a plain insert.
 */
describe("sendNotification idempotency (Fix #2)", () => {
  const suffix = createId().slice(0, 8);
  let hospitalId: string;

  beforeAll(async () => {
    const hospital = await hospitalService.createHospital({
      name: `Notification Idempotency Test Hospital ${suffix}`,
      slug: `notif-idempotency-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "08:00",
      callingHoursEnd: "20:00",
      outboundCapacity: 5,
      maxRetries: 3,
    });
    hospitalId = hospital.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a duplicated send with the same idempotencyKey returns the original row and does not insert a second one", async () => {
    const scope = mintHospitalScope(hospitalId);
    const idempotencyKey = `escalation-timeout-${suffix}-admin1`;

    const first = await sendNotification(scope, {
      subject: "Escalation unacknowledged after timeout",
      body: "First send.",
      relatedResourceType: "escalation",
      relatedResourceId: `esc-${suffix}`,
      idempotencyKey,
    });
    const second = await sendNotification(scope, {
      subject: "Escalation unacknowledged after timeout",
      body: "Retried job — same logical notification.",
      relatedResourceType: "escalation",
      relatedResourceId: `esc-${suffix}`,
      idempotencyKey,
    });

    expect(second.id).toBe(first.id);
    expect(second.body).toBe(first.body); // the original row, not overwritten by the retry's content

    const rows = await withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(notifications)
        .where(and(eq(notifications.hospitalId, hospitalId), eq(notifications.idempotencyKey, idempotencyKey))),
    );
    expect(rows).toHaveLength(1);

    const listed = await listNotificationsForResource(scope, "escalation", `esc-${suffix}`);
    expect(listed).toHaveLength(1);
  });

  it("two sends with NO idempotencyKey (the pre-existing/default path) still create two separate rows", async () => {
    const scope = mintHospitalScope(hospitalId);
    const relatedResourceId = `esc-no-key-${suffix}`;

    const first = await sendNotification(scope, {
      subject: "First",
      body: "No dedup key — send 1.",
      relatedResourceType: "escalation",
      relatedResourceId,
    });
    const second = await sendNotification(scope, {
      subject: "Second",
      body: "No dedup key — send 2.",
      relatedResourceType: "escalation",
      relatedResourceId,
    });
    expect(second.id).not.toBe(first.id);

    const listed = await listNotificationsForResource(scope, "escalation", relatedResourceId);
    expect(listed).toHaveLength(2);
  });

  it("the same idempotencyKey is independent per hospital (unique index is scoped by hospital_id, not global)", async () => {
    const otherHospital = await hospitalService.createHospital({
      name: `Notification Idempotency Test Hospital B ${suffix}`,
      slug: `notif-idempotency-b-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "08:00",
      callingHoursEnd: "20:00",
      outboundCapacity: 5,
      maxRetries: 3,
    });

    const sharedKey = `shared-notif-key-${suffix}`;
    const inA = await sendNotification(mintHospitalScope(hospitalId), {
      subject: "A",
      body: "Hospital A",
      relatedResourceType: "escalation",
      relatedResourceId: `esc-shared-${suffix}`,
      idempotencyKey: sharedKey,
    });
    const inB = await sendNotification(mintHospitalScope(otherHospital.id), {
      subject: "B",
      body: "Hospital B",
      relatedResourceType: "escalation",
      relatedResourceId: `esc-shared-${suffix}`,
      idempotencyKey: sharedKey,
    });
    expect(inA.id).not.toBe(inB.id);
  });
});
