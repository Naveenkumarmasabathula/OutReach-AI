import { assessRuleBased } from "../../src/ai/clinicalTriageAgent.js";
import type { TriageAgentInput } from "../../src/ai/types.js";

function input(overrides: Partial<TriageAgentInput> = {}): TriageAgentInput {
  return {
    patientContext: "test",
    transcript: [],
    reportedSymptoms: [],
    retrievedProtocols: [],
    ...overrides,
  };
}

describe("clinicalTriageAgent.assessRuleBased (deterministic, protocol-matching path)", () => {
  it("classifies as routine when no symptoms were reported", () => {
    const result = assessRuleBased(input());
    expect(result.classification).toBe("routine");
    expect(result.escalationRecommended).toBe(false);
    expect(result.source).toBe("rule_based");
  });

  it("classifies urgent symptoms as urgent", () => {
    const result = assessRuleBased(input({ reportedSymptoms: ["chest pain"] }));
    expect(result.classification).toBe("urgent");
    expect(result.escalationRecommended).toBe(true);
  });

  it("classifies concerning symptoms as concerning", () => {
    const result = assessRuleBased(input({ reportedSymptoms: ["fever"] }));
    expect(result.classification).toBe("concerning");
  });

  it("takes the worst of multiple reported symptoms, not the first or last", () => {
    const result = assessRuleBased(input({ reportedSymptoms: ["dizziness", "chest pain", "fever"] }));
    expect(result.classification).toBe("urgent");
  });

  it("cites a matching hospital protocol as a protocol reference when one is provided", () => {
    const result = assessRuleBased(
      input({
        reportedSymptoms: ["chest pain"],
        retrievedProtocols: [
          {
            title: "Cardiac chest pain red flags",
            sourceReference: "Cardiology Protocol v2",
            content: "Watch for chest pain and radiating discomfort.",
            category: "red_flag_indicator",
          },
        ],
      }),
    );
    expect(result.protocolReferences).toContain("Cardiology Protocol v2");
  });

  it("is deterministic — same input always produces the same result", () => {
    const a = assessRuleBased(input({ reportedSymptoms: ["swelling"] }));
    const b = assessRuleBased(input({ reportedSymptoms: ["swelling"] }));
    expect(a).toEqual(b);
  });
});
