import { and, eq } from "drizzle-orm";
import type { Campaign, Encounter } from "../db/schema/index.js";
import { encounters, patients } from "../db/schema/index.js";
import type { HospitalScope } from "../db/scope.js";
import { withHospitalScope } from "../db/scope.js";

export type EligibilityCriteria = {
  careSettings?: string[];
  minRiskLevel?: number;
  maxRiskLevel?: number;
};

export type EligibleCandidate = {
  patientId: string;
  encounterId: string;
  dischargeDate: Date;
  riskLevel: number;
  careSetting: string;
  /** The encounter's own clinical follow-up window — used by the queue (Phase 3) to set clinicalDeadline. */
  followUpWindowHours: number;
};

export type IneligibilityReason =
  | "not_discharged"
  | "no_discharge_date"
  | "outside_follow_up_window"
  | "consent_declined"
  | "care_setting_excluded"
  | "risk_level_out_of_range";

export type EligibilityResult = { eligible: true } | { eligible: false; reason: IneligibilityReason };

type EncounterInput = {
  status: Encounter["status"];
  dischargeDate: Encounter["dischargeDate"];
  riskLevel: Encounter["riskLevel"];
  careSetting: Encounter["careSetting"];
};

/**
 * Pure function, deliberately: PRD §7 requires eligibility to be evaluated
 * "consistently and explainably." A plain, synchronous, unit-testable
 * function is the clearest way to satisfy that — no hidden state, every
 * exclusion has a named reason, and understanding the rule doesn't require
 * reading SQL.
 *
 * Deliberately NOT checked here (documented, not forgotten): "existing
 * outreach status" (PRD §7) — whether this patient already has a pending or
 * completed outreach attempt for this campaign. That requires the
 * campaign-scoped outreach-task entity Phase 3 introduces; this function
 * will be extended to take that as an input once it exists, not replaced.
 */
export function evaluatePatientEligibility(
  campaign: Pick<Campaign, "followUpWindowHours" | "eligibilityCriteria">,
  encounter: EncounterInput,
  patient: { communicationConsent: boolean },
  now: Date,
): EligibilityResult {
  if (encounter.status !== "discharged") return { eligible: false, reason: "not_discharged" };
  if (!encounter.dischargeDate) return { eligible: false, reason: "no_discharge_date" };
  if (!patient.communicationConsent) return { eligible: false, reason: "consent_declined" };

  const hoursSinceDischarge = (now.getTime() - encounter.dischargeDate.getTime()) / (1000 * 60 * 60);
  if (hoursSinceDischarge < 0 || hoursSinceDischarge > campaign.followUpWindowHours) {
    return { eligible: false, reason: "outside_follow_up_window" };
  }

  const criteria = (campaign.eligibilityCriteria ?? {}) as EligibilityCriteria;
  if (criteria.careSettings?.length && !criteria.careSettings.includes(encounter.careSetting)) {
    return { eligible: false, reason: "care_setting_excluded" };
  }
  if (criteria.minRiskLevel !== undefined && encounter.riskLevel < criteria.minRiskLevel) {
    return { eligible: false, reason: "risk_level_out_of_range" };
  }
  if (criteria.maxRiskLevel !== undefined && encounter.riskLevel > criteria.maxRiskLevel) {
    return { eligible: false, reason: "risk_level_out_of_range" };
  }

  return { eligible: true };
}

/**
 * Fetches every discharged encounter in scope and evaluates each against the
 * pure rule above. A patient with multiple discharges can appear more than
 * once — each discharge is its own outreach need. Dataset is small enough
 * (hundreds of rows per hospital) that filtering in application code rather
 * than SQL is the right tradeoff here for explainability.
 */
export async function evaluateEligiblePatients(
  scope: HospitalScope,
  campaign: Pick<Campaign, "followUpWindowHours" | "eligibilityCriteria">,
): Promise<EligibleCandidate[]> {
  const now = new Date();
  const candidates = await withHospitalScope(scope, (tx) =>
    tx
      .select({
        patientId: patients.id,
        communicationConsent: patients.communicationConsent,
        encounterId: encounters.id,
        status: encounters.status,
        dischargeDate: encounters.dischargeDate,
        riskLevel: encounters.riskLevel,
        careSetting: encounters.careSetting,
        followUpWindowHours: encounters.followUpWindowHours,
      })
      .from(encounters)
      .innerJoin(patients, eq(patients.id, encounters.patientId))
      .where(and(eq(encounters.hospitalId, scope.hospitalId), eq(encounters.status, "discharged"))),
  );

  const eligible: EligibleCandidate[] = [];
  for (const candidate of candidates) {
    const result = evaluatePatientEligibility(
      campaign,
      candidate,
      { communicationConsent: candidate.communicationConsent },
      now,
    );
    if (result.eligible && candidate.dischargeDate) {
      eligible.push({
        patientId: candidate.patientId,
        encounterId: candidate.encounterId,
        dischargeDate: candidate.dischargeDate,
        riskLevel: candidate.riskLevel,
        careSetting: candidate.careSetting,
        followUpWindowHours: candidate.followUpWindowHours,
      });
    }
  }
  return eligible;
}
