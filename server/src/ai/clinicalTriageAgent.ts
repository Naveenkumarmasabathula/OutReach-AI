import { aiProviderCircuitBreaker } from "./circuitBreaker.js";
import { aiProvider } from "./index.js";
import {
  triageResultSchema,
  type AIProvider,
  type TriageAgentInput,
  type TriageClassification,
  type TriageResult,
} from "./types.js";

// A fixed, clinician-authorable severity map — this IS the "rule" in
// "deterministic rule/protocol-matching triage" (docs/implementation-plan.md's
// tech-stack table). Deliberately a different vocabulary/shape than
// SimulatedAIProvider's free-text phrase matching (server/src/ai/simulatedProvider.ts)
// so the two assessment paths are genuinely independent — PRD §14 requires
// "multiple independent assessments," which only means something if the two
// paths can actually disagree.
const SYMPTOM_SEVERITY: Record<string, TriageClassification> = {
  "chest pain": "urgent",
  "shortness of breath": "urgent",
  swelling: "concerning",
  fever: "concerning",
  dizziness: "uncertain",
};

const SEVERITY_RANK: Record<TriageClassification, number> = { routine: 0, uncertain: 1, concerning: 2, urgent: 3 };

function worstOf(classifications: TriageClassification[]): TriageClassification {
  return classifications.reduce<TriageClassification>(
    (worst, current) => (SEVERITY_RANK[current] > SEVERITY_RANK[worst] ? current : worst),
    "routine",
  );
}

/**
 * The deterministic, protocol-matching triage path (PRD §5/§14). Pure and
 * synchronous — no AI call, no database — so it's independently unit
 * testable and its output is reproducible by construction, which matters
 * for Phase 9's safety evaluation. `retrievedProtocols` is passed in
 * already-fetched (via `protocolRetrievalService.retrieveRelevantProtocols`)
 * rather than queried here, keeping this function pure.
 */
export function assessRuleBased(input: TriageAgentInput): TriageResult {
  const severities = input.reportedSymptoms.map((symptom) => SYMPTOM_SEVERITY[symptom] ?? "uncertain");
  const classification = severities.length > 0 ? worstOf(severities) : "routine";

  const matchingProtocols = input.retrievedProtocols.filter((protocol) =>
    input.reportedSymptoms.some(
      (symptom) =>
        protocol.title.toLowerCase().includes(symptom) || protocol.content.toLowerCase().includes(symptom),
    ),
  );

  const result: TriageResult = {
    source: "rule_based",
    classification,
    observedIndicators: input.reportedSymptoms.length > 0 ? input.reportedSymptoms : ["no reported symptoms"],
    evidence: input.reportedSymptoms.map((symptom) => `Structured symptom report: "${symptom}"`),
    protocolReferences: matchingProtocols.map((p) => p.sourceReference),
    confidence: input.reportedSymptoms.length > 0 ? 0.9 : 0.95,
    escalationRecommended: classification === "urgent" || classification === "concerning",
    reasoning:
      input.reportedSymptoms.length > 0
        ? `Rule-based classification derived from a fixed symptom-severity map matched against ${input.reportedSymptoms.length} structured reported symptom(s)${
            matchingProtocols.length > 0
              ? `, corroborated by ${matchingProtocols.length} matching hospital protocol(s)`
              : ", with no matching hospital protocol on file for this hospital"
          }.`
        : "No symptoms were reported in structured form; classified as routine by default.",
  };

  return triageResultSchema.parse(result);
}

/**
 * Deliberately NOT "routine" and NOT confident. PRD §14's whole premise is
 * that a single assessment path is never trusted alone — so when the AI
 * path is unavailable (the circuit breaker below is open, meaning the
 * provider has been failing repeatedly), the honest response is "the second
 * opinion couldn't run," not a fabricated confident-looking result. Pairing
 * this with the rule-based result in `decideEscalation`'s worst-of logic
 * guarantees the consensus is at least "uncertain" (→ flagged for human
 * review) whenever this fires, never silently "routine."
 */
function degradedFallbackAssessment(reason: string): TriageResult {
  return {
    source: "ai_model",
    classification: "uncertain",
    observedIndicators: [],
    evidence: [],
    protocolReferences: [],
    confidence: 0,
    escalationRecommended: true,
    reasoning: `AI provider unavailable (${reason}) — a degraded, conservative fallback was used instead of a real second assessment. This call needs human review specifically because only one independent opinion (the rule-based path) could be obtained.`,
  };
}

/**
 * Runs both independent assessment paths (PRD §14) and returns them
 * unreconciled — `escalationDecisionSystem.ts` does the consensus/arbiter
 * step.
 *
 * PRD §22's circuit-breaking requirement applies here: a single AI call
 * failure still throws `AIOutputValidationError` (an explicit operational
 * failure per PRD §13 — callers, e.g. `queueService.processTask`, must
 * treat it as one, not silently fall back). But `aiProviderCircuitBreaker`
 * tracks *repeated* failures, and once it opens (a sustained outage, not a
 * one-off), further calls stop hitting the failing provider at all and use
 * `degradedFallbackAssessment` instead — so a real outage degrades the
 * whole queue to "escalate everything for human review" rather than
 * failing every single task outright.
 *
 * `provider` defaults to the shared `aiProvider` singleton (production
 * behavior, unchanged) but can be overridden — `safety/evalRunner.ts` passes
 * `SimulatedAIProvider` explicitly so PRD §15's "no database, no network, no
 * randomness" guarantee for the safety evaluation report is a property of
 * the script itself, not an accident of which provider happens to be
 * configured in `server/.env` when someone runs it.
 */
export async function runIndependentTriageAssessments(
  input: TriageAgentInput,
  provider: AIProvider = aiProvider,
): Promise<[TriageResult, TriageResult]> {
  const ruleBased = assessRuleBased(input);

  if (aiProviderCircuitBreaker.isOpen()) {
    return [ruleBased, degradedFallbackAssessment("circuit open")];
  }

  try {
    const aiBased = await provider.assessTriage(input);
    aiProviderCircuitBreaker.recordSuccess();
    return [ruleBased, triageResultSchema.parse(aiBased)];
  } catch (err) {
    aiProviderCircuitBreaker.recordFailure();
    throw err;
  }
}
