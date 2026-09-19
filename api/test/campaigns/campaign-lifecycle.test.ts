import { createId } from "@paralleldrive/cuid2";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { pool } from "../../src/db/client.js";
import { redisConnection } from "../../src/queue/connection.js";
import { escalationTimeoutQueue, eventsQueue, maintenanceQueue, outreachQueue } from "../../src/queue/queues.js";
import { mintHospitalScope } from "../../src/db/scope.js";
import { ConflictError, NotFoundError, ValidationError } from "../../src/lib/errors.js";
import * as campaignService from "../../src/services/campaignService.js";
import * as encounterService from "../../src/services/encounterService.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as patientService from "../../src/services/patientService.js";
import * as userService from "../../src/services/userService.js";

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

describe("campaign lifecycle and eligibility", () => {
  const suffix = createId().slice(0, 8);
  let hospitalAId: string;
  let hospitalBId: string;

  beforeAll(async () => {
    const hospitalA = await hospitalService.createHospital({
      name: `Campaign Test Hospital A ${suffix}`,
      slug: `campaign-test-a-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "09:00",
      callingHoursEnd: "18:00",
      outboundCapacity: 5,
      maxRetries: 2,
    });
    const hospitalB = await hospitalService.createHospital({
      name: `Campaign Test Hospital B ${suffix}`,
      slug: `campaign-test-b-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "08:00",
      callingHoursEnd: "20:00",
      outboundCapacity: 5,
      maxRetries: 2,
    });
    hospitalAId = hospitalA.id;
    hospitalBId = hospitalB.id;

    // Most tests below start a campaign, which requires the hospital itself
    // to be 'active' (see "hospital lifecycle gates campaign start" below,
    // which exercises the draft case directly on its own hospital instead).
    await hospitalService.markHospitalReady(mintHospitalScope(hospitalAId));
  });

  afterAll(async () => {
    await pool.end();
    // campaignService (via events/publish.ts) creates a BullMQ Queue on a
    // shared ioredis connection at module load — closing it here is what
    // lets Jest actually exit instead of hanging on an open handle.
    await Promise.all([eventsQueue.close(), escalationTimeoutQueue.close(), outreachQueue.close(), maintenanceQueue.close()]);
    await redisConnection.quit();
  });

  it("computes a correct eligible-patient count and workload estimate", async () => {
    const scopeA = mintHospitalScope(hospitalAId);

    const eligiblePatient = await patientService.createPatient(scopeA, {
      mrn: `ELIG-${suffix}`,
      firstName: "Eligible",
      lastName: "Patient",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    await encounterService.createEncounter(scopeA, {
      patientId: eligiblePatient.id,
      careSetting: "inpatient",
      dischargeDate: hoursAgo(10), // well within a 72h window
      followUpWindowHours: 72,
      riskLevel: 3,
    });

    const staleDischargePatient = await patientService.createPatient(scopeA, {
      mrn: `STALE-${suffix}`,
      firstName: "Stale",
      lastName: "Discharge",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    await encounterService.createEncounter(scopeA, {
      patientId: staleDischargePatient.id,
      careSetting: "inpatient",
      dischargeDate: hoursAgo(200), // outside a 72h window
      followUpWindowHours: 72,
      riskLevel: 3,
    });

    const optedOutPatient = await patientService.createPatient(scopeA, {
      mrn: `OPTOUT-${suffix}`,
      firstName: "Opted",
      lastName: "Out",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: false,
    });
    await encounterService.createEncounter(scopeA, {
      patientId: optedOutPatient.id,
      careSetting: "inpatient",
      dischargeDate: hoursAgo(5),
      followUpWindowHours: 72,
      riskLevel: 3,
    });

    const campaign = await campaignService.createCampaign(scopeA, {
      name: `Eligibility Test Campaign ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 72,
      priority: 2,
    });

    const estimate = await campaignService.getCampaignWorkloadEstimate(scopeA, campaign.id);
    expect(estimate.eligiblePatientCount).toBe(1); // only the first patient
    expect(estimate.expectedAttempts).toBe(1 * (2 + 1)); // hospital maxRetries is 2 (campaign has no override)
  });

  it("walks the full lifecycle: draft -> ready -> running -> paused -> running -> completed", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const campaign = await campaignService.createCampaign(scopeA, {
      name: `Lifecycle Campaign ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 48,
      priority: 3,
      callingHoursStart: "10:00", // narrower than hospital's 09:00-18:00 — allowed
      callingHoursEnd: "17:00",
    });
    expect(campaign.status).toBe("draft");

    const ready = await campaignService.markCampaignReady(scopeA, campaign.id);
    expect(ready.status).toBe("ready");

    const started = await campaignService.startCampaign(scopeA, campaign.id);
    expect(started.status).toBe("running"); // no startDate set -> starts immediately

    const paused = await campaignService.pauseCampaign(scopeA, campaign.id);
    expect(paused.status).toBe("paused");

    const resumed = await campaignService.resumeCampaign(scopeA, campaign.id);
    expect(resumed.campaign.status).toBe("running");
    expect(typeof resumed.eligiblePatientCount).toBe("number"); // recalculated, not carried over

    const completed = await campaignService.completeCampaign(scopeA, campaign.id);
    expect(completed.status).toBe("completed");
  });

  it("hospital lifecycle gates campaign start: a draft hospital's ready campaign cannot be started, but an active one's can", async () => {
    const draftHospital = await hospitalService.createHospital({
      name: `Draft Gate Hospital ${suffix}`,
      slug: `draft-gate-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "08:00",
      callingHoursEnd: "20:00",
      outboundCapacity: 5,
      maxRetries: 2,
    });
    expect(draftHospital.status).toBe("draft"); // default, not yet marked ready
    const draftScope = mintHospitalScope(draftHospital.id);

    const campaign = await campaignService.createCampaign(draftScope, {
      name: `Draft Hospital Campaign ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 48,
      priority: 3,
    });
    const ready = await campaignService.markCampaignReady(draftScope, campaign.id);
    expect(ready.status).toBe("ready"); // campaign-level setup is unaffected by hospital status

    // The hospital itself is still 'draft' — starting must be refused even
    // though the campaign is fully 'ready'.
    await expect(campaignService.startCampaign(draftScope, campaign.id)).rejects.toBeInstanceOf(ConflictError);

    // Marking the hospital ready flips it to 'active' and the same start
    // call now succeeds.
    const activated = await hospitalService.markHospitalReady(draftScope);
    expect(activated.status).toBe("active");
    const started = await campaignService.startCampaign(draftScope, campaign.id);
    expect(started.status).toBe("running");
  });

  it("rejects invalid lifecycle transitions instead of silently allowing them", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const campaign = await campaignService.createCampaign(scopeA, {
      name: `Invalid Transition Campaign ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 48,
      priority: 3,
    });

    await expect(campaignService.pauseCampaign(scopeA, campaign.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(campaignService.resumeCampaign(scopeA, campaign.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(campaignService.completeCampaign(scopeA, campaign.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(campaignService.startCampaign(scopeA, campaign.id)).rejects.toBeInstanceOf(ConflictError); // still draft, not ready
  });

  it("rejects marking ready when calling hours would widen the hospital's envelope", async () => {
    const scopeA = mintHospitalScope(hospitalAId); // hospital A calling hours: 09:00-18:00
    const campaign = await campaignService.createCampaign(scopeA, {
      name: `Envelope Violation Campaign ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 48,
      priority: 3,
      callingHoursStart: "07:00", // earlier than the hospital's 09:00 — widening, not narrowing
    });

    await expect(campaignService.markCampaignReady(scopeA, campaign.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows cancelling from draft, and rejects further transitions on a cancelled campaign", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const campaign = await campaignService.createCampaign(scopeA, {
      name: `Cancel Test Campaign ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 48,
      priority: 3,
    });

    const cancelled = await campaignService.cancelCampaign(scopeA, campaign.id);
    expect(cancelled.status).toBe("cancelled");

    await expect(campaignService.markCampaignReady(scopeA, campaign.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(campaignService.reprioritizeCampaign(scopeA, campaign.id, 1)).rejects.toBeInstanceOf(ConflictError);
  });

  it("isolates campaigns by hospital — hospital B cannot read or act on hospital A's campaign", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const scopeB = mintHospitalScope(hospitalBId);

    const campaign = await campaignService.createCampaign(scopeA, {
      name: `Isolation Test Campaign ${suffix}`,
      eligibilityCriteria: {},
      followUpWindowHours: 48,
      priority: 3,
    });

    await expect(campaignService.getCampaignById(scopeB, campaign.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(campaignService.markCampaignReady(scopeB, campaign.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(campaignService.getCampaignWorkloadEstimate(scopeB, campaign.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const listB = await campaignService.listCampaigns(scopeB, { page: 1, limit: 100 });
    expect(listB.find((c) => c.id === campaign.id)).toBeUndefined();
  });

  it("enforces campaign RBAC and tenant isolation over HTTP end-to-end", async () => {
    const app = createApp();
    const scopeA = mintHospitalScope(hospitalAId);
    const scopeB = mintHospitalScope(hospitalBId);

    const adminA = await userService.createHospitalUser(scopeA, {
      email: `campaign-admin-a-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Campaign Admin A",
      role: "HOSPITAL_ADMIN",
    });
    const adminB = await userService.createHospitalUser(scopeB, {
      email: `campaign-admin-b-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Campaign Admin B",
      role: "HOSPITAL_ADMIN",
    });

    const loginA = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: adminA.email, password: "TestPassword123!" });
    const loginB = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: adminB.email, password: "TestPassword123!" });
    const tokenA = loginA.body.token;
    const tokenB = loginB.body.token;

    const createRes = await request(app)
      .post("/api/v1/campaigns")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: `HTTP Campaign ${suffix}`, followUpWindowHours: 48, priority: 3 });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.body.id;

    const readAsA = await request(app)
      .get(`/api/v1/campaigns/${campaignId}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(readAsA.status).toBe(200);

    const readAsB = await request(app)
      .get(`/api/v1/campaigns/${campaignId}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(readAsB.status).toBe(404);

    const noAuth = await request(app).get(`/api/v1/campaigns/${campaignId}`);
    expect(noAuth.status).toBe(401);
  });
});
