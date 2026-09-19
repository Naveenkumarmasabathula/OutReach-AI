import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { pool } from "../../src/db/client.js";
import { communications, escalations, observations, tasks } from "../../src/db/schema/index.js";
import { mintHospitalScope, withHospitalScope } from "../../src/db/scope.js";
import { ehr } from "../../src/ehr/index.js";
import * as encounterService from "../../src/services/encounterService.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as patientService from "../../src/services/patientService.js";

/**
 * Fix #2 (reliability audit): a duplicated call (e.g. a retried BullMQ job
 * after a worker crash, or a redelivered event) must not create a second
 * row when it supplies the same `idempotencyKey` — proves the
 * check-then-insert + DB unique-constraint mechanism in mockEhr.ts actually
 * dedupes, and that omitting the key (every pre-existing caller) still
 * behaves exactly like a plain insert.
 */
describe("EHR write idempotency (Fix #2)", () => {
  const suffix = createId().slice(0, 8);
  let hospitalId: string;
  let patientId: string;
  let encounterId: string;

  beforeAll(async () => {
    const hospital = await hospitalService.createHospital({
      name: `EHR Idempotency Test Hospital ${suffix}`,
      slug: `ehr-idempotency-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "08:00",
      callingHoursEnd: "20:00",
      outboundCapacity: 5,
      maxRetries: 3,
    });
    hospitalId = hospital.id;
    const scope = mintHospitalScope(hospitalId);

    const patient = await patientService.createPatient(scope, {
      mrn: `IDEM-${suffix}`,
      firstName: "Iris",
      lastName: "Dempotent",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    patientId = patient.id;

    const encounter = await encounterService.createEncounter(scope, {
      patientId,
      careSetting: "inpatient",
      dischargeDate: new Date("2026-01-01T10:00:00Z"),
      dischargeDisposition: "home",
      dischargeInstructions: "Rest.",
      followUpWindowHours: 72,
      riskLevel: 2,
    });
    encounterId = encounter.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("writeCommunication: a duplicated call with the same idempotencyKey returns the original row, not a new one", async () => {
    const scope = mintHospitalScope(hospitalId);
    const idempotencyKey = `outreach-task-${suffix}-communication`;

    const first = await ehr.writeCommunication(scope, {
      patientId,
      encounterId,
      channel: "phone",
      direction: "outbound",
      summary: "First attempt at logging this call.",
      idempotencyKey,
    });
    const second = await ehr.writeCommunication(scope, {
      patientId,
      encounterId,
      channel: "phone",
      direction: "outbound",
      summary: "Retried job — same logical write.",
      idempotencyKey,
    });

    expect(second.id).toBe(first.id);
    expect(second.summary).toBe(first.summary); // the original row, not overwritten by the retry's content

    const rows = await withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(communications)
        .where(and(eq(communications.hospitalId, hospitalId), eq(communications.idempotencyKey, idempotencyKey))),
    );
    expect(rows).toHaveLength(1);
  });

  it("writeCommunication: two calls with NO idempotencyKey (the pre-existing/default path) still create two separate rows", async () => {
    const scope = mintHospitalScope(hospitalId);
    const first = await ehr.writeCommunication(scope, {
      patientId,
      encounterId,
      channel: "sms",
      direction: "outbound",
      summary: "No dedup key — call 1.",
    });
    const second = await ehr.writeCommunication(scope, {
      patientId,
      encounterId,
      channel: "sms",
      direction: "outbound",
      summary: "No dedup key — call 2.",
    });
    expect(second.id).not.toBe(first.id);
  });

  it("writeObservation: a duplicated call with the same idempotencyKey doesn't create a duplicate row", async () => {
    const scope = mintHospitalScope(hospitalId);
    const idempotencyKey = `outreach-task-${suffix}-observation`;

    const first = await ehr.writeObservation(scope, {
      patientId,
      encounterId,
      category: "symptom",
      value: { description: "mild headache" },
      source: "ai_conversation",
      idempotencyKey,
    });
    const second = await ehr.writeObservation(scope, {
      patientId,
      encounterId,
      category: "symptom",
      value: { description: "DIFFERENT retried payload" },
      source: "ai_conversation",
      idempotencyKey,
    });
    expect(second.id).toBe(first.id);

    const rows = await withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(observations)
        .where(and(eq(observations.hospitalId, hospitalId), eq(observations.idempotencyKey, idempotencyKey))),
    );
    expect(rows).toHaveLength(1);
  });

  it("createFollowUpTask: a duplicated call with the same idempotencyKey doesn't create a duplicate row", async () => {
    const scope = mintHospitalScope(hospitalId);
    const idempotencyKey = `outreach-task-${suffix}-followup`;

    const first = await ehr.createFollowUpTask(scope, {
      patientId,
      encounterId,
      type: "manual_follow_up",
      notes: "Exhausted attempts.",
      idempotencyKey,
    });
    const second = await ehr.createFollowUpTask(scope, {
      patientId,
      encounterId,
      type: "manual_follow_up",
      notes: "Retried — should not duplicate.",
      idempotencyKey,
    });
    expect(second.id).toBe(first.id);

    const rows = await withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.hospitalId, hospitalId), eq(tasks.idempotencyKey, idempotencyKey))),
    );
    expect(rows).toHaveLength(1);
  });

  it("createEscalationRecord: a duplicated call with the same idempotencyKey doesn't create a duplicate row", async () => {
    const scope = mintHospitalScope(hospitalId);
    const idempotencyKey = `outreach-task-${suffix}-escalation`;

    const first = await ehr.createEscalationRecord(scope, {
      patientId,
      encounterId,
      trigger: "protocol_red_flag",
      priority: 1,
      idempotencyKey,
    });
    const second = await ehr.createEscalationRecord(scope, {
      patientId,
      encounterId,
      trigger: "protocol_red_flag",
      priority: 1,
      idempotencyKey,
    });
    expect(second.id).toBe(first.id);

    const rows = await withHospitalScope(scope, (tx) =>
      tx
        .select()
        .from(escalations)
        .where(and(eq(escalations.hospitalId, hospitalId), eq(escalations.idempotencyKey, idempotencyKey))),
    );
    expect(rows).toHaveLength(1);
  });

  it("the same idempotencyKey is independent per hospital (unique index is scoped by hospital_id, not global)", async () => {
    const otherHospital = await hospitalService.createHospital({
      name: `EHR Idempotency Test Hospital B ${suffix}`,
      slug: `ehr-idempotency-b-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "08:00",
      callingHoursEnd: "20:00",
      outboundCapacity: 5,
      maxRetries: 3,
    });
    const otherScope = mintHospitalScope(otherHospital.id);
    const otherPatient = await patientService.createPatient(otherScope, {
      mrn: `IDEM-B-${suffix}`,
      firstName: "Other",
      lastName: "Hospital",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });

    const sharedKey = `shared-key-${suffix}`;
    const scopeA = mintHospitalScope(hospitalId);
    const inA = await ehr.writeCommunication(scopeA, {
      patientId,
      channel: "phone",
      direction: "outbound",
      summary: "Hospital A's write under a shared-looking key.",
      idempotencyKey: sharedKey,
    });
    const inB = await ehr.writeCommunication(otherScope, {
      patientId: otherPatient.id,
      channel: "phone",
      direction: "outbound",
      summary: "Hospital B's write under the same key string.",
      idempotencyKey: sharedKey,
    });
    expect(inA.id).not.toBe(inB.id); // distinct rows — the unique index is (hospital_id, idempotency_key)
  });
});
