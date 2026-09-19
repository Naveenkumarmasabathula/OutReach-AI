import type {
  AIProvider,
  ConversationTurn,
  DocumentationAgentInput,
  DocumentationRecord,
  TriageAgentInput,
  TriageClassification,
  TriageResult,
} from "./types.js";

/**
 * Deterministic hash-based FNV-1a — same one used by `callSimulator.ts`,
 * duplicated rather than imported so this module has zero dependency on the
 * queue layer (an AI provider shouldn't know about outreach tasks).
 */
function hashToUnitInterval(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

// Deliberately a DIFFERENT keyword vocabulary than clinicalTriageAgent.ts's
// rule-based path (which matches against retrieved red-flag protocols, not
// free text). This is what makes the two assessment paths genuinely
// independent — PRD §14 requires "multiple independent assessments," and if
// both paths used the same signal they could never meaningfully disagree,
// making the consensus/disagreement logic untestable in any real sense.
const URGENT_PHRASES = ["chest pain", "can't breathe", "cannot breathe", "collapsed", "unconscious", "severe pain"];
const CONCERNING_PHRASES = ["shortness of breath", "getting worse", "worsening", "high fever", "swelling", "dizzy"];
const UNCERTAIN_PHRASES = ["not sure", "maybe", "sometimes", "hard to tell", "i think"];

function patientText(transcript: ConversationTurn[]): string {
  return transcript
    .filter((turn) => turn.speaker === "patient")
    .map((turn) => turn.text)
    .join(" ")
    .toLowerCase();
}

function matchedPhrases(haystack: string, phrases: string[]): string[] {
  return phrases.filter((phrase) => haystack.includes(phrase));
}

function classify(haystack: string): { classification: TriageClassification; matched: string[] } {
  const urgentMatches = matchedPhrases(haystack, URGENT_PHRASES);
  if (urgentMatches.length > 0) return { classification: "urgent", matched: urgentMatches };

  const concerningMatches = matchedPhrases(haystack, CONCERNING_PHRASES);
  if (concerningMatches.length > 0) return { classification: "concerning", matched: concerningMatches };

  const uncertainMatches = matchedPhrases(haystack, UNCERTAIN_PHRASES);
  if (uncertainMatches.length > 0) return { classification: "uncertain", matched: uncertainMatches };

  return { classification: "routine", matched: [] };
}

const CONFIDENCE_RANGE: Record<TriageClassification, [number, number]> = {
  urgent: [0.75, 0.95],
  concerning: [0.6, 0.85],
  uncertain: [0.35, 0.55],
  routine: [0.7, 0.9],
};

/**
 * Stands in for a real LLM call. Deterministic (hash-seeded, no
 * `Math.random()`) for the same reproducibility reason as
 * `callSimulator.ts` — Phase 9's safety evaluation needs to re-run this
 * exact "model" and diff results after a prompt/protocol change, and a real
 * Gemini call would make that non-reproducible even before cost/latency is
 * considered. This is the default `aiProvider` until `GEMINI_API_KEY` is
 * set — see index.ts.
 */
export class SimulatedAIProvider implements AIProvider {
  readonly name = "simulated-ai-provider";

  async assessTriage(input: TriageAgentInput): Promise<TriageResult> {
    const haystack = patientText(input.transcript);
    const { classification, matched } = classify(haystack);

    const [lo, hi] = CONFIDENCE_RANGE[classification];
    const seed = hashToUnitInterval(`${input.patientContext}:${haystack}:ai`);
    const confidence = lo + seed * (hi - lo);

    const redFlagProtocols = input.retrievedProtocols.filter((p) => p.category === "red_flag_indicator");

    return {
      source: "ai_model",
      classification,
      observedIndicators: matched.length > 0 ? matched : ["no concerning language detected"],
      evidence: matched.map((phrase) => `Patient statement matching "${phrase}"`),
      protocolReferences: redFlagProtocols.map((p) => p.sourceReference),
      confidence: Number(confidence.toFixed(2)),
      escalationRecommended: classification === "urgent" || classification === "concerning",
      reasoning:
        matched.length > 0
          ? `Simulated model classified this call as ${classification} based on free-text language matching: ${matched.join(", ")}.`
          : `Simulated model found no concerning language in the patient's reported responses; classified as ${classification}.`,
    };
  }

  async generateDocumentation(input: DocumentationAgentInput): Promise<DocumentationRecord> {
    const patientTurns = input.transcript.filter((t) => t.speaker === "patient").map((t) => t.text);
    const consensus = input.consensus;

    return {
      callSummary: `Automated outreach call completed with connectivity outcome "${input.connectivityOutcome}". ${consensus.rationale}`,
      patientReportedSymptoms: patientTurns,
      observations: consensus.assessments.flatMap((a) => a.observedIndicators),
      outcome: consensus.escalate ? "escalated" : "completed",
      triageClassification: consensus.consensusClassification,
      escalationStatus: consensus.escalate ? "escalated" : "none",
      followUpRequirements: consensus.escalate
        ? ["Clinical reviewer follow-up required", "Confirm patient safety before closing escalation"]
        : ["No further action required unless symptoms change"],
    };
  }
}
