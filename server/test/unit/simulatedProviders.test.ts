import { SimulatedAIProvider } from "../../src/ai/simulatedProvider.js";
import type { ConsensusResult, TriageAgentInput } from "../../src/ai/types.js";
import { pickScenario, SimulatedVoiceProvider, type SimulatedScenario } from "../../src/voice/simulatedVoiceProvider.js";

/** Deterministically finds a seed producing a specific scenario — same search-based approach as `pipeline.test.ts`'s `findAttemptFor`, just over raw seeds instead of task attempt numbers. */
function findSeedFor(target: SimulatedScenario, prefix: string): string {
  for (let i = 0; i < 1000; i++) {
    const seed = `${prefix}-${i}`;
    if (pickScenario(seed) === target) return seed;
  }
  throw new Error(`No seed found producing scenario "${target}"`);
}

describe("SimulatedAIProvider (placeholder for a real Gemini call)", () => {
  const provider = new SimulatedAIProvider();

  function triageInput(patientText: string): TriageAgentInput {
    return {
      patientContext: "ctx",
      transcript: [
        { speaker: "agent", text: "How are you feeling?" },
        { speaker: "patient", text: patientText },
      ],
      reportedSymptoms: [],
      retrievedProtocols: [],
    };
  }

  it("classifies urgent free-text language as urgent with escalation recommended", async () => {
    const result = await provider.assessTriage(triageInput("I've had chest pain since this morning."));
    expect(result.classification).toBe("urgent");
    expect(result.escalationRecommended).toBe(true);
    expect(result.source).toBe("ai_model");
  });

  it("classifies unremarkable language as routine", async () => {
    const result = await provider.assessTriage(triageInput("I'm feeling fine, no problems at all."));
    expect(result.classification).toBe("routine");
    expect(result.escalationRecommended).toBe(false);
  });

  it("is deterministic — the same transcript always produces the same assessment", async () => {
    const a = await provider.assessTriage(triageInput("I have a high fever today."));
    const b = await provider.assessTriage(triageInput("I have a high fever today."));
    expect(a).toEqual(b);
  });

  it("produces schema-valid documentation from a consensus result", async () => {
    const consensus: ConsensusResult = {
      assessments: [
        {
          source: "rule_based",
          classification: "routine",
          observedIndicators: [],
          evidence: [],
          protocolReferences: [],
          confidence: 0.9,
          escalationRecommended: false,
          reasoning: "x",
        },
        {
          source: "ai_model",
          classification: "routine",
          observedIndicators: [],
          evidence: [],
          protocolReferences: [],
          confidence: 0.8,
          escalationRecommended: false,
          reasoning: "y",
        },
      ],
      disagreement: false,
      consensusClassification: "routine",
      escalate: false,
      escalationPriority: null,
      rationale: "agreed",
    };
    const doc = await provider.generateDocumentation({
      transcript: [{ speaker: "patient", text: "Feeling fine." }],
      connectivityOutcome: "completed",
      consensus,
    });
    expect(doc.escalationStatus).toBe("none");
    expect(doc.outcome).toBe("completed");
  });
});

describe("SimulatedVoiceProvider (Voice Intake Agent placeholder)", () => {
  it("pickScenario is deterministic for a given seed", () => {
    expect(pickScenario("task-1:0")).toBe(pickScenario("task-1:0"));
  });

  it("covers all five scenarios across a range of seeds (weights sum to a full distribution)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickScenario(`seed-${i}`));
    expect(seen).toEqual(new Set(["routine", "concerning", "uncertain", "urgent", "declined"]));
  });

  it("produces a non-empty transcript alternating agent/patient turns and reports symptoms", async () => {
    const provider = new SimulatedVoiceProvider();
    const { transcript, reportedSymptoms } = await provider.conductConversation(
      { patientFirstName: "Alex", protocolQuestions: ["How is your incision healing?"], previousCallSummary: null },
      "seed-x",
    );
    expect(transcript.length).toBeGreaterThan(1);
    expect(transcript[0]!.speaker).toBe("agent");
    expect(Array.isArray(reportedSymptoms)).toBe(true);
  });

  it("references the previous call summary in its opening turn when one is provided", async () => {
    const provider = new SimulatedVoiceProvider();
    const { transcript } = await provider.conductConversation(
      { patientFirstName: "Alex", protocolQuestions: [], previousCallSummary: "patient reported mild swelling" },
      "seed-y",
    );
    expect(transcript[0]!.text).toContain("mild swelling");
  });

  // PRD §14: "verify that the interaction can proceed" — a real in-call
  // identity/consent check, distinct from upstream eligibility gating, that
  // can actually fail and end the call before any protocol question runs.
  it("declined scenario: in-call verification fails, ends the call immediately with verified=false and no protocol questions asked", async () => {
    const provider = new SimulatedVoiceProvider();
    const seed = findSeedFor("declined", "verify-fail");
    expect(pickScenario(seed)).toBe("declined");

    const protocolQuestions = [
      "How are you feeling today compared to when you left the hospital?",
      "Have you noticed any new or worsening symptoms?",
      "Are you able to take your medications as prescribed?",
    ];
    const { transcript, reportedSymptoms, verified } = await provider.conductConversation(
      { patientFirstName: "Alex", protocolQuestions, previousCallSummary: null },
      seed,
    );

    expect(verified).toBe(false);
    expect(reportedSymptoms).toEqual([]);
    // None of the hospital's actual protocol questions were ever asked.
    for (const question of protocolQuestions) {
      expect(transcript.some((turn) => turn.text === question)).toBe(false);
    }
    // Short: opening+verification, patient's decline, closing — nothing more.
    expect(transcript.length).toBe(3);
  });

  // PRD §14: "decide when the interaction should end or be transferred" — a
  // real branching point, not just always running the full fixed script.
  it("urgent scenario ends early on a red-flag answer, producing a visibly shorter transcript than the routine scenario", async () => {
    const provider = new SimulatedVoiceProvider();
    const urgentSeed = findSeedFor("urgent", "urgent-early-exit");
    const routineSeed = findSeedFor("routine", "urgent-early-exit-routine");
    expect(pickScenario(urgentSeed)).toBe("urgent");
    expect(pickScenario(routineSeed)).toBe("routine");

    const protocolQuestions = [
      "How are you feeling today compared to when you left the hospital?",
      "Have you noticed any new or worsening symptoms?",
      "Are you able to take your medications as prescribed?",
    ];
    const context = { patientFirstName: "Alex", protocolQuestions, previousCallSummary: null };

    const urgentResult = await provider.conductConversation(context, urgentSeed);
    const routineResult = await provider.conductConversation(context, routineSeed);

    expect(urgentResult.verified).toBe(true);
    expect(routineResult.verified).toBe(true);
    // The urgent call stopped after the first red-flag answer instead of
    // asking all three protocol questions — visibly fewer turns.
    expect(urgentResult.transcript.length).toBeLessThan(routineResult.transcript.length);
    // Not every protocol question was reached for the urgent call.
    const askedUrgentQuestions = protocolQuestions.filter((q) =>
      urgentResult.transcript.some((turn) => turn.text === q),
    );
    expect(askedUrgentQuestions.length).toBeLessThan(protocolQuestions.length);
    // The routine call, by contrast, still worked through every question.
    const askedRoutineQuestions = protocolQuestions.filter((q) =>
      routineResult.transcript.some((turn) => turn.text === q),
    );
    expect(askedRoutineQuestions.length).toBe(protocolQuestions.length);
  });
});
