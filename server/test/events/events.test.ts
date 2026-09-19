import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { pool } from "../../src/db/client.js";
import { appEvents, notifications } from "../../src/db/schema/index.js";
import { mintHospitalScope, withHospitalScope } from "../../src/db/scope.js";
import { checkEscalationTimeout } from "../../src/events/escalationTimeout.js";
import { processEvent } from "../../src/events/consumer.js";
import { publishEvent } from "../../src/events/publish.js";
import { redisConnection } from "../../src/queue/connection.js";
import { escalationTimeoutQueue, eventsQueue, maintenanceQueue, outreachQueue } from "../../src/queue/queues.js";
import { ehr } from "../../src/ehr/index.js";
import * as escalationService from "../../src/services/escalationService.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as patientService from "../../src/services/patientService.js";
import * as userService from "../../src/services/userService.js";

describe("Phase 7 async event bus and escalation-timeout workflow", () => {
  const suffix = createId().slice(0, 8);
  let hospitalId: string;

  beforeAll(async () => {
    const hospital = await hospitalService.createHospital({
      name: `Events Test Hospital ${suffix}`,
      slug: `events-test-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "09:00",
      callingHoursEnd: "18:00",
      outboundCapacity: 5,
      maxRetries: 2,
    });
    hospitalId = hospital.id;
  });

  afterAll(async () => {
    await pool.end();
    await Promise.all([
      eventsQueue.close(),
      escalationTimeoutQueue.close(),
      outreachQueue.close(),
      maintenanceQueue.close(),
    ]);
    await redisConnection.quit();
  });

  it("publishEvent persists a durable row and processEvent marks it processed exactly once", async () => {
    const scope = mintHospitalScope(hospitalId);
    await publishEvent(scope, "campaign.created", { campaignId: "fake-id-for-this-test" });

    const [event] = await withHospitalScope(scope, (tx) =>
      tx.select().from(appEvents).where(eq(appEvents.type, "campaign.created")),
    );
    expect(event).toBeDefined();
    expect(event!.processedAt).toBeNull();

    await processEvent(hospitalId, event!.id);
    const [processedOnce] = await withHospitalScope(scope, (tx) =>
      tx.select().from(appEvents).where(eq(appEvents.id, event!.id)),
    );
    expect(processedOnce!.processedAt).not.toBeNull();

    // Idempotent: processing an already-processed event again must not throw
    // or double-apply anything (no consumer for campaign.created exists, so
    // this mainly proves the processedAt short-circuit itself works).
    await expect(processEvent(hospitalId, event!.id)).resolves.toBeUndefined();
  });

  it("escalation.created notifies every CLINICAL_REVIEWER and schedules a backup-reviewer timeout job", async () => {
    const scope = mintHospitalScope(hospitalId);
    const reviewer = await userService.createHospitalUser(scope, {
      email: `events-reviewer-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Events Reviewer",
      role: "CLINICAL_REVIEWER",
    });
    const patient = await patientService.createPatient(scope, {
      mrn: `EVT-${suffix}`,
      firstName: "Events",
      lastName: "Test",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    const escalation = await ehr.createEscalationRecord(scope, {
      patientId: patient.id,
      trigger: "test_event_trigger",
      priority: 2,
    });

    await publishEvent(scope, "escalation.created", {
      escalationId: escalation.id,
      priority: escalation.priority,
      trigger: escalation.trigger,
    });
    const [event] = await withHospitalScope(scope, (tx) =>
      tx.select().from(appEvents).where(eq(appEvents.type, "escalation.created")),
    );
    await processEvent(hospitalId, event!.id);

    const notificationRows = await withHospitalScope(scope, (tx) =>
      tx.select().from(notifications).where(eq(notifications.relatedResourceId, escalation.id)),
    );
    expect(notificationRows.some((n) => n.recipientUserId === reviewer.id)).toBe(true);

    const job = await escalationTimeoutQueue.getJob(`escalation-timeout-${escalation.id}`);
    expect(job).toBeDefined();
  });

  it("task.manual_follow_up notifies every CAMPAIGN_MANAGER and HOSPITAL_ADMIN at the hospital", async () => {
    const scope = mintHospitalScope(hospitalId);
    const campaignManager = await userService.createHospitalUser(scope, {
      email: `events-cm-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Events Campaign Manager",
      role: "CAMPAIGN_MANAGER",
    });
    const hospitalAdmin = await userService.createHospitalUser(scope, {
      email: `events-followup-admin-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Events Follow-up Admin",
      role: "HOSPITAL_ADMIN",
    });
    const fakeTaskId = `fake-task-id-${suffix}`;

    await publishEvent(scope, "task.manual_follow_up", {
      taskId: fakeTaskId,
      campaignId: "fake-campaign-id-for-this-test",
      outcome: "no_answer",
    });
    const [event] = await withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(appEvents)
        .where(eq(appEvents.type, "task.manual_follow_up")),
    );
    expect(event).toBeDefined();
    await processEvent(hospitalId, event!.id);

    const notificationRows = await withHospitalScope(scope, (tx) =>
      tx.select().from(notifications).where(eq(notifications.relatedResourceId, fakeTaskId)),
    );
    expect(notificationRows.some((n) => n.recipientUserId === campaignManager.id)).toBe(true);
    expect(notificationRows.some((n) => n.recipientUserId === hospitalAdmin.id)).toBe(true);
  });

  it("checkEscalationTimeout escalates to backup review (bumps priority, notifies HOSPITAL_ADMIN) only while still open", async () => {
    const scope = mintHospitalScope(hospitalId);
    const admin = await userService.createHospitalUser(scope, {
      email: `events-admin-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Events Admin",
      role: "HOSPITAL_ADMIN",
    });
    const patient = await patientService.createPatient(scope, {
      mrn: `EVT-TIMEOUT-${suffix}`,
      firstName: "Timeout",
      lastName: "Test",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    const escalation = await ehr.createEscalationRecord(scope, {
      patientId: patient.id,
      trigger: "timeout_test",
      priority: 3,
    });

    await checkEscalationTimeout(hospitalId, escalation.id);

    const escalated = await escalationService.getEscalationById(scope, escalation.id);
    expect(escalated.priority).toBe(2); // bumped from 3 -> 2 (more urgent)
    expect(escalated.status).toBe("open"); // still needs a human to actually acknowledge it

    const adminNotifications = await withHospitalScope(scope, (tx) =>
      tx.select().from(notifications).where(eq(notifications.relatedResourceId, escalation.id)),
    );
    expect(adminNotifications.some((n) => n.recipientUserId === admin.id)).toBe(true);
  });

  it("checkEscalationTimeout is a no-op once the escalation has already been acknowledged", async () => {
    const scope = mintHospitalScope(hospitalId);
    const patient = await patientService.createPatient(scope, {
      mrn: `EVT-ACKED-${suffix}`,
      firstName: "Acked",
      lastName: "Test",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    const escalation = await ehr.createEscalationRecord(scope, {
      patientId: patient.id,
      trigger: "already_acked_test",
      priority: 3,
    });
    const reviewer = await userService.createHospitalUser(scope, {
      email: `events-acked-reviewer-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Acked Reviewer",
      role: "CLINICAL_REVIEWER",
    });
    await escalationService.acknowledgeEscalation(scope, escalation.id, reviewer.id);

    await checkEscalationTimeout(hospitalId, escalation.id);

    const unchanged = await escalationService.getEscalationById(scope, escalation.id);
    expect(unchanged.priority).toBe(3); // unchanged — the timeout check no-ops once acknowledged
    expect(unchanged.status).toBe("assigned");
  });
});
