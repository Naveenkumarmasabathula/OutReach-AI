import { jest } from "@jest/globals";
import { createId } from "@paralleldrive/cuid2";
import { pool } from "../../src/db/client.js";
import { mintHospitalScope } from "../../src/db/scope.js";
import { ehr } from "../../src/ehr/index.js";
import { publishEvent } from "../../src/events/publish.js";
import { redisConnection } from "../../src/queue/connection.js";
import { escalationTimeoutQueue, eventsQueue, maintenanceQueue, outreachQueue } from "../../src/queue/queues.js";
import * as escalationService from "../../src/services/escalationService.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as patientService from "../../src/services/patientService.js";
import * as userService from "../../src/services/userService.js";

/**
 * Fix #4 (reliability audit): `correlationId` threaded into BullMQ job data
 * (queue/queues.ts) so a job's processing can be traced back to whatever
 * produced it — a real HTTP request where one exists (escalation
 * acknowledge/resolve), or a freshly generated id where it doesn't
 * (publishEvent's own fallback, matching every scheduled-tick-originated
 * job in worker.ts).
 */
describe("correlation ID threading into BullMQ job data (Fix #4)", () => {
  const suffix = createId().slice(0, 8);
  let hospitalId: string;

  beforeAll(async () => {
    const hospital = await hospitalService.createHospital({
      name: `Correlation Id Test Hospital ${suffix}`,
      slug: `correlation-id-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "08:00",
      callingHoursEnd: "20:00",
      outboundCapacity: 5,
      maxRetries: 2,
    });
    hospitalId = hospital.id;
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

  it("publishEvent generates a fresh correlationId on the job data when the caller doesn't supply one", async () => {
    const addSpy = jest.spyOn(eventsQueue, "add");
    try {
      const scope = mintHospitalScope(hospitalId);
      await publishEvent(scope, "campaign.created", { campaignId: `fresh-${suffix}` });

      const lastCall = addSpy.mock.calls.at(-1)!;
      const jobData = lastCall[1] as { correlationId?: string };
      expect(typeof jobData.correlationId).toBe("string");
      expect(jobData.correlationId!.length).toBeGreaterThan(0);
    } finally {
      addSpy.mockRestore();
    }
  });

  it("publishEvent threads a caller-supplied correlationId onto the job data unchanged", async () => {
    const addSpy = jest.spyOn(eventsQueue, "add");
    try {
      const scope = mintHospitalScope(hospitalId);
      await publishEvent(scope, "campaign.created", { campaignId: `threaded-${suffix}` }, "caller-supplied-id-123");

      const lastCall = addSpy.mock.calls.at(-1)!;
      const jobData = lastCall[1] as { correlationId?: string };
      expect(jobData.correlationId).toBe("caller-supplied-id-123");
    } finally {
      addSpy.mockRestore();
    }
  });

  it("escalationService.acknowledgeEscalation threads its correlationId end-to-end onto the escalation.acknowledged event's job data — the real HTTP-request -> worker-log path routes/escalations.ts wires", async () => {
    const scope = mintHospitalScope(hospitalId);
    const patient = await patientService.createPatient(scope, {
      mrn: `CORR-${suffix}`,
      firstName: "Cora",
      lastName: "Lation",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    const escalation = await ehr.createEscalationRecord(scope, {
      patientId: patient.id,
      trigger: "test_trigger",
      priority: 2,
    });
    const reviewer = await userService.createHospitalUser(scope, {
      email: `correlation-reviewer-${suffix}@test.dev`,
      password: "TestPassword123!",
      name: "Correlation Reviewer",
      role: "CLINICAL_REVIEWER",
    });

    const addSpy = jest.spyOn(eventsQueue, "add");
    try {
      await escalationService.acknowledgeEscalation(scope, escalation.id, reviewer.id, "http-req-id-abc");

      const eventCall = addSpy.mock.calls.find((call) => {
        const data = call[1] as { correlationId?: string };
        return data.correlationId === "http-req-id-abc";
      });
      expect(eventCall).toBeDefined();
    } finally {
      addSpy.mockRestore();
    }
  });
});
