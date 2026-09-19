import { consensusResultSchema, type ConsensusResult, type TriageClassification, type TriageResult } from "./types.js";

const SEVERITY_RANK: Record<TriageClassification, number> = { routine: 0, uncertain: 1, concerning: 2, urgent: 3 };
const SEVERITY_TO_PRIORITY: Record<TriageClassification, number | null> = {
  routine: null,
  uncertain: 3,
  concerning: 2,
  urgent: 1,
};

/**
 * PRD §14/§15, the single most safety-sensitive piece of the system: "must
 * not rely entirely on a single model response... use multiple independent
 * assessments... and compare results... disagreement is detected and
 * handled, not hidden... apply a conservative escalation strategy."
 *
 * Pure and synchronous, matching every other explainable-decision engine in
 * this codebase (eligibilityService, priorityService, protocolRetrievalService):
 * given the two already-computed assessments, this never re-derives them or
 * calls out to anything, which is what makes disagreement handling itself
 * independently testable.
 *
 * The conservative rule: consensus classification is whichever of the two
 * assessments is MORE severe, never an average or a majority-of-two
 * coin-flip — the exact PRD §14 example ("if one assessment classifies a
 * patient as routine while another identifies a protocol red flag, the
 * system must... apply a conservative escalation strategy") is a direct
 * instance of this rule, not a special case bolted on top of it. "Uncertain"
 * itself escalates (at low priority, for human review) per PRD §14 listing
 * "significant uncertainty" as its own escalation trigger — it is not a
 * lesser classification that gets rounded down to routine.
 */
export function decideEscalation(assessments: [TriageResult, TriageResult]): ConsensusResult {
  const [a, b] = assessments;
  const disagreement = a.classification !== b.classification;
  const consensusClassification =
    SEVERITY_RANK[a.classification] >= SEVERITY_RANK[b.classification] ? a.classification : b.classification;

  // Never let the consensus classification alone suppress an individual
  // assessment's own escalation recommendation — two independent signals
  // are checked, not one.
  const escalate = consensusClassification !== "routine" || a.escalationRecommended || b.escalationRecommended;
  const escalationPriority = escalate ? (SEVERITY_TO_PRIORITY[consensusClassification] ?? 3) : null;

  const rationale = disagreement
    ? `Disagreement between ${a.source} (${a.classification}) and ${b.source} (${b.classification}) — applying the conservative escalation strategy: consensus set to the more severe classification ("${consensusClassification}").`
    : `Both independent assessments agreed on "${consensusClassification}".`;

  return consensusResultSchema.parse({
    assessments,
    disagreement,
    consensusClassification,
    escalate,
    escalationPriority,
    rationale,
  });
}
