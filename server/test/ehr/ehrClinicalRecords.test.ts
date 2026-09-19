import { createId } from "@paralleldrive/cuid2";
import { pool } from "../../src/db/client.js";
import { mintHospitalScope, withHospitalScope } from "../../src/db/scope.js";
import { medications, procedures } from "../../src/db/schema/index.js";
import { ehr } from "../../src/ehr/index.js";
import * as encounterService from "../../src/services/encounterService.js";
import * as hospitalService from "../../src/services/hospitalService.js";
import * as patientService from "../../src/services/patientService.js";

/**
 * Fix #7 (reliability audit): `medications`/`procedures` were dead schema —
 * real tables with no read path through the EHR interface. Proves
 * `getMedications`/`getProcedures` (mirroring `getConditions`/
 * `getObservations`'s exact pattern — see mockEhr.ts) actually work through
 * the full `ehr` singleton (circuit breaker + audit wrapping included).
 */
describe("EHR getMedications/getProcedures (Fix #7)", () => {
  const suffix = createId().slice(0, 8);
  let hospitalAId: string;
  let hospitalBId: string;
  let patientAId: string;

  beforeAll(async () => {
    const hospitalA = await hospitalService.createHospital({
      name: `Clinical Records Test Hospital A ${suffix}`,
      slug: `clinical-records-a-${suffix}`,
      timezone: "UTC",
      callingHoursStart: "08:00",
      callingHoursEnd: "20:00",
      outboundCapacity: 5,
      maxRetries: 3,
    });
    const hospitalB = await hospitalService.createHospital({
      name: `Clinical Records Test Hospital B ${suffix}`,
      slug: `clinical-records-b-${suffix}`,
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
      mrn: `CLIN-${suffix}`,
      firstName: "Clara",
      lastName: "Records",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    patientAId = patient.id;
    await encounterService.createEncounter(scopeA, {
      patientId: patientAId,
      careSetting: "inpatient",
      dischargeDate: new Date("2026-01-01T10:00:00Z"),
      dischargeDisposition: "home",
      dischargeInstructions: "Rest.",
      followUpWindowHours: 72,
      riskLevel: 2,
    });

    await withHospitalScope(scopeA, async (tx) => {
      await tx.insert(medications).values({
        hospitalId: hospitalAId,
        patientId: patientAId,
        name: "Lisinopril",
        dosage: "10mg",
        frequency: "once daily",
      });
      await tx.insert(procedures).values({
        hospitalId: hospitalAId,
        patientId: patientAId,
        name: "Appendectomy",
        performedAt: new Date("2025-12-28T00:00:00Z"),
      });
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("getMedications returns the seeded medication for the right patient", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const meds = await ehr.getMedications(scopeA, patientAId);
    expect(meds).toHaveLength(1);
    expect(meds[0]!.name).toBe("Lisinopril");
    expect(meds[0]!.dosage).toBe("10mg");
  });

  it("getProcedures returns the seeded procedure for the right patient", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const procs = await ehr.getProcedures(scopeA, patientAId);
    expect(procs).toHaveLength(1);
    expect(procs[0]!.name).toBe("Appendectomy");
  });

  it("getMedications/getProcedures 404 for a patient out of the calling hospital's scope", async () => {
    const scopeB = mintHospitalScope(hospitalBId);
    await expect(ehr.getMedications(scopeB, patientAId)).rejects.toThrow();
    await expect(ehr.getProcedures(scopeB, patientAId)).rejects.toThrow();
  });

  it("a patient with no medications/procedures gets empty arrays, not an error", async () => {
    const scopeA = mintHospitalScope(hospitalAId);
    const emptyPatient = await patientService.createPatient(scopeA, {
      mrn: `CLIN-EMPTY-${suffix}`,
      firstName: "Empty",
      lastName: "Records",
      preferredContactMethod: "phone",
      preferredLanguage: "en",
      communicationConsent: true,
    });
    expect(await ehr.getMedications(scopeA, emptyPatient.id)).toEqual([]);
    expect(await ehr.getProcedures(scopeA, emptyPatient.id)).toEqual([]);
  });
});
