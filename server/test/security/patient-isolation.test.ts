import { createId } from "@paralleldrive/cuid2";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { pool } from "../../src/db/client.js";
import { mintHospitalScope } from "../../src/db/scope.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as patientService from "../../src/services/patientService.js";
import * as userService from "../../src/services/userService.js";

/**
 * Requires the docker-compose Postgres to be running (`docker compose up -d`)
 * and migrations applied (`npm run db:migrate --workspace server`) — this is a
 * real integration test against the tenant-isolation code path, not a mock.
 *
 * Known limitation: uses random slugs/emails per run instead of a dedicated,
 * torn-down test database — acceptable for the prototype, but a real test DB
 * with truncation between runs is the Phase 11 follow-up (see
 * docs/multi-tenancy.md §1's "completeness check" recommendation).
 */
describe("patient tenant isolation", () => {
  const app = createApp();
  const suffix = createId().slice(0, 8);

  let hospitalAToken: string;
  let hospitalBToken: string;
  let hospitalAPatientId: string;

  beforeAll(async () => {
    const hospitalA = await hospitalService.createHospital({
      name: `Isolation Test Hospital A ${suffix}`,
      slug: `iso-test-a-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "08:00",
      callingHoursEnd: "20:00",
      outboundCapacity: 5,
      maxRetries: 3,
    });
    const hospitalB = await hospitalService.createHospital({
      name: `Isolation Test Hospital B ${suffix}`,
      slug: `iso-test-b-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "08:00",
      callingHoursEnd: "20:00",
      outboundCapacity: 5,
      maxRetries: 3,
    });

    const scopeA = mintHospitalScope(hospitalA.id);
    const scopeB = mintHospitalScope(hospitalB.id);

    const adminA = await userService.createHospitalUser(scopeA, {
      email: `admin-a-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Hospital A Admin",
      role: "HOSPITAL_ADMIN",
    });
    const adminB = await userService.createHospitalUser(scopeB, {
      email: `admin-b-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Hospital B Admin",
      role: "HOSPITAL_ADMIN",
    });

    const patient = await patientService.createPatient(scopeA, {
      mrn: `ISO-${suffix}`,
      firstName: "Alice",
      lastName: "Isolation",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    hospitalAPatientId = patient.id;

    const loginA = await request(app).post("/api/v1/auth/login").send({
      email: adminA.email,
      password: "TestPassword123!",
    });
    const loginB = await request(app).post("/api/v1/auth/login").send({
      email: adminB.email,
      password: "TestPassword123!",
    });
    hospitalAToken = loginA.body.token;
    hospitalBToken = loginB.body.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("lets hospital A read its own patient", async () => {
    const res = await request(app)
      .get(`/api/v1/patients/${hospitalAPatientId}`)
      .set("Authorization", `Bearer ${hospitalAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(hospitalAPatientId);
  });

  it("returns 404 (not 403) when hospital B requests hospital A's patient", async () => {
    const res = await request(app)
      .get(`/api/v1/patients/${hospitalAPatientId}`)
      .set("Authorization", `Bearer ${hospitalBToken}`);
    expect(res.status).toBe(404);
  });

  it("never includes hospital A's patient in hospital B's patient list", async () => {
    const res = await request(app)
      .get("/api/v1/patients")
      .set("Authorization", `Bearer ${hospitalBToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.find((p: { id: string }) => p.id === hospitalAPatientId)).toBeUndefined();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get(`/api/v1/patients/${hospitalAPatientId}`);
    expect(res.status).toBe(401);
  });
});
