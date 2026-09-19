import { createId } from "@paralleldrive/cuid2";
import { pool } from "../../src/db/client.js";
import { mintHospitalScope } from "../../src/db/scope.js";
import { redisConnection } from "../../src/queue/connection.js";
import { escalationTimeoutQueue, eventsQueue, maintenanceQueue, outreachQueue } from "../../src/queue/queues.js";
import * as campaignService from "../../src/services/campaignService.js";
import * as encounterService from "../../src/services/encounterService.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as patientService from "../../src/services/patientService.js";
import * as queueService from "../../src/services/queueService.js";

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/**
 * The pure `computeTaskPriority` function is already unit-tested
 * (test/unit/priorityService.test.ts's "near-expiry beats high-priority-but-
 * fresh" case) — but that only proves the scoring FORMULA produces the right
 * number, not that `claimNextTasks`'s actual claim loop uses those scores to
 * order real claims. This is the integration-level version PRD §26's
 * "queue testing: prioritization" asks for.
 */
describe("queue priority ordering (integration — claimNextTasks respects computeTaskPriority, not just insertion order)", () => {
  const suffix = createId().slice(0, 8);
  let hospitalId: string;

  beforeAll(async () => {
    const hospital = await hospitalService.createHospital({
      name: `Priority Ordering Hospital ${suffix}`,
      slug: `priority-ordering-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "00:00",
      callingHoursEnd: "23:59",
      outboundCapacity: 1, // constrained to exactly 1 — forces a real choice between the two candidates
      maxRetries: 2,
    });
    hospitalId = hospital.id;
    await hospitalService.markHospitalReady(mintHospitalScope(hospitalId)); // required for startCampaign below
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

  it("claims the near-clinical-cutoff patient before a same-priority, same-risk patient with a fresh deadline, regardless of insertion order", async () => {
    const scope = mintHospitalScope(hospitalId);
    const campaign = await campaignService.createCampaign(scope, {
      name: `Priority Ordering Campaign ${suffix}`,
      followUpWindowHours: 72,
      priority: 3,
      eligibilityCriteria: {},
    });
    await campaignService.markCampaignReady(scope, campaign.id);
    await campaignService.startCampaign(scope, campaign.id);

    // Inserted in an order that would give the WRONG answer if claimNextTasks
    // just picked whatever came first: the fresh (low-urgency) patient first.
    const freshPatient = await patientService.createPatient(scope, {
      mrn: `FRESH-${suffix}`,
      firstName: "Fresh",
      lastName: "Deadline",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    await encounterService.createEncounter(scope, {
      patientId: freshPatient.id,
      careSetting: "inpatient",
      dischargeDate: hoursAgo(2), // 70 of 72 hours remaining — low urgency
      followUpWindowHours: 72,
      riskLevel: 3,
    });

    const nearCutoffPatient = await patientService.createPatient(scope, {
      mrn: `NEARCUTOFF-${suffix}`,
      firstName: "Near",
      lastName: "Cutoff",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    await encounterService.createEncounter(scope, {
      patientId: nearCutoffPatient.id,
      careSetting: "inpatient",
      dischargeDate: hoursAgo(70), // only 2 of 72 hours remaining — high urgency
      followUpWindowHours: 72,
      riskLevel: 3, // same risk level and same campaign — deadline pressure is the only differentiator
    });

    await queueService.enqueueEligiblePatients(scope, campaign);

    const claimed = await queueService.claimNextTasks(scope, `priority-ordering-worker-${suffix}`);

    expect(claimed).toHaveLength(1); // capacity is 1 — only the winner gets claimed
    expect(claimed[0]!.patientId).toBe(nearCutoffPatient.id);
  });
});
