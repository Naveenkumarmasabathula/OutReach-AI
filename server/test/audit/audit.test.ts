import { createId } from "@paralleldrive/cuid2";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { pool } from "../../src/db/client.js";
import { mintHospitalScope } from "../../src/db/scope.js";
import { redisConnection } from "../../src/queue/connection.js";
import { escalationTimeoutQueue, eventsQueue, maintenanceQueue, outreachQueue } from "../../src/queue/queues.js";
import * as auditService from "../../src/services/auditService.js";
import * as campaignService from "../../src/services/campaignService.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as userService from "../../src/services/userService.js";

describe("Phase 10 audit logging for important operations (PRD §21)", () => {
  const suffix = createId().slice(0, 8);
  let hospitalId: string;

  beforeAll(async () => {
    const hospital = await hospitalService.createHospital({
      name: `Audit Test Hospital ${suffix}`,
      slug: `audit-test-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "00:00",
      callingHoursEnd: "23:59",
      outboundCapacity: 5,
      maxRetries: 2,
    });
    hospitalId = hospital.id;
    await hospitalService.markHospitalReady(mintHospitalScope(hospitalId)); // required for campaign start below
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

  it("records a real audit entry naming the acting user when a campaign is created, started, and paused over HTTP", async () => {
    const app = createApp();
    const scope = mintHospitalScope(hospitalId);
    const admin = await userService.createHospitalUser(scope, {
      email: `audit-admin-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Audit Admin",
      role: "HOSPITAL_ADMIN",
    });
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: admin.email, password: "TestPassword123!" });
    const token = login.body.token;

    const createRes = await request(app)
      .post("/api/v1/campaigns")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: `Audit Campaign ${suffix}`, followUpWindowHours: 72, priority: 2, eligibilityCriteria: {} });
    expect(createRes.status).toBe(201);
    const campaignId = createRes.body.id;

    await request(app).post(`/api/v1/campaigns/${campaignId}/ready`).set("Authorization", `Bearer ${token}`);
    await request(app).post(`/api/v1/campaigns/${campaignId}/start`).set("Authorization", `Bearer ${token}`);
    await request(app).post(`/api/v1/campaigns/${campaignId}/pause`).set("Authorization", `Bearer ${token}`);

    const auditEntries = await auditService.listAuditLog(scope, { page: 1, limit: 50 }, { resourceType: "campaign" });
    const actions = auditEntries.filter((e) => e.resourceId === campaignId).map((e) => e.action);

    expect(actions).toContain("campaign.create");
    expect(actions).toContain("campaign.ready");
    expect(actions).toContain("campaign.start");
    expect(actions).toContain("campaign.pause");
    expect(auditEntries.every((e) => e.actorType === "user" && e.actorId === admin.id)).toBe(true);
  });

  it("audit entries are tenant-isolated — a different hospital never sees another hospital's audit trail", async () => {
    const hospitalB = await hospitalService.createHospital({
      name: `Audit Test Hospital B ${suffix}`,
      slug: `audit-test-b-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "00:00",
      callingHoursEnd: "23:59",
      outboundCapacity: 5,
      maxRetries: 2,
    });
    const scopeA = mintHospitalScope(hospitalId);
    const scopeB = mintHospitalScope(hospitalB.id);

    await campaignService.createCampaign(scopeA, {
      name: `Isolation Campaign ${suffix}`,
      followUpWindowHours: 72,
      priority: 2,
      eligibilityCriteria: {},
    });

    const entriesB = await auditService.listAuditLog(scopeB, { page: 1, limit: 100 });
    expect(entriesB.every((e) => e.hospitalId === hospitalB.id)).toBe(true);
  });

  it("enforces audit.read RBAC over HTTP: CAMPAIGN_MANAGER (no audit.read grant) gets 403, HOSPITAL_ADMIN gets 200", async () => {
    const app = createApp();
    const scope = mintHospitalScope(hospitalId);
    const manager = await userService.createHospitalUser(scope, {
      email: `audit-manager-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Audit Manager",
      role: "CAMPAIGN_MANAGER",
    });
    const admin = await userService.createHospitalUser(scope, {
      email: `audit-admin2-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Audit Admin 2",
      role: "HOSPITAL_ADMIN",
    });

    const loginManager = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: manager.email, password: "TestPassword123!" });
    const loginAdmin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: admin.email, password: "TestPassword123!" });

    const managerRes = await request(app)
      .get("/api/v1/audit-log")
      .set("Authorization", `Bearer ${loginManager.body.token}`);
    expect(managerRes.status).toBe(403);

    const adminRes = await request(app)
      .get("/api/v1/audit-log")
      .set("Authorization", `Bearer ${loginAdmin.body.token}`);
    expect(adminRes.status).toBe(200);
  });
});
