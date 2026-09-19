import { createId } from "@paralleldrive/cuid2";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { notifications, outreachAttempts, outreachTasks } from "../../src/db/schema/index.js";
import { pool } from "../../src/db/client.js";
import { redisConnection } from "../../src/queue/connection.js";
import { escalationTimeoutQueue, eventsQueue, maintenanceQueue, outreachQueue } from "../../src/queue/queues.js";
import { mintHospitalScope, withHospitalScope } from "../../src/db/scope.js";
import { ehr } from "../../src/ehr/index.js";
import { ConflictError, NotFoundError } from "../../src/lib/errors.js";
import * as campaignService from "../../src/services/campaignService.js";
import * as encounterService from "../../src/services/encounterService.js";
import * as escalationService from "../../src/services/escalationService.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as patientService from "../../src/services/patientService.js";
import * as userService from "../../src/services/userService.js";
import { eq } from "drizzle-orm";

describe("escalation lifecycle, tenant isolation, and reviewer workflow", () => {
  const suffix = createId().slice(0, 8);
  let hospitalAId: string;
  let hospitalBId: string;

  beforeAll(async () => {
    const hospitalA = await hospitalService.createHospital({
      name: `Escalation Test Hospital A ${suffix}`,
      slug: `escalation-test-a-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "09:00",
      callingHoursEnd: "18:00",
      outboundCapacity: 5,
      maxRetries: 2,
    });
    const hospitalB = await hospitalService.createHospital({
      name: `Escalation Test Hospital B ${suffix}`,
      slug: `escalation-test-b-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "08:00",
      callingHoursEnd: "20:00",
      outboundCapacity: 5,
      maxRetries: 2,
    });
    hospitalAId = hospitalA.id;
    hospitalBId = hospitalB.id;
  });

  afterAll(async () => {
    await pool.end();
    // escalationService (via events/publish.ts) creates a BullMQ Queue on a
    // shared ioredis connection at module load — closing it here is what
    // lets Jest actually exit instead of hanging on an open handle.
    await Promise.all([eventsQueue.close(), escalationTimeoutQueue.close(), outreachQueue.close(), maintenanceQueue.close()]);
    await redisConnection.quit();
  });

  async function createTestEscalation(scope: ReturnType<typeof mintHospitalScope>, mrnSuffix: string) {
    const patient = await patientService.createPatient(scope, {
      mrn: `ESC-${mrnSuffix}`,
      firstName: "Escalation",
      lastName: "Test",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    const escalation = await ehr.createEscalationRecord(scope, {
      patientId: patient.id,
      trigger: "test_trigger",
      priority: 2,
      notes: "test escalation",
    });
    return { patient, escalation };
  }

  it("walks the full lifecycle: open -> assigned -> in_review -> waiting_for_information -> in_review -> resolved -> closed", async () => {
    const scope = mintHospitalScope(hospitalAId);
    const { escalation } = await createTestEscalation(scope, `${suffix}-lifecycle`);
    expect(escalation.status).toBe("open");

    const reviewer = await userService.createHospitalUser(scope, {
      email: `escalation-lifecycle-reviewer-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Lifecycle Reviewer",
      role: "CLINICAL_REVIEWER",
    });

    const acknowledged = await escalationService.acknowledgeEscalation(scope, escalation.id, reviewer.id);
    expect(acknowledged.status).toBe("assigned");
    expect(acknowledged.assignedReviewerId).toBe(reviewer.id);

    const inReview = await escalationService.startReview(scope, escalation.id);
    expect(inReview.status).toBe("in_review");

    const waiting = await escalationService.requestInformation(scope, escalation.id, "Need discharge summary");
    expect(waiting.status).toBe("waiting_for_information");
    expect(waiting.notes).toBe("Need discharge summary");

    const resumed = await escalationService.resumeReview(scope, escalation.id);
    expect(resumed.status).toBe("in_review");

    const resolved = await escalationService.resolveEscalation(scope, escalation.id, "Patient contacted, no concern found");
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolution).toBe("Patient contacted, no concern found");
    expect(resolved.resolvedAt).not.toBeNull();

    const closed = await escalationService.closeEscalation(scope, escalation.id);
    expect(closed.status).toBe("closed");
  });

  it("rejects invalid transitions with a ConflictError", async () => {
    const scope = mintHospitalScope(hospitalAId);
    const { escalation } = await createTestEscalation(scope, `${suffix}-invalid`);

    await expect(escalationService.resolveEscalation(scope, escalation.id, "skip ahead")).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(escalationService.closeEscalation(scope, escalation.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(escalationService.resumeReview(scope, escalation.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("sends a simulated notification when an escalation is acknowledged", async () => {
    const scope = mintHospitalScope(hospitalAId);
    const { escalation } = await createTestEscalation(scope, `${suffix}-notify`);
    const reviewer = await userService.createHospitalUser(scope, {
      email: `escalation-notify-reviewer-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Notify Reviewer",
      role: "CLINICAL_REVIEWER",
    });

    await escalationService.acknowledgeEscalation(scope, escalation.id, reviewer.id);

    const rows = await withHospitalScope(scope, (tx) =>
      tx.select().from(notifications).where(eq(notifications.relatedResourceId, escalation.id)),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.status).toBe("simulated");
    expect(rows[0]!.recipientUserId).toBe(reviewer.id);
  });

  it("GET /:escalationId/notifications returns the real notification rows over HTTP", async () => {
    const app = createApp();
    const scope = mintHospitalScope(hospitalAId);
    const { escalation } = await createTestEscalation(scope, `${suffix}-notify-http`);
    const reviewer = await userService.createHospitalUser(scope, {
      email: `escalation-notify-http-reviewer-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Notify HTTP Reviewer",
      role: "CLINICAL_REVIEWER",
    });
    await escalationService.acknowledgeEscalation(scope, escalation.id, reviewer.id);

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: reviewer.email, password: "TestPassword123!" });

    const res = await request(app)
      .get(`/api/v1/escalations/${escalation.id}/notifications`)
      .set("Authorization", `Bearer ${login.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].recipientUserId).toBe(reviewer.id);
  });

  it("getEscalationDetail enriches with the originating call's transcript and triage/consensus result", async () => {
    const scope = mintHospitalScope(hospitalAId);
    const patient = await patientService.createPatient(scope, {
      mrn: `ESC-DETAIL-${suffix}`,
      firstName: "Detail",
      lastName: "Test",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    const encounter = await encounterService.createEncounter(scope, {
      patientId: patient.id,
      careSetting: "inpatient",
      dischargeDate: new Date(),
      followUpWindowHours: 72,
      riskLevel: 4,
    });

    // A real (if minimal) campaign + outreach task, since outreach_attempts
    // and escalations both have a genuine FK to outreach_tasks — simulates
    // what queueService.recordAttemptOutcome persists for a real connected
    // call, without running the whole queue/pipeline machinery.
    const campaign = await campaignService.createCampaign(scope, {
      name: `Escalation Detail Test Campaign ${suffix}`,
      followUpWindowHours: 72,
      priority: 1,
      eligibilityCriteria: {},
    });
    const [task] = await withHospitalScope(scope, (tx) =>
      tx
        .insert(outreachTasks)
        .values({
          hospitalId: hospitalAId,
          campaignId: campaign.id,
          patientId: patient.id,
          encounterId: encounter.id,
          maxAttempts: 3,
          clinicalDeadline: new Date(Date.now() + 72 * 60 * 60 * 1000),
        })
        .returning(),
    );

    const fakeTranscript = [{ speaker: "patient", text: "I have chest pain." }];
    const fakeTriage = [{ source: "rule_based", classification: "urgent" }];
    await withHospitalScope(scope, (tx) =>
      tx.insert(outreachAttempts).values({
        hospitalId: hospitalAId,
        outreachTaskId: task!.id,
        attemptNumber: 1,
        outcome: "escalated",
        startedAt: new Date(),
        endedAt: new Date(),
        transcript: fakeTranscript,
        triageResult: fakeTriage,
        consensusResult: { escalate: true },
        documentationStatus: "generated",
      }),
    );

    const escalation = await ehr.createEscalationRecord(scope, {
      patientId: patient.id,
      encounterId: encounter.id,
      outreachTaskId: task!.id,
      trigger: "ai_triage_consensus",
      priority: 1,
    });

    const detail = await escalationService.getEscalationDetail(scope, escalation.id);
    expect(detail.patient?.id).toBe(patient.id);
    expect(detail.transcript).toEqual(fakeTranscript);
    expect(detail.triageResult).toEqual(fakeTriage);
  });

  it("enforces tenant isolation at the service layer", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const scopeB = mintHospitalScope(hospitalBId);
    const { escalation } = await createTestEscalation(scopeA, `${suffix}-isolation`);

    await expect(escalationService.getEscalationById(scopeB, escalation.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      escalationService.acknowledgeEscalation(scopeB, escalation.id, "intruder"),
    ).rejects.toBeInstanceOf(NotFoundError);

    const listB = await escalationService.listEscalations(scopeB, { page: 1, limit: 100 });
    expect(listB.find((e) => e.id === escalation.id)).toBeUndefined();
  });

  it("enforces escalation RBAC over HTTP: CAMPAIGN_MANAGER can read but not manage, CLINICAL_REVIEWER can manage", async () => {
    const app = createApp();
    const scopeA = mintHospitalScope(hospitalAId);
    const { escalation } = await createTestEscalation(scopeA, `${suffix}-rbac`);

    const manager = await userService.createHospitalUser(scopeA, {
      email: `escalation-manager-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Campaign Manager",
      role: "CAMPAIGN_MANAGER",
    });
    const reviewer = await userService.createHospitalUser(scopeA, {
      email: `escalation-reviewer-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Clinical Reviewer",
      role: "CLINICAL_REVIEWER",
    });

    const loginManager = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: manager.email, password: "TestPassword123!" });
    const loginReviewer = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: reviewer.email, password: "TestPassword123!" });

    const managerRead = await request(app)
      .get(`/api/v1/escalations/${escalation.id}`)
      .set("Authorization", `Bearer ${loginManager.body.token}`);
    expect(managerRead.status).toBe(200);

    const managerAcknowledge = await request(app)
      .post(`/api/v1/escalations/${escalation.id}/acknowledge`)
      .set("Authorization", `Bearer ${loginManager.body.token}`);
    expect(managerAcknowledge.status).toBe(403);

    const reviewerAcknowledge = await request(app)
      .post(`/api/v1/escalations/${escalation.id}/acknowledge`)
      .set("Authorization", `Bearer ${loginReviewer.body.token}`);
    expect(reviewerAcknowledge.status).toBe(200);
    expect(reviewerAcknowledge.body.status).toBe("assigned");
  });
});
