import { runIndependentTriageAssessments } from "../ai/clinicalTriageAgent.js";
import { decideEscalation } from "../ai/escalationDecisionSystem.js";
import { SimulatedAIProvider } from "../ai/simulatedProvider.js";
import type { ConsensusResult, TriageResult } from "../ai/types.js";
import { SAFETY_EVAL_DATASET, type SafetyEvalCase } from "./evalDataset.js";

// Explicit, not the shared `aiProvider` singleton: this report's whole value
// is that it's identically reproducible regardless of what's configured in
// `server/.env` — a real GEMINI_API_KEY being present (and, worse, its
// pro-tier model having zero free-tier quota) must never change this
// script's output or make it fail outright.
const evalAiProvider = new SimulatedAIProvider();

export type SafetyEvalCaseResult = {
  case: SafetyEvalCase;
  assessments: [TriageResult, TriageResult];
  consensus: ConsensusResult;
  actualEscalate: boolean;
  verdict: "true_positive" | "false_positive" | "true_negative" | "false_negative";
};

export type SafetyEvalReport = {
  results: SafetyEvalCaseResult[];
  counts: { truePositive: number; falsePositive: number; trueNegative: number; falseNegative: number };
  falseNegativeRate: number;
  disagreementCases: SafetyEvalCaseResult[];
};

function classifyVerdict(expectedEscalate: boolean, actualEscalate: boolean): SafetyEvalCaseResult["verdict"] {
  if (expectedEscalate && actualEscalate) return "true_positive";
  if (!expectedEscalate && actualEscalate) return "false_positive";
  if (!expectedEscalate && !actualEscalate) return "true_negative";
  return "false_negative";
}

/**
 * PRD §15: run the fixed dataset through the real triage/consensus pipeline
 * (the exact same functions `ai/pipeline.ts` calls in production — this
 * isn't a separate, simplified re-implementation) and report TP/FP/TN/FN
 * plus the false-negative rate. No database, no network, no randomness:
 * `SAFETY_EVAL_DATASET` is a fixed array and both assessment paths are pure
 * functions, so re-running this after a prompt/protocol/consensus change
 * always re-evaluates the identical cases — the reproducibility PRD §15
 * requires.
 */
export async function runSafetyEvaluation(
  dataset: SafetyEvalCase[] = SAFETY_EVAL_DATASET,
): Promise<SafetyEvalReport> {
  const results: SafetyEvalCaseResult[] = [];

  for (const evalCase of dataset) {
    const assessments = await runIndependentTriageAssessments(
      {
        patientContext: `Safety evaluation case: ${evalCase.id}`,
        transcript: evalCase.transcript,
        reportedSymptoms: evalCase.reportedSymptoms,
        retrievedProtocols: [],
      },
      evalAiProvider,
    );
    const consensus = decideEscalation(assessments);
    const verdict = classifyVerdict(evalCase.expectedEscalate, consensus.escalate);

    results.push({ case: evalCase, assessments, consensus, actualEscalate: consensus.escalate, verdict });
  }

  const counts = {
    truePositive: results.filter((r) => r.verdict === "true_positive").length,
    falsePositive: results.filter((r) => r.verdict === "false_positive").length,
    trueNegative: results.filter((r) => r.verdict === "true_negative").length,
    falseNegative: results.filter((r) => r.verdict === "false_negative").length,
  };

  // False negatives divided by all cases that SHOULD have escalated (TP + FN)
  // — PRD §15's exact framing ("failing to escalate a high-risk case"), not
  // divided by the whole dataset (which would understate it whenever most
  // cases are routine).
  const positiveCases = counts.truePositive + counts.falseNegative;
  const falseNegativeRate = positiveCases > 0 ? counts.falseNegative / positiveCases : 0;

  const disagreementCases = results.filter((r) => r.consensus.disagreement);

  return { results, counts, falseNegativeRate, disagreementCases };
}
