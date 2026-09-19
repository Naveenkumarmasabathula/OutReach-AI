import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { pool } from "../../src/db/client.js";
import { redisConnection } from "../../src/queue/connection.js";
import { escalationTimeoutQueue, eventsQueue, maintenanceQueue, outreachQueue } from "../../src/queue/queues.js";
import { auditLog, escalations, outreachAttempts, outreachTasks } from "../../src/db/schema/index.js";
import { mintHospitalScope, withHospitalScope } from "../../src/db/scope.js";
import { simulateCallOutcome } from "../../src/services/callSimulator.js";
import * as campaignService from "../../src/services/campaignService.js";
import * as encounterService from "../../src/services/encounterService.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as patientService from "../../src/services/patientService.js";
import * as protocolService from "../../src/services/protocolService.js";
import * as queueService from "../../src/services/queueService.js";
import { pickScenario, type SimulatedScenario } from "../../src/voice/simulatedVoiceProvider.js";

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

/** Deterministically finds an attempt number that both (a) lands in the callSimulator's "connected" bucket and (b) drives the SimulatedVoiceProvider into a specific scenario — so the test can assert a known, exact outcome instead of a random one. */
function findAttemptFor(taskId: string, targetScenario: SimulatedScenario): number {
  for (let n = 0; n < 5000; n++) {
    const connectivity = simulateCallOutcome(taskId, n);
    if (connectivity !== "completed" && connectivity !== "escalated") continue;
    if (pickScenario(`${taskId}:${n}`) === targetScenario) return n;
  }
  throw new Error(`No attempt number found producing a connected "${targetScenario}" scenario for task ${taskId}`);
}

async function setUpConnectedTask(
  scope: ReturnType<typeof mintHospitalScope>,
  hospitalId: string,
  suffix: string,
  scenario: SimulatedScenario,
) {
  const patient = await patientService.createPatient(scope, {
    mrn: `AI-${suffix}`,
    firstName: "Ai",
    lastName: "Pipeline",
    preferredContactMethod: "phone",
    preferredLanguage: "en",
    communicationConsent: true,
  });
  const encounter = await encounterService.createEncounter(scope, {
    patientId: patient.id,
    careSetting: "inpatient",
    dischargeDate: hoursAgo(5),
    followUpWindowHours: 72,
    riskLevel: 3,
  });
  const campaign = await campaignService.createCampaign(scope, {
    name: `AI Pipeline Campaign ${suffix}`,
    followUpWindowHours: 72,
    priority: 1,
    eligibilityCriteria: {},
  });
  await campaignService.markCampaignReady(scope, campaign.id);
  const started = await campaignService.startCampaign(scope, campaign.id);
  await queueService.enqueueEligiblePatients(scope, started);

  const claimed = await queueService.claimNextTasks(scope, `test-worker-${suffix}`);
  const task = claimed.find((t) => t.patientId === patient.id);
  if (!task) throw new Error("Expected the newly enqueued task to be claimable");

  const attemptNumber = findAttemptFor(task.id, scenario);
  const [patched] = await withHospitalScope(scope, (tx) =>
    tx.update(outreachTasks).set({ attemptCount: attemptNumber }).where(eq(outreachTasks.id, task.id)).returning(),
  );

  return { patient, encounter, campaign, hospitalId, task: patched! };
}

describe("Phase 5 AI agent pipeline (voice -> triage -> consensus -> documentation)", () => {
  const suffix = createId().slice(0, 8);
  let hospitalId: string;

  beforeAll(async () => {
    const hospital = await hospitalService.createHospital({
      name: `AI Pipeline Test Hospital ${suffix}`,
      slug: `ai-pipeline-test-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "00:00",
      callingHoursEnd: "23:59",
      outboundCapacity: 20,
      maxRetries: 2,
    });
    hospitalId = hospital.id;

    const scope = mintHospitalScope(hospitalId);
    await hospitalService.markHospitalReady(scope); // required for startCampaign below
    await protocolService.createProtocol(scope, {
      category: "follow_up_questions",
      title: "Standard follow-up question",
      tags: ["general"],
      content: "Have you noticed any new or worsening symptoms since discharge?",
      sourceReference: "Standard Post-Discharge Protocol v1",
    });
    await protocolService.createProtocol(scope, {
      category: "red_flag_indicator",
      title: "Cardiac and respiratory red flags",
      tags: ["cardiac"],
      content: "Chest pain or shortness of breath after discharge requires immediate escalation.",
      sourceReference: "Cardiology Post-Discharge Protocol v3",
    });
  });

  afterAll(async () => {
    await pool.end();
    // queueService (via events/publish.ts) creates a BullMQ Queue on a
    // shared ioredis connection at module load — closing it here is what
    // lets Jest actually exit instead of hanging on an open handle.
    await Promise.all([eventsQueue.close(), escalationTimeoutQueue.close(), outreachQueue.close(), maintenanceQueue.close()]);
    await redisConnection.quit();
  });

  it("routine scenario: completes with no escalation, and persists transcript/triage/documentation", async () => {
    const scope = mintHospitalScope(hospitalId);
    const { task } = await setUpConnectedTask(scope, hospitalId, `${suffix}-routine`, "routine");

    const result = await queueService.processTask(scope, task.id);
    expect(result.status).toBe("completed");

    const [attempt] = await withHospitalScope(scope, (tx) =>
      tx.select().from(outreachAttempts).where(eq(outreachAttempts.outreachTaskId, task.id)),
    );
    expect(attempt?.transcript).toBeTruthy();
    expect(attempt?.triageResult).toBeTruthy();
    expect(attempt?.consensusResult).toBeTruthy();
    expect(attempt?.documentationStatus).toBe("generated");
  });

  it("urgent scenario: both independent assessments agree, escalates at priority 1 with real clinical detail (not the old placeholder)", async () => {
    const scope = mintHospitalScope(hospitalId);
    const { task, patient } = await setUpConnectedTask(scope, hospitalId, `${suffix}-urgent`, "urgent");

    const result = await queueService.processTask(scope, task.id);
    expect(result.status).toBe("escalated");

    const escalationRows = await withHospitalScope(scope, (tx) =>
      tx.select().from(escalations).where(eq(escalations.patientId, patient.id)),
    );
    expect(escalationRows.length).toBeGreaterThan(0);
    const escalation = escalationRows[0]!;
    expect(escalation.priority).toBe(1);
    expect(escalation.trigger).not.toBe("queue_forced_escalation");
    expect(escalation.notes).not.toContain("Phase 3 call-outcome simulator placeholder");
  });

  it("records a patient.read audit row for the AI pipeline's own EHR access (the regulated-subject pattern)", async () => {
    const scope = mintHospitalScope(hospitalId);
    const { task, patient } = await setUpConnectedTask(scope, hospitalId, `${suffix}-audit`, "routine");

    await queueService.processTask(scope, task.id);

    const auditRows = await withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(eq(auditLog.resourceId, patient.id)),
    );
    expect(auditRows.some((row) => row.actorType === "ai_agent" && row.action === "patient.read")).toBe(true);
  });
});
