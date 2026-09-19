import { createId } from "@paralleldrive/cuid2";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { pool } from "../../src/db/client.js";
import { mintHospitalScope } from "../../src/db/scope.js";
import { getSystemHealth } from "../../src/lib/systemHealth.js";
import { escalationTimeoutQueue, eventsQueue, maintenanceQueue, outreachQueue } from "../../src/queue/queues.js";
import { redisConnection } from "../../src/queue/connection.js";
import * as campaignService from "../../src/services/campaignService.js";
import * as encounterService from "../../src/services/encounterService.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as patientService from "../../src/services/patientService.js";
import * as queueService from "../../src/services/queueService.js";

/**
 * Fix #3 (reliability audit): the PRD §21 queue-health fields
 * (active calls, capacity, pending work, oldest task, cutoff-risk tasks,
 * failed tasks, stuck workers) rolled up platform-wide onto the
 * unauthenticated `GET /health`, reusing `queueService.getQueueHealth`
 * rather than reimplementing it — see `lib/systemHealth.ts`'s
 * `getAggregateQueueHealth`.
 *
 * This is a genuinely shared dev database (other test files/hospitals run
 * concurrently), so assertions here are deltas/lower-bounds against a
 * captured "before" snapshot, not exact absolute counts.
 */
describe("platform-wide queue health rollup on GET /health", () => {
  const suffix = createId().slice(0, 8);
  const outboundCapacity = 7;
  let hospitalId: string;

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

  it("exposes queue.capacity, queue.pendingWork, and queue.activeCalls that reflect a newly-created active hospital's tasks, without leaking patient/hospital identifiers", async () => {
    const before = await getSystemHealth();
    expect(before.queue).not.toBeNull();
    const capacityBefore = before.queue!.capacity;
    const pendingBefore = before.queue!.pendingWork;
    const activeCallsBefore = before.queue!.activeCalls;

    const hospital = await hospitalService.createHospital({
      name: `Queue Health Rollup Test Hospital ${suffix}`,
      slug: `queue-health-rollup-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "00:00",
      callingHoursEnd: "23:59",
      outboundCapacity,
      maxRetries: 2,
    });
    hospitalId = hospital.id;
    const scope = mintHospitalScope(hospitalId);
    await hospitalService.markHospitalReady(scope);

    const campaign = await campaignService.createCampaign(scope, {
      name: `Queue Health Rollup Campaign ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 72,
      priority: 3,
    });
    await campaignService.markCampaignReady(scope, campaign.id);
    await campaignService.startCampaign(scope, campaign.id);

    const patient = await patientService.createPatient(scope, {
      mrn: `QHR-${suffix}`,
      firstName: "Queue",
      lastName: "HealthRollup",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    await encounterService.createEncounter(scope, {
      patientId: patient.id,
      careSetting: "inpatient",
      dischargeDate: new Date(Date.now() - 60 * 60 * 1000),
      followUpWindowHours: 72,
      riskLevel: 3,
    });

    await queueService.enqueueEligiblePatients(scope, await campaignService.getCampaignById(scope, campaign.id));

    const after = await getSystemHealth();
    expect(after.queue).not.toBeNull();
    // Total platform capacity now includes this new active hospital's own.
    expect(after.queue!.capacity).toBeGreaterThanOrEqual(capacityBefore + outboundCapacity);
    // At least the one task just enqueued is now counted as pending work.
    expect(after.queue!.pendingWork).toBeGreaterThanOrEqual(pendingBefore + 1);
    // Nothing has been claimed yet, so activeCalls hasn't moved because of this hospital.
    expect(after.queue!.activeCalls).toBeGreaterThanOrEqual(activeCallsBefore);

    // No per-patient or per-hospital identifying data anywhere in the object
    // — only aggregate counts/timestamps (Fix #3's "don't leak PHI/hospital
    // identity into an unauthenticated endpoint" requirement).
    const serialized = JSON.stringify(after.queue);
    expect(serialized).not.toContain(hospitalId);
    expect(serialized).not.toContain(patient.id);
    expect(serialized).not.toContain("Queue"); // patient/hospital name fragments
  });

  it("GET /health includes the same queue rollup in its JSON body", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.queue).toEqual(
      expect.objectContaining({
        activeCalls: expect.any(Number),
        capacity: expect.any(Number),
        pendingWork: expect.any(Number),
        tasksNearCutoff: expect.any(Number),
        failedTasks: expect.any(Number),
        stuckWorkers: expect.any(Number),
      }),
    );
    expect("oldestPendingScheduledFor" in res.body.queue).toBe(true);
  });
});
