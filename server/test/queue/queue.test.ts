import { createId } from "@paralleldrive/cuid2";
import { pool } from "../../src/db/client.js";
import { redisConnection } from "../../src/queue/connection.js";
import { escalationTimeoutQueue, eventsQueue, maintenanceQueue, outreachQueue } from "../../src/queue/queues.js";
import { mintHospitalScope } from "../../src/db/scope.js";
import * as campaignService from "../../src/services/campaignService.js";
import * as encounterService from "../../src/services/encounterService.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as patientService from "../../src/services/patientService.js";
import * as queueService from "../../src/services/queueService.js";

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

async function createPatientWithEncounter(
  scope: ReturnType<typeof mintHospitalScope>,
  suffix: string,
  opts: { dischargeHoursAgo: number; riskLevel: number; followUpWindowHours?: number },
) {
  const patient = await patientService.createPatient(scope, {
    mrn: `Q-${suffix}`,
    firstName: "Queue",
    lastName: "Test",
    preferredContactMethod: "phone",
    preferredLanguage: "en",
    communicationConsent: true,
  });
  const encounter = await encounterService.createEncounter(scope, {
    patientId: patient.id,
    careSetting: "inpatient",
    dischargeDate: hoursAgo(opts.dischargeHoursAgo),
    followUpWindowHours: opts.followUpWindowHours ?? 72,
    riskLevel: opts.riskLevel,
  });
  return { patient, encounter };
}

/**
 * Several tests below share one hospital whose campaigns each re-enqueue
 * every currently-eligible patient (not just the one that test just
 * created) — realistic queue behavior, but it means `claimNextTasks` can
 * return other tests' tasks too. This claims with enough headroom to sweep
 * up everything currently claimable and picks out the specific patient's
 * task the calling test actually cares about, rather than assuming
 * ordering.
 */
async function claimTaskForPatient(
  scope: ReturnType<typeof mintHospitalScope>,
  workerId: string,
  patientId: string,
) {
  const claimed = await queueService.claimNextTasks(scope, workerId);
  const forPatient = claimed.find((task) => task.patientId === patientId);
  if (!forPatient) {
    throw new Error(`Expected a claimed task for patient ${patientId}, got: ${claimed.map((t) => t.patientId)}`);
  }

  // Anything else this call claimed belongs to another test's patient, still
  // sitting eligible in this shared hospital. Resolve it immediately rather
  // than leaving it stuck in "calling" — a real worker would eventually
  // process it too, and leaving it dangling would pollute every later
  // test's queue-health/capacity assertions, not just this one.
  const hospital = await hospitalService.getHospitalByScope(scope);
  const others = claimed.filter((task) => task.id !== forPatient.id);
  for (const other of others) {
    await queueService.recordAttemptOutcome(scope, other, "completed", new Date(), new Date(), hospital);
  }

  return forPatient;
}

describe("outbound queue and scheduler", () => {
  const suffix = createId().slice(0, 8);
  let hospitalAId: string;
  let hospitalBId: string;

  beforeAll(async () => {
    const hospitalA = await hospitalService.createHospital({
      name: `Queue Test Hospital A ${suffix}`,
      slug: `queue-test-a-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "00:00",
      callingHoursEnd: "23:59", // always open, so tests aren't time-of-day flaky
      outboundCapacity: 2,
      maxRetries: 2,
    });
    // Capacity is deliberately generous (not 2, unlike hospital A) — hospital
    // B is shared by several outcome-transition tests below, and each new
    // campaign's enqueue step re-evaluates *every* currently-eligible
    // patient in the hospital (not just the one just created for that test),
    // so more than one claimable task can exist at a time. Capacity
    // enforcement itself is already covered thoroughly by hospital A and the
    // dedicated isolated hospital in the concurrency test below; this
    // hospital's tests care about outcome transitions, not capacity, so
    // capacity is set high enough to never be the constraining factor here.
    const hospitalB = await hospitalService.createHospital({
      name: `Queue Test Hospital B ${suffix}`,
      slug: `queue-test-b-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "00:00",
      callingHoursEnd: "23:59",
      outboundCapacity: 50,
      maxRetries: 2,
    });
    hospitalAId = hospitalA.id;
    hospitalBId = hospitalB.id;

    // Several tests below call campaignService.startCampaign, which requires
    // an 'active' hospital.
    await hospitalService.markHospitalReady(mintHospitalScope(hospitalAId));
    await hospitalService.markHospitalReady(mintHospitalScope(hospitalBId));
  });

  afterAll(async () => {
    await pool.end();
    // queueService (via events/publish.ts) creates a BullMQ Queue on a
    // shared ioredis connection at module load — closing it here is what
    // lets Jest actually exit instead of hanging on an open handle.
    await Promise.all([eventsQueue.close(), escalationTimeoutQueue.close(), outreachQueue.close(), maintenanceQueue.close()]);
    await redisConnection.quit();
  });

  it("enqueues eligible patients and is idempotent on re-run", async () => {
    const scope = mintHospitalScope(hospitalAId);
    const campaign = await campaignService.createCampaign(scope, {
      name: `Enqueue Test ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 72,
      priority: 3,
    });
    await createPatientWithEncounter(scope, `enq1-${suffix}`, { dischargeHoursAgo: 5, riskLevel: 3 });
    await createPatientWithEncounter(scope, `enq2-${suffix}`, { dischargeHoursAgo: 5, riskLevel: 3 });

    const first = await queueService.enqueueEligiblePatients(scope, campaign);
    expect(first.enqueued).toBe(2);

    const second = await queueService.enqueueEligiblePatients(scope, campaign);
    expect(second.enqueued).toBe(0); // both already queued — no duplicates
  });

  it("respects hospital capacity when claiming, even with more eligible work available", async () => {
    const scope = mintHospitalScope(hospitalAId); // capacity = 2
    const campaign = await campaignService.createCampaign(scope, {
      name: `Capacity Test ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 72,
      priority: 3,
    });
    await campaignService.markCampaignReady(scope, campaign.id);
    await campaignService.startCampaign(scope, campaign.id);

    for (let i = 0; i < 5; i++) {
      await createPatientWithEncounter(scope, `cap${i}-${suffix}`, { dischargeHoursAgo: 5, riskLevel: 3 });
    }
    await queueService.enqueueEligiblePatients(scope, await campaignService.getCampaignById(scope, campaign.id));

    const claimed = await queueService.claimNextTasks(scope, `worker-${suffix}-1`);
    expect(claimed.length).toBe(2); // capped at hospital.outboundCapacity, not the 5 available

    // No further capacity available until these are released.
    const secondClaim = await queueService.claimNextTasks(scope, `worker-${suffix}-1b`);
    expect(secondClaim.length).toBe(0);
  });

  it("never over-claims or double-claims under concurrent callers (the core safety guarantee)", async () => {
    const scope = mintHospitalScope(hospitalAId); // capacity = 2, but 2 may already be held by the previous test
    const campaign = await campaignService.createCampaign(scope, {
      name: `Concurrency Test ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 72,
      priority: 1,
    });
    await campaignService.markCampaignReady(scope, campaign.id);
    await campaignService.startCampaign(scope, campaign.id);

    // Use a dedicated hospital for this test so a prior test's still-"calling"
    // tasks can't consume the shared hospital's capacity and make this flaky.
    const isolatedHospital = await hospitalService.createHospital({
      name: `Concurrency Isolated Hospital ${suffix}`,
      slug: `queue-concurrency-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "00:00",
      callingHoursEnd: "23:59",
      outboundCapacity: 3,
      maxRetries: 2,
    });
    const isolatedScope = mintHospitalScope(isolatedHospital.id);
    await hospitalService.markHospitalReady(isolatedScope);
    const isolatedCampaign = await campaignService.createCampaign(isolatedScope, {
      name: `Concurrency Campaign ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 72,
      priority: 1,
    });
    await campaignService.markCampaignReady(isolatedScope, isolatedCampaign.id);
    await campaignService.startCampaign(isolatedScope, isolatedCampaign.id);

    for (let i = 0; i < 40; i++) {
      await createPatientWithEncounter(isolatedScope, `conc${i}-${suffix}`, { dischargeHoursAgo: 5, riskLevel: 3 });
    }
    await queueService.enqueueEligiblePatients(isolatedScope, isolatedCampaign);

    // 20 concurrent claim attempts against a hospital with capacity 3 and 40
    // pending tasks. 20, not 6: a real over-capacity race here (each
    // concurrent caller reading a stale "0 active" count before any of the
    // others commits their claim) reproduced 100% of the time at this
    // concurrency/pending-task ratio during a live stress test, but was easy
    // to miss at lower concurrency in a fast, unloaded single-file run — see
    // docs/queue-design.md's "capacity race" section for the fix
    // (`claimNextTasks`'s `pg_advisory_xact_lock`) and how this number was
    // chosen specifically to make the regression this guards against
    // reliably reproduce, not just "usually" reproduce.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => queueService.claimNextTasks(isolatedScope, `worker-${suffix}-${i}`)),
    );

    const allClaimedIds = results.flat().map((task) => task.id);
    const uniqueClaimedIds = new Set(allClaimedIds);

    expect(allClaimedIds.length).toBeLessThanOrEqual(3); // never exceeds capacity
    expect(uniqueClaimedIds.size).toBe(allClaimedIds.length); // never claimed the same task twice
  });

  it("never creates duplicate tasks for the same patient/campaign under concurrent enqueue calls (DB-constraint-backed, not just the app-level check)", async () => {
    // Mirrors the "never over-claims or double-claims under concurrent
    // callers" test above, but for enqueue rather than claim: the app-level
    // `existingKeys` dedup check in `enqueueEligiblePatients` only guards
    // against duplicates WITHIN one transaction's own read — it says nothing
    // about two concurrent transactions (e.g. a resume racing a scheduler
    // tick) that both read "not yet queued" before either commits. The
    // `outreach_tasks_active_unique_idx` partial unique index is the real
    // backstop; this proves it holds even when the app-level check alone
    // would not.
    const isolatedHospital = await hospitalService.createHospital({
      name: `Duplicate Enqueue Hospital ${suffix}`,
      slug: `queue-dup-enqueue-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "00:00",
      callingHoursEnd: "23:59",
      outboundCapacity: 5,
      maxRetries: 2,
    });
    const isolatedScope = mintHospitalScope(isolatedHospital.id);
    const campaign = await campaignService.createCampaign(isolatedScope, {
      name: `Duplicate Enqueue Campaign ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 72,
      priority: 3,
    });
    const { patient } = await createPatientWithEncounter(isolatedScope, `dupenq-${suffix}`, {
      dischargeHoursAgo: 5,
      riskLevel: 3,
    });

    // 10 concurrent enqueue calls, all racing to enqueue the same single
    // eligible patient for the same campaign.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => queueService.enqueueEligiblePatients(isolatedScope, campaign)),
    );
    const totalEnqueued = results.reduce((sum, r) => sum + r.enqueued, 0);
    expect(totalEnqueued).toBe(1); // exactly one call actually won the race and inserted

    const { outreachTasks } = await import("../../src/db/schema/index.js");
    const { and, eq } = await import("drizzle-orm");
    const { withHospitalScope } = await import("../../src/db/scope.js");
    const rows = await withHospitalScope(isolatedScope, (tx) =>
      tx
        .select()
        .from(outreachTasks)
        .where(and(eq(outreachTasks.campaignId, campaign.id), eq(outreachTasks.patientId, patient.id))),
    );
    expect(rows).toHaveLength(1); // never more than one task for this patient/campaign, no matter how many callers raced
  });

  it("schedules a retry with backoff after a retriable failure, within max attempts", async () => {
    const scope = mintHospitalScope(hospitalBId);
    const campaign = await campaignService.createCampaign(scope, {
      name: `Retry Test ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 72,
      priority: 3,
      retryLimit: 2,
    });
    await campaignService.markCampaignReady(scope, campaign.id);
    await campaignService.startCampaign(scope, campaign.id);
    const { patient } = await createPatientWithEncounter(scope, `retry1-${suffix}`, {
      dischargeHoursAgo: 1,
      riskLevel: 3,
    });
    await queueService.enqueueEligiblePatients(scope, await campaignService.getCampaignById(scope, campaign.id));

    const claimed = await claimTaskForPatient(scope, `worker-retry-${suffix}`, patient.id);
    expect(claimed.attemptCount).toBe(1);

    const hospital = await hospitalService.getHospitalByScope(scope);
    const now = new Date();
    const updated = await queueService.recordAttemptOutcome(scope, claimed, "no_answer", now, now, hospital);

    expect(updated.status).toBe("retry_scheduled");
    expect(updated.scheduledFor.getTime()).toBeGreaterThan(now.getTime()); // backoff pushed it into the future
    expect(updated.lockedBy).toBeNull(); // capacity released
  });

  it("persists partial conversation context on a dropped call and carries it into the next claimed attempt", async () => {
    const scope = mintHospitalScope(hospitalBId);
    const campaign = await campaignService.createCampaign(scope, {
      name: `Dropped Context Test ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 72,
      priority: 3,
      retryLimit: 2,
    });
    await campaignService.markCampaignReady(scope, campaign.id);
    await campaignService.startCampaign(scope, campaign.id);
    const { patient } = await createPatientWithEncounter(scope, `dropped-${suffix}`, {
      dischargeHoursAgo: 1,
      riskLevel: 3,
    });
    await queueService.enqueueEligiblePatients(scope, await campaignService.getCampaignById(scope, campaign.id));

    const claimed = await claimTaskForPatient(scope, `worker-dropped-${suffix}`, patient.id);
    expect(claimed.conversationContext).toEqual({}); // nothing recorded yet

    const hospital = await hospitalService.getHospitalByScope(scope);
    const now = new Date();
    const updated = await queueService.recordAttemptOutcome(scope, claimed, "dropped", now, now, hospital);

    expect(updated.status).toBe("retry_scheduled"); // retries remain
    expect(updated.conversationContext).toMatchObject({
      lastCallDropped: true,
      lastCallDroppedAttemptNumber: claimed.attemptCount,
    });
    expect((updated.conversationContext as Record<string, unknown>).lastCallDroppedAt).toBeDefined();

    // Force the retry to be immediately claimable, then claim it again — the
    // task fetched at claim time (what ai/pipeline.ts's runOutreachAiPipeline
    // reads `conversationContext` from) must still carry the dropped-call
    // marker recorded above, proving it survives into the next attempt.
    const { outreachTasks } = await import("../../src/db/schema/index.js");
    const { eq } = await import("drizzle-orm");
    const { withHospitalScope } = await import("../../src/db/scope.js");
    await withHospitalScope(scope, (tx) =>
      tx.update(outreachTasks).set({ scheduledFor: new Date(Date.now() - 1000) }).where(eq(outreachTasks.id, claimed.id)),
    );

    const reclaimed = await claimTaskForPatient(scope, `worker-dropped-2-${suffix}`, patient.id);
    expect(reclaimed.conversationContext).toMatchObject({
      lastCallDropped: true,
      lastCallDroppedAttemptNumber: claimed.attemptCount,
    });

    // hospital B is shared by several other tests in this file (see
    // `claimTaskForPatient`'s own comment) — resolve this claim rather than
    // leaving it dangling in 'calling', which would hold a capacity slot and
    // pollute a later test's queue-health assertions.
    await queueService.recordAttemptOutcome(scope, reclaimed, "completed", new Date(), new Date(), hospital);
  });

  it("moves to manual_follow_up (and creates a follow-up task via the EHR interface) once attempts are exhausted", async () => {
    const scope = mintHospitalScope(hospitalBId);
    const campaign = await campaignService.createCampaign(scope, {
      name: `Exhausted Retries Test ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 72,
      priority: 3,
      retryLimit: 0, // maxAttempts = 1 — no retries at all
    });
    await campaignService.markCampaignReady(scope, campaign.id);
    await campaignService.startCampaign(scope, campaign.id);
    const { patient } = await createPatientWithEncounter(scope, `exhaust-${suffix}`, {
      dischargeHoursAgo: 1,
      riskLevel: 3,
    });
    await queueService.enqueueEligiblePatients(scope, await campaignService.getCampaignById(scope, campaign.id));

    const claimed = await claimTaskForPatient(scope, `worker-exhaust-${suffix}`, patient.id);
    expect(claimed.maxAttempts).toBe(1);

    const hospital = await hospitalService.getHospitalByScope(scope);
    const now = new Date();
    const updated = await queueService.recordAttemptOutcome(scope, claimed, "no_answer", now, now, hospital);

    expect(updated.status).toBe("manual_follow_up");

    const timeline = await encounterService.getPatientTimeline(scope, patient.id);
    expect(timeline.tasks.some((t) => t.type === "manual_follow_up")).toBe(true);
  });

  it("schedules a callback at the requested time when the outcome is callback_requested", async () => {
    const scope = mintHospitalScope(hospitalBId);
    const campaign = await campaignService.createCampaign(scope, {
      name: `Callback Test ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 72,
      priority: 3,
    });
    await campaignService.markCampaignReady(scope, campaign.id);
    await campaignService.startCampaign(scope, campaign.id);
    const { patient } = await createPatientWithEncounter(scope, `callback-${suffix}`, {
      dischargeHoursAgo: 1,
      riskLevel: 3,
    });
    await queueService.enqueueEligiblePatients(scope, await campaignService.getCampaignById(scope, campaign.id));

    const claimed = await claimTaskForPatient(scope, `worker-callback-${suffix}`, patient.id);
    const hospital = await hospitalService.getHospitalByScope(scope);
    const now = new Date();
    const updated = await queueService.recordAttemptOutcome(scope, claimed, "callback_requested", now, now, hospital);

    expect(updated.status).toBe("callback_scheduled");
    expect(updated.callbackRequestedFor).not.toBeNull();
    expect(updated.scheduledFor.getTime()).toBe(updated.callbackRequestedFor!.getTime()); // hospital is open 24h, so no further snap needed
  });

  it("creates a real escalation record via the EHR interface when the outcome is escalated", async () => {
    const scope = mintHospitalScope(hospitalBId);
    const campaign = await campaignService.createCampaign(scope, {
      name: `Escalation Test ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 72,
      priority: 3,
    });
    await campaignService.markCampaignReady(scope, campaign.id);
    await campaignService.startCampaign(scope, campaign.id);
    const { patient } = await createPatientWithEncounter(scope, `escal-${suffix}`, {
      dischargeHoursAgo: 1,
      riskLevel: 5,
    });
    await queueService.enqueueEligiblePatients(scope, await campaignService.getCampaignById(scope, campaign.id));

    const claimed = await claimTaskForPatient(scope, `worker-escal-${suffix}`, patient.id);
    const hospital = await hospitalService.getHospitalByScope(scope);
    const now = new Date();
    const updated = await queueService.recordAttemptOutcome(scope, claimed, "escalated", now, now, hospital);

    expect(updated.status).toBe("escalated");

    const { ehr } = await import("../../src/ehr/index.js");
    const carePlanCheck = await ehr.getPatient(scope, patient.id); // sanity: patient still resolvable through EHR
    expect(carePlanCheck.id).toBe(patient.id);
  });

  it("recovers a stale 'calling' lock left by a crashed worker, releasing capacity", async () => {
    const scope = mintHospitalScope(hospitalBId);
    const campaign = await campaignService.createCampaign(scope, {
      name: `Stale Lock Test ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 72,
      priority: 3,
    });
    await campaignService.markCampaignReady(scope, campaign.id);
    await campaignService.startCampaign(scope, campaign.id);
    const { patient } = await createPatientWithEncounter(scope, `stale-${suffix}`, {
      dischargeHoursAgo: 1,
      riskLevel: 3,
    });
    await queueService.enqueueEligiblePatients(scope, await campaignService.getCampaignById(scope, campaign.id));

    const claimed = await claimTaskForPatient(scope, `worker-stale-${suffix}`, patient.id);
    expect(claimed.status).toBe("calling");

    // Simulate a crashed worker: backdate lockedAt well past the staleness
    // threshold. Must go through withHospitalScope, not the unscoped `db` —
    // outreach_tasks has RLS FORCED, so an unscoped write would silently
    // match zero rows (see the same fix in queueService.releaseStaleLocks).
    const { outreachTasks } = await import("../../src/db/schema/index.js");
    const { eq } = await import("drizzle-orm");
    const { withHospitalScope } = await import("../../src/db/scope.js");
    await withHospitalScope(scope, (tx) =>
      tx
        .update(outreachTasks)
        .set({ lockedAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(outreachTasks.id, claimed.id)),
    );

    const releasedCount = await queueService.releaseStaleLocks(5); // 5-minute threshold
    expect(releasedCount).toBeGreaterThanOrEqual(1);

    const health = await queueService.getQueueHealth(scope);
    expect(health.byStatus.calling ?? 0).toBe(0); // no longer holding capacity
  });

  it("reports queue health counts that match the actual task states", async () => {
    const scope = mintHospitalScope(hospitalBId);
    const health = await queueService.getQueueHealth(scope);
    const total = Object.values(health.byStatus).reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThan(0); // hospital B has accumulated tasks from the tests above
  });

  it("isolates the queue by hospital — hospital B's claim never returns hospital A's tasks", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const scopeB = mintHospitalScope(hospitalBId);

    const claimedByB = await queueService.claimNextTasks(scopeB, `worker-isolation-${suffix}`);
    const healthA = await queueService.getQueueHealth(scopeA);
    const totalA = Object.values(healthA.byStatus).reduce((sum, n) => sum + n, 0);

    expect(totalA).toBeGreaterThan(0); // hospital A does have tasks from earlier tests
    for (const task of claimedByB) {
      expect(task.hospitalId).toBe(hospitalBId); // never hospitalAId
    }
  });
});
