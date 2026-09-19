import { CircuitBreaker } from "../ai/circuitBreaker.js";
import { ServiceUnavailableError } from "../lib/errors.js";
import type { ConversationResult, VoiceCallContext, VoiceProvider } from "./types.js";

/**
 * PRD §22 names the voice provider alongside the AI provider as a failure
 * mode to guard against; this mirrors `ai/circuitBreaker.ts`'s pattern
 * exactly (Fix #1, reliability audit — see `ehr/circuitBreakerEhr.ts` for
 * the same treatment of the EHR interface, with the fuller writeup of why
 * this can't substitute a safe fallback the way the AI breaker does).
 *
 * A voice call that can't be conducted has no safe conservative
 * substitute — fabricating a transcript would be actively harmful (it would
 * flow into triage as if a patient really said it). So same as the EHR
 * breaker: no fallback, an explicit `ServiceUnavailableError` (503) when the
 * circuit is open, fast-failing instead of hanging or retrying against a
 * known-down provider.
 */
export const voiceProviderCircuitBreaker = new CircuitBreaker("voice-provider", 3, 60_000);

export class CircuitBreakerVoiceProvider implements VoiceProvider {
  constructor(private readonly inner: VoiceProvider) {}

  get name(): string {
    return this.inner.name;
  }

  async conductConversation(context: VoiceCallContext, seed: string): Promise<ConversationResult> {
    if (voiceProviderCircuitBreaker.isOpen()) {
      throw new ServiceUnavailableError(
        "Voice provider circuit breaker is open — short-circuiting conductConversation without attempting the call (repeated recent voice-provider failures; see docs/observability-reliability.md)",
      );
    }
    try {
      const result = await this.inner.conductConversation(context, seed);
      voiceProviderCircuitBreaker.recordSuccess();
      return result;
    } catch (err) {
      voiceProviderCircuitBreaker.recordFailure();
      throw err;
    }
  }
}
