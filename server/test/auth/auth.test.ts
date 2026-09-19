import { createId } from "@paralleldrive/cuid2";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { env } from "../../src/config/env.js";
import { pool } from "../../src/db/client.js";
import { mintHospitalScope } from "../../src/db/scope.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as userService from "../../src/services/userService.js";

describe("authentication (PRD §1/§26 — login failure paths, not just the happy path)", () => {
  const suffix = createId().slice(0, 8);
  let hospitalId: string;
  let userEmail: string;

  beforeAll(async () => {
    const hospital = await hospitalService.createHospital({
      name: `Auth Test Hospital ${suffix}`,
      slug: `auth-test-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "09:00",
      callingHoursEnd: "18:00",
      outboundCapacity: 5,
      maxRetries: 2,
    });
    hospitalId = hospital.id;
    const scope = mintHospitalScope(hospitalId);
    const user = await userService.createHospitalUser(scope, {
      email: `auth-test-${suffix}@test.dev`,
      password: "CorrectPassword123!",
      name: "Auth Test User",
      role: "HOSPITAL_ADMIN",
    });
    userEmail = user.email;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("logs in successfully with correct credentials", async () => {
    const app = createApp();
    const res = await request(app).post("/api/v1/auth/login").send({ email: userEmail, password: "CorrectPassword123!" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(userEmail);
  });

  it("rejects a wrong password with 401 and never reveals whether the account exists", async () => {
    const app = createApp();
    const res = await request(app).post("/api/v1/auth/login").send({ email: userEmail, password: "WrongPassword!" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Invalid email or password");
  });

  it("rejects a nonexistent email with the same 401 and identical message as a wrong password", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: `nonexistent-${suffix}@test.dev`, password: "AnyPassword123!" });
    expect(res.status).toBe(401);
    // Same message as the wrong-password case (checked above) is the actual
    // safety property here — a different message per case would let a
    // caller enumerate which emails have accounts.
    expect(res.body.error.message).toBe("Invalid email or password");
  });

  it("rejects a request with no Authorization header at all", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/campaigns");
    expect(res.status).toBe(401);
  });

  it("rejects a malformed (garbage) bearer token", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/campaigns").set("Authorization", "Bearer not-a-real-jwt");
    expect(res.status).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const app = createApp();
    const forgedToken = jwt.sign({ sub: "someone", hospitalId, role: "HOSPITAL_ADMIN" }, "wrong-secret-entirely");
    const res = await request(app).get("/api/v1/campaigns").set("Authorization", `Bearer ${forgedToken}`);
    expect(res.status).toBe(401);
  });

  it("rejects an expired token even though it was signed with the real secret", async () => {
    const app = createApp();
    const expiredToken = jwt.sign({ sub: "someone", hospitalId, role: "HOSPITAL_ADMIN" }, env.JWT_SECRET, {
      expiresIn: "-1s", // already expired the instant it's issued
    });
    const res = await request(app).get("/api/v1/campaigns").set("Authorization", `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });
});
