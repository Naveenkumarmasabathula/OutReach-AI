import { CircuitBreakerVoiceProvider, voiceProviderCircuitBreaker } from "../../src/voice/circuitBreakerVoiceProvider.js";
import type { ConversationResult, VoiceCallContext, VoiceProvider } from "../../src/voice/types.js";
import { ServiceUnavailableError } from "../../src/lib/errors.js";

/**
 * Fix #1 (reliability audit): the same circuit-breaker treatment as the EHR
 * interface (test/unit/ehrCircuitBreaker.test.ts), applied to the voice
 * provider — PRD §22 names both as failure modes to guard against.
 */
describe("CircuitBreakerVoiceProvider (Fix #1 — PRD §22 circuit breaking applied to the voice provider)", () => {
  const context: VoiceCallContext = {
    patientFirstName: "Riley",
    protocolQuestions: ["How are you feeling?"],
    previousCallSummary: null,
  };

  afterEach(() => {
    voiceProviderCircuitBreaker.recordSuccess(); // reset the shared breaker between tests
  });

  it("passes successful calls straight through and keeps the circuit closed", async () => {
    const result: ConversationResult = { transcript: [], reportedSymptoms: [], verified: true };
    const inner: VoiceProvider = { name: "fake-voice", conductConversation: async () => result };
    const wrapped = new CircuitBreakerVoiceProvider(inner);

    await expect(wrapped.conductConversation(context, "seed-1")).resolves.toBe(result);
    expect(voiceProviderCircuitBreaker.isOpen()).toBe(false);
  });

  it("opens after repeated failures, then fails fast with ServiceUnavailableError without calling the inner provider again", async () => {
    let calls = 0;
    const inner: VoiceProvider = {
      name: "fake-voice",
      conductConversation: async () => {
        calls += 1;
        throw new Error("simulated voice provider outage");
      },
    };
    const wrapped = new CircuitBreakerVoiceProvider(inner);

    await expect(wrapped.conductConversation(context, "seed-1")).rejects.toThrow("simulated voice provider outage");
    await expect(wrapped.conductConversation(context, "seed-1")).rejects.toThrow("simulated voice provider outage");
    await expect(wrapped.conductConversation(context, "seed-1")).rejects.toThrow("simulated voice provider outage");
    expect(calls).toBe(3);
    expect(voiceProviderCircuitBreaker.isOpen()).toBe(true);

    await expect(wrapped.conductConversation(context, "seed-1")).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(calls).toBe(3); // short-circuited, inner never invoked this time
  });

  it("exposes the inner provider's name unchanged", () => {
    const inner: VoiceProvider = { name: "simulated-voice-provider", conductConversation: async () => ({} as never) };
    const wrapped = new CircuitBreakerVoiceProvider(inner);
    expect(wrapped.name).toBe("simulated-voice-provider");
  });
});
