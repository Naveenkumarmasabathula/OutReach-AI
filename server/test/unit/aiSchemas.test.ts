import {
  consensusResultSchema,
  documentationRecordSchema,
  triageResultSchema,
} from "../../src/ai/types.js";

/**
 * PRD §13: "backend must validate AI output before use." Every prior test
 * in this codebase exercises these schemas only via `SimulatedAIProvider`,
 * which by construction always emits valid data — so validation *rejecting*
 * bad data has never actually been exercised. PRD §26 explicitly asks for
 * "structured output validation" testing, which means proving the
 * rejection path works, not just that the happy path parses.
 */
describe("AI structured-output schema validation rejects malformed data (PRD §13/§26)", () => {
  const validTriageResult = {
    source: "ai_model",
    classification: "routine",
    observedIndicators: [],
    evidence: [],
    protocolReferences: [],
    confidence: 0.8,
    escalationRecommended: false,
    reasoning: "no concerning language detected",
  };

  it("accepts a well-formed triage result", () => {
    expect(() => triageResultSchema.parse(validTriageResult)).not.toThrow();
  });

  it("rejects a triage result missing a required field", () => {
    const { reasoning: _reasoning, ...missingReasoning } = validTriageResult;
    expect(() => triageResultSchema.parse(missingReasoning)).toThrow();
  });

  it("rejects a triage result with an invalid classification enum value", () => {
    expect(() => triageResultSchema.parse({ ...validTriageResult, classification: "super_urgent" })).toThrow();
  });

  it("rejects a triage result with confidence out of the 0-1 range", () => {
    expect(() => triageResultSchema.parse({ ...validTriageResult, confidence: 1.5 })).toThrow();
  });

  it("rejects a triage result with the wrong type for a boolean field", () => {
    expect(() => triageResultSchema.parse({ ...validTriageResult, escalationRecommended: "yes" })).toThrow();
  });

  it("rejects a completely empty object", () => {
    expect(() => triageResultSchema.parse({})).toThrow();
  });

  const validConsensus = {
    assessments: [validTriageResult, { ...validTriageResult, source: "rule_based" }],
    disagreement: false,
    consensusClassification: "routine",
    escalate: false,
    escalationPriority: null,
    rationale: "both agreed",
  };

  it("accepts a well-formed consensus result", () => {
    expect(() => consensusResultSchema.parse(validConsensus)).not.toThrow();
  });

  it("rejects a consensus result with only one assessment (must be exactly two — PRD §14)", () => {
    expect(() => consensusResultSchema.parse({ ...validConsensus, assessments: [validTriageResult] })).toThrow();
  });

  it("rejects a consensus result with an out-of-range escalation priority", () => {
    expect(() => consensusResultSchema.parse({ ...validConsensus, escalationPriority: 9 })).toThrow();
  });

  const validDocumentation = {
    callSummary: "Patient reported feeling well.",
    patientReportedSymptoms: [],
    observations: [],
    outcome: "completed",
    triageClassification: "routine",
    escalationStatus: "none",
    followUpRequirements: [],
  };

  it("accepts a well-formed documentation record", () => {
    expect(() => documentationRecordSchema.parse(validDocumentation)).not.toThrow();
  });

  it("rejects a documentation record with an invalid escalationStatus enum value", () => {
    expect(() => documentationRecordSchema.parse({ ...validDocumentation, escalationStatus: "maybe" })).toThrow();
  });

  it("rejects a documentation record with a non-array where an array is required", () => {
    expect(() =>
      documentationRecordSchema.parse({ ...validDocumentation, patientReportedSymptoms: "chest pain" }),
    ).toThrow();
  });
});
