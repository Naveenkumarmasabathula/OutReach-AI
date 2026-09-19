import { CircuitBreaker, aiProviderCircuitBreaker } from "../../src/ai/circuitBreaker.js";
import { runIndependentTriageAssessments } from "../../src/ai/clinicalTriageAgent.js";

describe("CircuitBreaker (PRD §22 circuit breaking/fallback)", () => {
  it("starts closed and stays closed while calls succeed", () => {
    const breaker = new CircuitBreaker("test", 3, 1000);
    expect(breaker.isOpen()).toBe(false);
    breaker.recordSuccess();
    breaker.recordSuccess();
    expect(breaker.isOpen()).toBe(false);
  });

  it("opens after the failure threshold is reached", () => {
    const breaker = new CircuitBreaker("test", 3, 1000);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false); // 2 failures, threshold is 3
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });

  it("transitions to half-open after the cooldown and closes again on a successful trial call", async () => {
    const breaker = new CircuitBreaker("test", 1, 50); // opens after 1 failure, 50ms cooldown
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(breaker.isOpen()).toBe(false); // half-open now allows a trial call through

    breaker.recordSuccess();
    expect(breaker.getState()).toBe("closed");
  });

  it("re-opens (resetting the cooldown) if the half-open trial call also fails", async () => {
    const breaker = new CircuitBreaker("test", 1, 50);
    breaker.recordFailure();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(breaker.isOpen()).toBe(false); // half-open

    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true); // re-opened immediately, not waiting for another threshold
  });
});

describe("runIndependentTriageAssessments degrades safely when the AI provider circuit is open", () => {
  afterEach(() => {
    aiProviderCircuitBreaker.recordSuccess(); // reset the shared breaker so later test files aren't affected
  });

  it("returns a conservative, human-review-flagging fallback instead of calling the AI provider", async () => {
    aiProviderCircuitBreaker.recordFailure();
    aiProviderCircuitBreaker.recordFailure();
    aiProviderCircuitBreaker.recordFailure();
    expect(aiProviderCircuitBreaker.isOpen()).toBe(true);

    const [ruleBased, aiFallback] = await runIndependentTriageAssessments({
      patientContext: "circuit breaker test",
      transcript: [{ speaker: "patient", text: "I'm feeling fine, no problems at all." }],
      reportedSymptoms: [],
      retrievedProtocols: [],
    });

    expect(ruleBased.source).toBe("rule_based");
    expect(aiFallback.source).toBe("ai_model");
    expect(aiFallback.classification).toBe("uncertain");
    expect(aiFallback.confidence).toBe(0);
    expect(aiFallback.escalationRecommended).toBe(true);
    expect(aiFallback.reasoning).toContain("AI provider unavailable");
  });

  it("the degraded fallback still causes the consensus to escalate, even for an otherwise-routine call", async () => {
    const { decideEscalation } = await import("../../src/ai/escalationDecisionSystem.js");
    aiProviderCircuitBreaker.recordFailure();
    aiProviderCircuitBreaker.recordFailure();
    aiProviderCircuitBreaker.recordFailure();

    const assessments = await runIndependentTriageAssessments({
      patientContext: "circuit breaker test",
      transcript: [{ speaker: "patient", text: "I'm feeling fine, no problems at all." }],
      reportedSymptoms: [], // would be a clean routine/no-escalate case with a real second opinion
      retrievedProtocols: [],
    });
    const consensus = decideEscalation(assessments);

    expect(consensus.escalate).toBe(true);
    expect(consensus.consensusClassification).toBe("uncertain");
  });
});
