import { createId } from "@paralleldrive/cuid2";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { pool } from "../../src/db/client.js";
import { mintHospitalScope } from "../../src/db/scope.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as userService from "../../src/services/userService.js";

describe("API validation (central ZodError -> 400 handling, PRD §24/§26)", () => {
  const suffix = createId().slice(0, 8);
  let hospitalId: string;
  let token: string;

  beforeAll(async () => {
    const hospital = await hospitalService.createHospital({
      name: `Validation Test Hospital ${suffix}`,
      slug: `validation-test-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "09:00",
      callingHoursEnd: "18:00",
      outboundCapacity: 5,
      maxRetries: 2,
    });
    hospitalId = hospital.id;
    const scope = mintHospitalScope(hospitalId);
    const admin = await userService.createHospitalUser(scope, {
      email: `validation-admin-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Validation Admin",
      role: "HOSPITAL_ADMIN",
    });
    const app = createApp();
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: admin.email, password: "TestPassword123!" });
    token = login.body.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("rejects a campaign create request missing required fields with 400 and Zod validation details", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/campaigns")
      .set("Authorization", `Bearer ${token}`)
      .send({}); // missing required "name"
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details).toBeDefined();
  });

  it("rejects a wrong-type field (priority as a string) with 400", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/campaigns")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bad Priority Campaign", followUpWindowHours: 72, priority: "urgent" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an out-of-range enum-like value (protocol category) with 400", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/protocols")
      .set("Authorization", `Bearer ${token}`)
      .send({
        category: "not_a_real_category",
        title: "Bad Protocol",
        content: "x",
        sourceReference: "x",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an invalid email format on login with 400 (validated before authService.login ever runs)", async () => {
    const app = createApp();
    const res = await request(app).post("/api/v1/auth/login").send({ email: "not-an-email", password: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("still accepts a well-formed request after all the malformed ones above (the validator isn't stuck in a bad state)", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/campaigns")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: `Valid Campaign ${suffix}`, followUpWindowHours: 72, priority: 3, eligibilityCriteria: {} });
    expect(res.status).toBe(201);
  });
});
