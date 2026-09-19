import { jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { aiProviderCircuitBreaker } from "../../src/ai/circuitBreaker.js";
import { db, pool } from "../../src/db/client.js";
import { redisConnection } from "../../src/queue/connection.js";
import { escalationTimeoutQueue, eventsQueue, maintenanceQueue, outreachQueue } from "../../src/queue/queues.js";
import { getSystemHealth } from "../../src/lib/systemHealth.js";

describe("system health (PRD §21 Healthy/Degraded/Unavailable states)", () => {
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

  afterEach(() => {
    aiProviderCircuitBreaker.recordSuccess(); // reset shared breaker state between tests
  });

  it("GET /health reports healthy (200) when the database, Redis, and AI provider are all fine", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(res.body.checks).toEqual({ database: "ok", redis: "ok", aiProvider: "ok" });
  });

  it("reports degraded (still 200) when the AI provider circuit breaker is open, without affecting database/redis checks", async () => {
    aiProviderCircuitBreaker.recordFailure();
    aiProviderCircuitBreaker.recordFailure();
    aiProviderCircuitBreaker.recordFailure();

    const health = await getSystemHealth();
    expect(health.status).toBe("degraded");
    expect(health.checks.aiProvider).toBe("degraded");
    expect(health.checks.database).toBe("ok");
    expect(health.checks.redis).toBe("ok");
  });

  it("reports unavailable when the database check fails, and GET /health maps that to a 503", async () => {
    const executeSpy = jest.spyOn(db, "execute").mockRejectedValueOnce(new Error("simulated database outage"));
    try {
      const health = await getSystemHealth();
      expect(health.status).toBe("unavailable");
      expect(health.checks.database).toBe("failed");
      expect(health.checks.redis).toBe("ok"); // unaffected — each dependency is checked independently
    } finally {
      executeSpy.mockRestore();
    }

    const executeSpyForRoute = jest.spyOn(db, "execute").mockRejectedValueOnce(new Error("simulated database outage"));
    try {
      const app = createApp();
      const res = await request(app).get("/health");
      expect(res.status).toBe(503);
      expect(res.body.status).toBe("unavailable");
    } finally {
      executeSpyForRoute.mockRestore();
    }
  });
});
