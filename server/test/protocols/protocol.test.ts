import { createId } from "@paralleldrive/cuid2";
import request from "supertest";
import { createApp } from "../../src/app.js";
import type { Protocol } from "../../src/db/schema/index.js";
import { pool } from "../../src/db/client.js";
import { mintHospitalScope } from "../../src/db/scope.js";
import { NotFoundError } from "../../src/lib/errors.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as protocolService from "../../src/services/protocolService.js";
import { rankProtocolsByRelevance, scoreProtocolRelevance } from "../../src/services/protocolRetrievalService.js";
import * as userService from "../../src/services/userService.js";

function makeProtocol(overrides: Partial<Protocol> = {}): Protocol {
  return {
    id: createId(),
    hospitalId: "hospital-1",
    category: "red_flag_indicator",
    title: "Cardiac red flags",
    tags: ["cardiac", "general"],
    content: "Watch for chest pain, shortness of breath, or palpitations.",
    sourceReference: "Cardiology Post-Discharge Protocol v3",
    version: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("protocol relevance scoring (pure)", () => {
  it("scores zero and is excluded when nothing in the query matches", () => {
    const protocol = makeProtocol();
    const scored = scoreProtocolRelevance(protocol, { keywords: "unrelated diabetes topic" });
    expect(scored.score).toBe(0);
  });

  it("weights a category match higher than a single tag or keyword match", () => {
    const protocol = makeProtocol();
    const categoryOnly = scoreProtocolRelevance(protocol, { category: "red_flag_indicator" });
    const tagOnly = scoreProtocolRelevance(protocol, { tags: ["cardiac"] });
    const keywordOnly = scoreProtocolRelevance(protocol, { keywords: "chest" });

    expect(categoryOnly.score).toBeGreaterThan(tagOnly.score);
    expect(tagOnly.score).toBeGreaterThan(keywordOnly.score);
  });

  it("is case-insensitive for tags and keywords", () => {
    const protocol = makeProtocol();
    const scored = scoreProtocolRelevance(protocol, { tags: ["CARDIAC"], keywords: "CHEST pain" });
    expect(scored.matchedOn).toContain("tag:CARDIAC");
    expect(scored.score).toBeGreaterThan(0);
  });

  it("ranks a task-specific query above an irrelevant one and respects the limit", () => {
    const cardiac = makeProtocol({ id: "p1", category: "red_flag_indicator", tags: ["cardiac"] });
    const diabetes = makeProtocol({
      id: "p2",
      category: "red_flag_indicator",
      tags: ["diabetes"],
      title: "Diabetes red flags",
      content: "Watch for hypoglycemia symptoms.",
    });
    const unrelatedGuidance = makeProtocol({
      id: "p3",
      category: "patient_guidance",
      tags: ["general"],
      title: "Wound care guidance",
      content: "Keep the incision site clean and dry.",
    });

    const ranked = rankProtocolsByRelevance(
      [diabetes, unrelatedGuidance, cardiac],
      { category: "red_flag_indicator", tags: ["cardiac"] },
      1,
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.protocol.id).toBe("p1");
  });

  it("never returns the whole library for an empty/non-matching query", () => {
    const protocols = [makeProtocol({ id: "a" }), makeProtocol({ id: "b", tags: ["diabetes"] })];
    const ranked = rankProtocolsByRelevance(protocols, {}, 10);
    expect(ranked).toHaveLength(0);
  });
});

describe("protocol CRUD, tenant isolation, and DB-backed retrieval", () => {
  const suffix = createId().slice(0, 8);
  let hospitalAId: string;
  let hospitalBId: string;

  beforeAll(async () => {
    const hospitalA = await hospitalService.createHospital({
      name: `Protocol Test Hospital A ${suffix}`,
      slug: `protocol-test-a-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "09:00",
      callingHoursEnd: "18:00",
      outboundCapacity: 5,
      maxRetries: 2,
    });
    const hospitalB = await hospitalService.createHospital({
      name: `Protocol Test Hospital B ${suffix}`,
      slug: `protocol-test-b-${suffix}`,
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
  });

  it("creates, lists, updates (bumping version), and deactivates a protocol", async () => {
    const scopeA = mintHospitalScope(hospitalAId);

    const created = await protocolService.createProtocol(scopeA, {
      category: "follow_up_questions",
      title: "Post-op follow-up questions",
      tags: ["surgical"],
      content: "Ask about pain level, mobility, and incision appearance.",
      sourceReference: "Surgical Follow-Up Protocol v1",
    });
    expect(created.version).toBe(1);
    expect(created.isActive).toBe(true);

    const updated = await protocolService.updateProtocol(scopeA, created.id, {
      content: "Ask about pain level, mobility, incision appearance, and fever.",
    });
    expect(updated.version).toBe(2);

    const list = await protocolService.listProtocols(scopeA, { page: 1, limit: 50 });
    expect(list.find((p) => p.id === created.id)?.version).toBe(2);

    const deactivated = await protocolService.deactivateProtocol(scopeA, created.id);
    expect(deactivated.isActive).toBe(false);

    const activeList = await protocolService.listProtocols(scopeA, { page: 1, limit: 50 });
    expect(activeList.find((p) => p.id === created.id)).toBeUndefined();

    const fullList = await protocolService.listProtocols(scopeA, { page: 1, limit: 50 }, { includeInactive: true });
    expect(fullList.find((p) => p.id === created.id)).toBeDefined();
  });

  it("enforces tenant isolation at the service layer (cross-hospital reads 404, never leak)", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const scopeB = mintHospitalScope(hospitalBId);

    const protocol = await protocolService.createProtocol(scopeA, {
      category: "escalation_contact",
      title: "On-call cardiology contact",
      tags: ["cardiac"],
      content: "Dr. Smith, +1-555-0100, available 24/7.",
      sourceReference: "Hospital A Escalation Directory",
    });

    await expect(protocolService.getProtocolById(scopeB, protocol.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      protocolService.updateProtocol(scopeB, protocol.id, { title: "Hijacked" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const listB = await protocolService.listProtocols(scopeB, { page: 1, limit: 100 });
    expect(listB.find((p) => p.id === protocol.id)).toBeUndefined();
  });

  it("retrieveRelevantProtocols only ever returns the caller's own hospital's active protocols", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const scopeB = mintHospitalScope(hospitalBId);

    await protocolService.createProtocol(scopeA, {
      category: "red_flag_indicator",
      title: "Hospital A cardiac red flags",
      tags: ["cardiac"],
      content: "Chest pain, shortness of breath.",
      sourceReference: "Hospital A Cardiology Protocol",
    });
    await protocolService.createProtocol(scopeB, {
      category: "red_flag_indicator",
      title: "Hospital B cardiac red flags",
      tags: ["cardiac"],
      content: "Chest pain, palpitations.",
      sourceReference: "Hospital B Cardiology Protocol",
    });

    const { retrieveRelevantProtocols } = await import("../../src/services/protocolRetrievalService.js");
    const resultsA = await retrieveRelevantProtocols(scopeA, { category: "red_flag_indicator", tags: ["cardiac"] });

    expect(resultsA.length).toBeGreaterThan(0);
    expect(resultsA.every((r) => r.protocol.hospitalId === hospitalAId)).toBe(true);
    expect(resultsA.some((r) => r.protocol.title === "Hospital B cardiac red flags")).toBe(false);
  });

  it("enforces protocol RBAC and tenant isolation over HTTP end-to-end", async () => {
    const app = createApp();
    const scopeA = mintHospitalScope(hospitalAId);
    const scopeB = mintHospitalScope(hospitalBId);

    const adminA = await userService.createHospitalUser(scopeA, {
      email: `protocol-admin-a-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Protocol Admin A",
      role: "HOSPITAL_ADMIN",
    });
    const managerA = await userService.createHospitalUser(scopeA, {
      email: `protocol-manager-a-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Campaign Manager A",
      role: "CAMPAIGN_MANAGER",
    });
    const adminB = await userService.createHospitalUser(scopeB, {
      email: `protocol-admin-b-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Protocol Admin B",
      role: "HOSPITAL_ADMIN",
    });

    const loginA = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: adminA.email, password: "TestPassword123!" });
    const loginManagerA = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: managerA.email, password: "TestPassword123!" });
    const loginB = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: adminB.email, password: "TestPassword123!" });
    const tokenA = loginA.body.token;
    const tokenManagerA = loginManagerA.body.token;
    const tokenB = loginB.body.token;

    const createRes = await request(app)
      .post("/api/v1/protocols")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        category: "operational_rule",
        title: `HTTP Protocol ${suffix}`,
        tags: ["general"],
        content: "Do not schedule calls after 8pm local time.",
        sourceReference: "Hospital A Operational Policy",
      });
    expect(createRes.status).toBe(201);
    const protocolId = createRes.body.id;

    // CAMPAIGN_MANAGER has protocol.read but not protocol.manage.
    const managerCreateRes = await request(app)
      .post("/api/v1/protocols")
      .set("Authorization", `Bearer ${tokenManagerA}`)
      .send({ category: "operational_rule", title: "Should be forbidden", content: "x", sourceReference: "x" });
    expect(managerCreateRes.status).toBe(403);

    const managerReadRes = await request(app)
      .get(`/api/v1/protocols/${protocolId}`)
      .set("Authorization", `Bearer ${tokenManagerA}`);
    expect(managerReadRes.status).toBe(200);

    const readAsB = await request(app)
      .get(`/api/v1/protocols/${protocolId}`)
      .set("Authorization", `Bearer ${tokenB}`);
    expect(readAsB.status).toBe(404);

    const searchRes = await request(app)
      .get("/api/v1/protocols/search")
      .query({ category: "operational_rule", keywords: "schedule calls" })
      .set("Authorization", `Bearer ${tokenA}`);
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.some((r: { protocol: { id: string } }) => r.protocol.id === protocolId)).toBe(true);

    const noAuth = await request(app).get(`/api/v1/protocols/${protocolId}`);
    expect(noAuth.status).toBe(401);
  });
});
