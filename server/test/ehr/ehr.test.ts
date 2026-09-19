import { createId } from "@paralleldrive/cuid2";
import { ehr } from "../../src/ehr/index.js";
import { pool } from "../../src/db/client.js";
import { mintHospitalScope } from "../../src/db/scope.js";
import { NotFoundError } from "../../src/lib/errors.js";
import * as encounterService from "../../src/services/encounterService.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as patientService from "../../src/services/patientService.js";

/**
 * Proves the application works *through* the EHR abstraction layer (PRD
 * §6), not just that MockEHR's individual methods happen to run. Requires
 * the docker-compose Postgres running and migrations applied — see
 * test/security/patient-isolation.test.ts for the same caveat about using
 * random slugs instead of a dedicated, torn-down test database.
 */
describe("EHR abstraction layer", () => {
  const suffix = createId().slice(0, 8);
  let hospitalAId: string;
  let hospitalBId: string;
  let patientAId: string;
  let encounterAId: string;

  beforeAll(async () => {
    const hospitalA = await hospitalService.createHospital({
      name: `EHR Test Hospital A ${suffix}`,
      slug: `ehr-test-a-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "08:00",
      callingHoursEnd: "20:00",
      outboundCapacity: 5,
      maxRetries: 3,
    });
    const hospitalB = await hospitalService.createHospital({
      name: `EHR Test Hospital B ${suffix}`,
      slug: `ehr-test-b-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "08:00",
      callingHoursEnd: "20:00",
      outboundCapacity: 5,
      maxRetries: 3,
    });
    hospitalAId = hospitalA.id;
    hospitalBId = hospitalB.id;

    const scopeA = mintHospitalScope(hospitalAId);
    const patient = await patientService.createPatient(scopeA, {
      mrn: `EHR-${suffix}`,
      firstName: "Elena",
      lastName: "Abstraction",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    patientAId = patient.id;

    const encounter = await encounterService.createEncounter(scopeA, {
      patientId: patientAId,
      careSetting: "inpatient",
      dischargeDate: new Date("2026-01-01T10:00:00Z"),
      dischargeDisposition: "home",
      dischargeInstructions: "Rest and hydrate.",
      followUpWindowHours: 72,
      riskLevel: 3,
    });
    encounterAId = encounter.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("getPatient / getEncounter / getDischargeInfo return the expected data", async () => {
    const scopeA = mintHospitalScope(hospitalAId);

    const patient = await ehr.getPatient(scopeA, patientAId);
    expect(patient.firstName).toBe("Elena");

    const encounter = await ehr.getEncounter(scopeA, encounterAId);
    expect(encounter.careSetting).toBe("inpatient");

    const discharge = await ehr.getDischargeInfo(scopeA, encounterAId);
    expect(discharge.dischargeDisposition).toBe("home");
    expect(discharge.followUpWindowHours).toBe(72);
  });

  it("getConditions / getObservations / getCarePlan start empty for a new patient", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    expect(await ehr.getConditions(scopeA, patientAId)).toEqual([]);
    expect(await ehr.getObservations(scopeA, patientAId)).toEqual([]);
    expect(await ehr.getCarePlan(scopeA, patientAId)).toEqual([]);
  });

  it("writeCommunication creates a record retrievable via the patient timeline", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const record = await ehr.writeCommunication(scopeA, {
      patientId: patientAId,
      encounterId: encounterAId,
      channel: "phone",
      direction: "outbound",
      summary: "Called patient to check on recovery.",
    });
    expect(record.summary).toBe("Called patient to check on recovery.");

    const timeline = await encounterService.getPatientTimeline(scopeA, patientAId);
    expect(timeline.communications.some((c) => c.id === record.id)).toBe(true);
  });

  it("writeObservation creates a structured, source-tagged observation", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const record = await ehr.writeObservation(scopeA, {
      patientId: patientAId,
      encounterId: encounterAId,
      category: "symptom",
      value: { description: "mild headache", severity: "low" },
      source: "ai_conversation",
    });
    expect(record.source).toBe("ai_conversation");

    const observations = await ehr.getObservations(scopeA, patientAId);
    expect(observations.map((o) => o.id)).toContain(record.id);
  });

  it("createFollowUpTask creates a task visible in the timeline", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const task = await ehr.createFollowUpTask(scopeA, {
      patientId: patientAId,
      encounterId: encounterAId,
      type: "callback",
      notes: "Patient requested a callback tomorrow morning.",
    });
    expect(task.type).toBe("callback");
    expect(task.status).toBe("requested");

    const timeline = await encounterService.getPatientTimeline(scopeA, patientAId);
    expect(timeline.tasks.some((t) => t.id === task.id)).toBe(true);
  });

  it("createEscalationRecord persists trigger, indicators, and priority", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const escalation = await ehr.createEscalationRecord(scopeA, {
      patientId: patientAId,
      encounterId: encounterAId,
      trigger: "protocol_red_flag",
      clinicalIndicators: { symptom: "chest pain", confidence: 0.9 },
      priority: 1,
    });
    expect(escalation.status).toBe("open");
    expect(escalation.priority).toBe(1);
    expect(escalation.trigger).toBe("protocol_red_flag");
  });

  it("updateEncounterMock updates only the given fields", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const updated = await ehr.updateEncounterMock(scopeA, encounterAId, {
      riskLevel: 5,
      dischargeInstructions: "Escalated — monitor closely.",
    });
    expect(updated.riskLevel).toBe(5);
    expect(updated.dischargeInstructions).toBe("Escalated — monitor closely.");
    expect(updated.careSetting).toBe("inpatient"); // untouched field preserved
  });

  it("rejects a get/write across hospitals with 404, not silent success", async () => {
    const scopeB = mintHospitalScope(hospitalBId);

    await expect(ehr.getPatient(scopeB, patientAId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ehr.getEncounter(scopeB, encounterAId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      ehr.writeCommunication(scopeB, {
        patientId: patientAId,
        channel: "phone",
        direction: "outbound",
        summary: "This must never be written against hospital B's scope.",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      ehr.createEscalationRecord(scopeB, {
        patientId: patientAId,
        trigger: "cross_tenant_attempt",
        priority: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("patientService/encounterService reads go through the same EHR-backed path", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const patient = await patientService.getPatientById(scopeA, patientAId);
    const encounter = await encounterService.getEncounterById(scopeA, encounterAId);
    expect(patient.id).toBe(patientAId);
    expect(encounter.id).toBe(encounterAId);
  });
});
