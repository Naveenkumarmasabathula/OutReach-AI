import { evaluatePatientEligibility } from "../../src/services/eligibilityService.js";

const now = new Date("2026-01-10T12:00:00Z");

const baseCampaign = { followUpWindowHours: 72, eligibilityCriteria: {} };
const baseEncounter = {
  status: "discharged" as const,
  dischargeDate: new Date("2026-01-09T12:00:00Z"), // 24h before `now`
  riskLevel: 3,
  careSetting: "inpatient" as const,
};
const consentedPatient = { communicationConsent: true };

describe("evaluatePatientEligibility", () => {
  it("is eligible when discharged, consented, and within the follow-up window", () => {
    const result = evaluatePatientEligibility(baseCampaign, baseEncounter, consentedPatient, now);
    expect(result).toEqual({ eligible: true });
  });

  it("excludes an encounter that hasn't been discharged yet", () => {
    const result = evaluatePatientEligibility(
      baseCampaign,
      { ...baseEncounter, status: "in_progress" },
      consentedPatient,
      now,
    );
    expect(result).toEqual({ eligible: false, reason: "not_discharged" });
  });

  it("excludes a discharged encounter with no discharge date recorded", () => {
    const result = evaluatePatientEligibility(
      baseCampaign,
      { ...baseEncounter, dischargeDate: null },
      consentedPatient,
      now,
    );
    expect(result).toEqual({ eligible: false, reason: "no_discharge_date" });
  });

  it("excludes a patient who declined communication consent", () => {
    const result = evaluatePatientEligibility(baseCampaign, baseEncounter, { communicationConsent: false }, now);
    expect(result).toEqual({ eligible: false, reason: "consent_declined" });
  });

  it("excludes a patient discharged longer ago than the campaign's follow-up window", () => {
    const result = evaluatePatientEligibility(
      { followUpWindowHours: 12, eligibilityCriteria: {} }, // discharged 24h ago, window is only 12h
      baseEncounter,
      consentedPatient,
      now,
    );
    expect(result).toEqual({ eligible: false, reason: "outside_follow_up_window" });
  });

  it("excludes a discharge date in the future relative to `now` (clock skew / bad data)", () => {
    const result = evaluatePatientEligibility(
      baseCampaign,
      { ...baseEncounter, dischargeDate: new Date("2026-01-11T00:00:00Z") },
      consentedPatient,
      now,
    );
    expect(result).toEqual({ eligible: false, reason: "outside_follow_up_window" });
  });

  it("excludes a care setting not in the campaign's criteria", () => {
    const result = evaluatePatientEligibility(
      { ...baseCampaign, eligibilityCriteria: { careSettings: ["emergency"] } },
      baseEncounter,
      consentedPatient,
      now,
    );
    expect(result).toEqual({ eligible: false, reason: "care_setting_excluded" });
  });

  it("includes a care setting that IS in the campaign's criteria", () => {
    const result = evaluatePatientEligibility(
      { ...baseCampaign, eligibilityCriteria: { careSettings: ["inpatient", "emergency"] } },
      baseEncounter,
      consentedPatient,
      now,
    );
    expect(result).toEqual({ eligible: true });
  });

  it("excludes risk level below the campaign's minimum", () => {
    const result = evaluatePatientEligibility(
      { ...baseCampaign, eligibilityCriteria: { minRiskLevel: 4 } },
      baseEncounter, // riskLevel 3
      consentedPatient,
      now,
    );
    expect(result).toEqual({ eligible: false, reason: "risk_level_out_of_range" });
  });

  it("excludes risk level above the campaign's maximum", () => {
    const result = evaluatePatientEligibility(
      { ...baseCampaign, eligibilityCriteria: { maxRiskLevel: 2 } },
      baseEncounter, // riskLevel 3
      consentedPatient,
      now,
    );
    expect(result).toEqual({ eligible: false, reason: "risk_level_out_of_range" });
  });

  it("includes risk level within an explicit min/max range", () => {
    const result = evaluatePatientEligibility(
      { ...baseCampaign, eligibilityCriteria: { minRiskLevel: 1, maxRiskLevel: 5 } },
      baseEncounter,
      consentedPatient,
      now,
    );
    expect(result).toEqual({ eligible: true });
  });
});
