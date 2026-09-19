import { jest } from "@jest/globals";
import { GeminiProvider } from "../../src/ai/geminiProvider.js";
import { AIOutputValidationError } from "../../src/ai/types.js";

/**
 * `GeminiProvider` has never run against the live API (no key was
 * available while it was built — see docs/ai-usage.md), so nothing has ever
 * exercised its one-repair-attempt-then-explicit-failure logic (PRD §13).
 * Constructing a real instance with a fake key is safe offline (the SDK's
 * constructor does no network I/O), which lets these tests spy directly on
 * the real `generateContent` method rather than needing ESM module mocking.
 */
describe("GeminiProvider.assessTriage retry-then-throw (PRD §13 structured-output validation)", () => {
  function makeProviderWithMockedClient() {
    const provider = new GeminiProvider("fake-key-for-testing");
    // Accessing the private client field for spying purposes only — there is
    // no other seam to intercept the network call through.
    const client = (
      provider as unknown as { client: { models: { generateContent: (...args: unknown[]) => unknown } } }
    ).client;
    const generateContentSpy = jest.spyOn(client.models, "generateContent");
    return { provider, generateContentSpy };
  }

  function fakeResponse(body: unknown) {
    return { text: JSON.stringify(body), usageMetadata: { promptTokenCount: 10, totalTokenCount: 20 } };
  }

  const validTriageResult = {
    source: "ai_model",
    classification: "routine",
    observedIndicators: [],
    evidence: [],
    protocolReferences: [],
    confidence: 0.8,
    escalationRecommended: false,
    reasoning: "no concerning language",
  };

  const triageInput = {
    patientContext: "test",
    transcript: [{ speaker: "patient" as const, text: "I'm fine." }],
    reportedSymptoms: [],
    retrievedProtocols: [],
  };

  it("succeeds immediately when the model returns valid JSON on the first try", async () => {
    const { provider, generateContentSpy } = makeProviderWithMockedClient();
    generateContentSpy.mockResolvedValueOnce(fakeResponse(validTriageResult) as never);

    const result = await provider.assessTriage(triageInput);
    expect(result.classification).toBe("routine");
    expect(generateContentSpy).toHaveBeenCalledTimes(1);
  });

  it("repairs successfully: invalid JSON on the first attempt, valid on the repair re-prompt", async () => {
    const { provider, generateContentSpy } = makeProviderWithMockedClient();
    generateContentSpy
      .mockResolvedValueOnce(fakeResponse({ classification: "not_a_real_classification" }) as never) // invalid enum
      .mockResolvedValueOnce(fakeResponse(validTriageResult) as never);

    const result = await provider.assessTriage(triageInput);
    expect(result.classification).toBe("routine");
    expect(generateContentSpy).toHaveBeenCalledTimes(2);
  });

  it("throws AIOutputValidationError as an explicit operational failure when both attempts fail (PRD §13: never silently accepted)", async () => {
    const { provider, generateContentSpy } = makeProviderWithMockedClient();
    generateContentSpy
      .mockResolvedValueOnce(fakeResponse({ classification: "not_a_real_classification" }) as never)
      .mockResolvedValueOnce(fakeResponse({ still: "invalid" }) as never);

    await expect(provider.assessTriage(triageInput)).rejects.toBeInstanceOf(AIOutputValidationError);
    expect(generateContentSpy).toHaveBeenCalledTimes(2);
  });

  it("also throws AIOutputValidationError when the model returns text that isn't valid JSON at all", async () => {
    const { provider, generateContentSpy } = makeProviderWithMockedClient();
    generateContentSpy
      .mockResolvedValueOnce({ text: "Sorry, I cannot help with that.", usageMetadata: undefined } as never)
      .mockResolvedValueOnce({ text: "Still not JSON.", usageMetadata: undefined } as never);

    await expect(provider.assessTriage(triageInput)).rejects.toBeInstanceOf(AIOutputValidationError);
  });
});
