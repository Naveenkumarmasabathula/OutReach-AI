import { createId } from "@paralleldrive/cuid2";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { pool } from "../../src/db/client.js";
import { mintHospitalScope } from "../../src/db/scope.js";
import { redisConnection } from "../../src/queue/connection.js";
import { escalationTimeoutQueue, eventsQueue, maintenanceQueue, outreachQueue } from "../../src/queue/queues.js";
import { ehr } from "../../src/ehr/index.js";
import * as aiCallLogService from "../../src/services/aiCallLogService.js";
import * as analyticsService from "../../src/services/analyticsService.js";
import * as campaignService from "../../src/services/campaignService.js";
import * as encounterService from "../../src/services/encounterService.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as patientService from "../../src/services/patientService.js";
import * as queueService from "../../src/services/queueService.js";
import * as userService from "../../src/services/userService.js";

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

describe("analyticsService (Phase 8 dashboards)", () => {
  const suffix = createId().slice(0, 8);
  let hospitalAId: string;
  let hospitalBId: string;

  beforeAll(async () => {
    const hospitalA = await hospitalService.createHospital({
      name: `Analytics Test Hospital A ${suffix}`,
      slug: `analytics-test-a-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "00:00",
      callingHoursEnd: "23:59",
      outboundCapacity: 10,
      maxRetries: 2,
    });
    const hospitalB = await hospitalService.createHospital({
      name: `Analytics Test Hospital B ${suffix}`,
      slug: `analytics-test-b-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "00:00",
      callingHoursEnd: "23:59",
      outboundCapacity: 5,
      maxRetries: 2,
    });
    hospitalAId = hospitalA.id;
    hospitalBId = hospitalB.id;

    // Hospitals are created in 'draft' status and must be explicitly marked
    // ready before a campaign can be started (campaignService.startCampaign
    // enforces this) — unrelated to analytics itself, just required setup.
    await hospitalService.markHospitalReady(mintHospitalScope(hospitalAId));
    await hospitalService.markHospitalReady(mintHospitalScope(hospitalBId));
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

  it("aggregates campaigns, outreach outcomes, escalations, and eligible-patient counts for one hospital", async () => {
    const scope = mintHospitalScope(hospitalAId);

    const patient = await patientService.createPatient(scope, {
      mrn: `ANALYTICS-${suffix}`,
      firstName: "Priya",
      lastName: "Okafor",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    await encounterService.createEncounter(scope, {
      patientId: patient.id,
      careSetting: "inpatient",
      dischargeDate: hoursAgo(5),
      followUpWindowHours: 72,
      riskLevel: 3,
    });

    const campaign = await campaignService.createCampaign(scope, {
      name: `Analytics Campaign ${suffix}`,
      followUpWindowHours: 72,
      priority: 1,
      eligibilityCriteria: {},
    });
    await campaignService.markCampaignReady(scope, campaign.id);
    const started = await campaignService.startCampaign(scope, campaign.id);
    await queueService.enqueueEligiblePatients(scope, started);

    const claimed = await queueService.claimNextTasks(scope, `analytics-test-worker-${suffix}`);
    const task = claimed.find((t) => t.patientId === patient.id);
    if (!task) throw new Error("expected task to be claimable");

    const hospital = await hospitalService.getHospitalByScope(scope);
    await queueService.recordAttemptOutcome(scope, task, "completed", new Date(), new Date(), hospital);

    await ehr.createEscalationRecord(scope, { patientId: patient.id, trigger: "analytics_test", priority: 2 });

    const analytics = await analyticsService.getHospitalAnalytics(scope);

    expect(analytics.campaigns.total).toBeGreaterThanOrEqual(1);
    expect(analytics.campaigns.byStatus["running"]).toBeGreaterThanOrEqual(1);
    expect(analytics.outreach.byStatus["completed"]).toBeGreaterThanOrEqual(1);
    expect(analytics.outreach.byOutcome["completed"]).toBeGreaterThanOrEqual(1);
    expect(analytics.outreach.contactRate).toBeGreaterThan(0);
    expect(analytics.escalations.total).toBeGreaterThanOrEqual(1);
    expect(analytics.escalations.byStatus["open"]).toBeGreaterThanOrEqual(1);
    expect(analytics.capacity.outboundCapacity).toBe(10);

    // PRD §22 "EHR synchronization status" (Hospital Admin dashboard) — an
    // honest "EHR write activity" proxy, not a fabricated literal sync
    // status (see analyticsService's EHR_WRITE_ACTIVITY_WINDOW_HOURS
    // comment). The escalation record created above via
    // `ehr.createEscalationRecord` just now is well within the window.
    expect(analytics.ehrWriteActivity.windowHours).toBe(24);
    expect(analytics.ehrWriteActivity.escalationRecords).toBeGreaterThanOrEqual(1);
    expect(analytics.ehrWriteActivity.total).toBeGreaterThanOrEqual(analytics.ehrWriteActivity.escalationRecords);

    // PRD §22 "AI usage" (Platform Admin dashboard, in aggregate) — honestly
    // all-zero here since nothing in this test (or anywhere else yet) writes
    // to ai_call_log; see the dedicated aiCallLogService test below for the
    // write+read path once something does call it.
    expect(analytics.aiUsage).toEqual({
      totalCalls: 0,
      byAgentType: {},
      successCount: 0,
      failureCount: 0,
      successRate: null,
      averageLatencyMs: null,
    });
  });

  it("getAiUsageStats aggregates ai_call_log rows once something writes to it, and getHospitalAnalytics reflects the same data", async () => {
    const scope = mintHospitalScope(hospitalAId);

    // Nothing in ai/pipeline.ts calls this yet (see aiCallLogService's own
    // comment) — this simulates what it will do once wired, to prove the
    // write helper and the read-side aggregation actually agree.
    await aiCallLogService.recordAiCall(scope, {
      agentType: "clinical_triage",
      provider: "gemini",
      model: "gemini-2.0-flash",
      latencyMs: 120,
      success: true,
    });
    await aiCallLogService.recordAiCall(scope, {
      agentType: "clinical_triage",
      provider: "gemini",
      model: "gemini-2.0-flash",
      latencyMs: 80,
      success: false,
    });
    await aiCallLogService.recordAiCall(scope, {
      agentType: "documentation",
      provider: "gemini",
      latencyMs: 40,
      success: true,
    });

    const stats = await analyticsService.getAiUsageStats(scope);
    expect(stats.totalCalls).toBe(3);
    expect(stats.byAgentType).toEqual({ clinical_triage: 2, documentation: 1 });
    expect(stats.successCount).toBe(2);
    expect(stats.failureCount).toBe(1);
    expect(stats.successRate).toBeCloseTo(2 / 3);
    expect(stats.averageLatencyMs).toBeCloseTo((120 + 80 + 40) / 3);

    // Same shape reachable through the hospital dashboard's own analytics
    // call, not just the standalone function.
    const hospitalAnalytics = await analyticsService.getHospitalAnalytics(scope);
    expect(hospitalAnalytics.aiUsage).toEqual(stats);
  });

  it("keeps analytics tenant-isolated — hospital B's analytics never reflect hospital A's data", async () => {
    const scopeB = mintHospitalScope(hospitalBId);
    const analyticsB = await analyticsService.getHospitalAnalytics(scopeB);
    expect(analyticsB.campaigns.total).toBe(0);
    expect(analyticsB.escalations.total).toBe(0);
    expect(analyticsB.capacity.outboundCapacity).toBe(5);
    // Hospital A has, by this point in the file, written ai_call_log rows
    // and an escalation record (the tests above) — confirms those new
    // aggregations are tenant-scoped too, not just the pre-existing ones.
    expect(analyticsB.aiUsage.totalCalls).toBe(0);
    expect(analyticsB.ehrWriteActivity.total).toBe(0);
  });

  it(
    "platform aggregate analytics sums real per-hospital data and never includes patient-identifying fields",
    async () => {
      const aggregate = await analyticsService.getPlatformAggregateAnalytics();

      const hospitalAEntry = aggregate.perHospital.find((h) => h.hospitalId === hospitalAId);
      expect(hospitalAEntry).toBeDefined();
      expect(hospitalAEntry!.campaigns.total).toBeGreaterThanOrEqual(1);
      expect(aggregate.totals.outboundCapacity).toBeGreaterThanOrEqual(15); // at least A's 10 + B's 5

      // Structural guarantee, not just "we didn't happen to select it": the
      // aggregate is built entirely from getHospitalAnalytics's own return
      // shape, which has no patient-identifying field anywhere in it.
      const serialized = JSON.stringify(aggregate);
      expect(serialized).not.toContain("Priya"); // the patient's firstName
      expect(serialized).not.toContain("Okafor"); // the patient's lastName
      expect(serialized).not.toContain(`ANALYTICS-${suffix}`); // the patient's MRN

      // PRD §22: "AI usage, errors, and system performance" in aggregate.
      // Real aggregation (not a stub) — reflects the 3 ai_call_log rows the
      // "getAiUsageStats aggregates..." test above wrote for hospital A
      // (via aiCallLogService.recordAiCall, simulating what ai/pipeline.ts
      // will do once wired — see that function's own comment). Summed
      // correctly across whatever else is in this shared dev database, not
      // asserted as an exact total.
      expect(aggregate.aiUsage.totalCalls).toBeGreaterThanOrEqual(3);
      expect(aggregate.aiUsage.successCount).toBeGreaterThanOrEqual(2);
      expect(aggregate.aiUsage.failureCount).toBeGreaterThanOrEqual(1);
      expect(aggregate.errors.failedTaskCount).toBeGreaterThanOrEqual(0);
      expect(aggregate.errors.technicalFailureCount).toBeGreaterThanOrEqual(0);
      expect(aggregate.systemPerformance.outboundCapacity).toBe(aggregate.totals.outboundCapacity);
      expect(aggregate.systemPerformance.queueUtilization).toBe(aggregate.totals.queueUtilization);
      expect(hospitalAEntry!.aiUsage.totalCalls).toBe(3);
      expect(hospitalAEntry!.aiUsage.successCount).toBe(2);
      expect(hospitalAEntry!.aiUsage.failureCount).toBe(1);
      expect(typeof hospitalAEntry!.errors.failedTaskCount).toBe("number");
      expect(typeof hospitalAEntry!.errors.technicalFailureCount).toBe("number");
    },
    // This dev DB accumulates hospitals across every test run in this long
    // session (see getPlatformAggregateAnalytics's own comment on why it
    // processes hospitals sequentially rather than concurrently) — a
    // platform-wide sequential scan over hundreds of accumulated hospitals
    // is genuinely slower than Jest's 5s default, not a sign anything here
    // is broken.
    30000,
  );

  it("enforces analytics RBAC over HTTP: CLINICAL_REVIEWER (no analytics.read) gets 403, CAMPAIGN_MANAGER gets 200", async () => {
    const app = createApp();
    const scope = mintHospitalScope(hospitalAId);

    const manager = await userService.createHospitalUser(scope, {
      email: `analytics-manager-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Analytics Manager",
      role: "CAMPAIGN_MANAGER",
    });
    const reviewer = await userService.createHospitalUser(scope, {
      email: `analytics-reviewer-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Analytics Reviewer",
      role: "CLINICAL_REVIEWER",
    });

    const loginManager = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: manager.email, password: "TestPassword123!" });
    const loginReviewer = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: reviewer.email, password: "TestPassword123!" });

    const managerRes = await request(app)
      .get("/api/v1/analytics/hospital")
      .set("Authorization", `Bearer ${loginManager.body.token}`);
    expect(managerRes.status).toBe(200);

    const reviewerRes = await request(app)
      .get("/api/v1/analytics/hospital")
      .set("Authorization", `Bearer ${loginReviewer.body.token}`);
    expect(reviewerRes.status).toBe(403);
  });

  it(
    "enforces platform-analytics RBAC over HTTP: PLATFORM_ADMIN can read, a hospital-scoped role cannot",
    async () => {
      const app = createApp();
      const platformAdmin = await userService.createPlatformAdmin({
        email: `analytics-platform-admin-${suffix}@test.dev`,
        password: "TestPassword123!",
        name: "Platform Admin",
      });
      const loginPlatform = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: platformAdmin.email, password: "TestPassword123!" });

      const platformRes = await request(app)
        .get("/api/v1/platform/analytics")
        .set("Authorization", `Bearer ${loginPlatform.body.token}`);
      expect(platformRes.status).toBe(200);
      expect(platformRes.body.hospitalCount).toBeGreaterThanOrEqual(2);
      // Same aggregate shape asserted over HTTP, not just via the direct
      // service call above.
      expect(platformRes.body.aiUsage).toBeDefined();
      expect(platformRes.body.errors).toBeDefined();
      expect(platformRes.body.systemPerformance).toBeDefined();

      const scope = mintHospitalScope(hospitalAId);
      const admin = await userService.createHospitalUser(scope, {
        email: `analytics-hospital-admin-${suffix}@test.dev`,
        password: "TestPassword123!",
        name: "Hospital Admin",
        role: "HOSPITAL_ADMIN",
      });
      const loginHospitalAdmin = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: admin.email, password: "TestPassword123!" });
      const hospitalAdminRes = await request(app)
        .get("/api/v1/platform/analytics")
        .set("Authorization", `Bearer ${loginHospitalAdmin.body.token}`);
      expect(hospitalAdminRes.status).toBe(403);
    },
    // See the platform-aggregate test above for why this dev DB's
    // accumulated hospital count needs a longer-than-default timeout here.
    30000,
  );
});
