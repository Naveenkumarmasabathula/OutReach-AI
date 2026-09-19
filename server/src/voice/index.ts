import { CircuitBreakerVoiceProvider } from "./circuitBreakerVoiceProvider.js";
import { SimulatedVoiceProvider } from "./simulatedVoiceProvider.js";
import type { VoiceProvider } from "./types.js";

/**
 * The swap point for a real telephony/voice-AI integration — see
 * docs/voice-provider.md. No env-based auto-switch like `ai/index.ts`'s
 * Gemini swap: there's no equivalent of an API key that turns this on today,
 * since a real implementation also needs a telephony account and phone
 * number provisioned, not just a credential. Swapping is a one-line change
 * here once that exists: `new TwilioVoiceProvider(...)` (or a hosted
 * voice-AI SDK's client) in place of `SimulatedVoiceProvider`.
 *
 * Wrapped in `CircuitBreakerVoiceProvider` (Fix #1, reliability audit) —
 * see circuitBreakerVoiceProvider.ts. `SimulatedVoiceProvider` itself can't
 * really fail, but the wrapping is what a real network-dependent
 * implementation needs the moment it's swapped in here, and costs nothing
 * to have in place now.
 */
export const voiceProvider: VoiceProvider = new CircuitBreakerVoiceProvider(new SimulatedVoiceProvider());
export { voiceProviderCircuitBreaker } from "./circuitBreakerVoiceProvider.js";

export * from "./types.js";
