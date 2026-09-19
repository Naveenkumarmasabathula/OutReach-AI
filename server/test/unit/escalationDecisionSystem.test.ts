import { decideEscalation } from "../../src/ai/escalationDecisionSystem.js";
import type { TriageResult } from "../../src/ai/types.js";

function assessment(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    source: "rule_based",
    classification: "routine",
    observedIndicators: [],
    evidence: [],
    protocolReferences: [],
    confidence: 0.9,
    escalationRecommended: false,
    reasoning: "test",
    ...overrides,
  };
}

describe("escalationDecisionSystem.decideEscalation", () => {
  it("does not escalate when both independent assessments agree on routine", () => {
    const result = decideEscalation([assessment(), assessment({ source: "ai_model" })]);
    expect(result.disagreement).toBe(false);
    expect(result.escalate).toBe(false);
    expect(result.escalationPriority).toBeNull();
  });

  it("escalates when both assessments agree the case is urgent", () => {
    const urgent = assessment({ classification: "urgent", escalationRecommended: true });
    const result = decideEscalation([urgent, { ...urgent, source: "ai_model" }]);
    expect(result.disagreement).toBe(false);
    expect(result.escalate).toBe(true);
    expect(result.escalationPriority).toBe(1);
  });

  it("applies the conservative escalation strategy on disagreement (PRD §14's own example)", () => {
    const routine = assessment({ classification: "routine" });
    const redFlag = assessment({
      source: "ai_model",
      classification: "concerning",
      escalationRecommended: true,
    });
    const result = decideEscalation([routine, redFlag]);
    expect(result.disagreement).toBe(true);
    expect(result.consensusClassification).toBe("concerning");
    expect(result.escalate).toBe(true);
    expect(result.escalationPriority).toBe(2);
  });

  it("never lets consensus classification alone suppress an individual escalation recommendation", () => {
    // Contrived: both classify "routine" (so consensus would be routine),
    // but one flags escalationRecommended anyway — the OR must still catch it.
    const a = assessment({ classification: "routine", escalationRecommended: true });
    const b = assessment({ source: "ai_model", classification: "routine", escalationRecommended: false });
    const result = decideEscalation([a, b]);
    expect(result.escalate).toBe(true);
  });

  it("treats 'uncertain' as its own escalation trigger, not a rounding-down to routine", () => {
    const uncertain = assessment({ classification: "uncertain" });
    const result = decideEscalation([uncertain, { ...uncertain, source: "ai_model" }]);
    expect(result.escalate).toBe(true);
    expect(result.escalationPriority).toBe(3);
  });

  it("ranks urgent as strictly more severe than concerning when they disagree", () => {
    const concerning = assessment({ classification: "concerning" });
    const urgent = assessment({ source: "ai_model", classification: "urgent" });
    const result = decideEscalation([concerning, urgent]);
    expect(result.consensusClassification).toBe("urgent");
    expect(result.escalationPriority).toBe(1);
  });
});
