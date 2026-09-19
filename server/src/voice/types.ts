import type { ConversationTurn } from "../ai/types.js";

export type VoiceCallContext = {
  patientFirstName: string;
  protocolQuestions: string[];
  previousCallSummary: string | null;
};

export type ConversationResult = {
  transcript: ConversationTurn[];
  reportedSymptoms: string[];
  // PRD §14: "verify that the interaction can proceed" — a real in-call
  // identity/consent check at the start of the conversation, distinct from
  // the upstream eligibility gating that already ran before the call was
  // ever placed. `false` means that check failed (wrong person answered,
  // patient declined to continue): the conversation ended immediately,
  // before any protocol question was asked, and `transcript` /
  // `reportedSymptoms` reflect that short exchange only — never a full
  // script run to completion. `true` (the normal case) means the
  // conversation proceeded and `transcript`/`reportedSymptoms` are the full
  // (possibly early-exited — see `SimulatedVoiceProvider`'s urgent-transfer
  // branch) result of it.
  verified: boolean;
};

/**
 * The Voice Intake Agent's channel (PRD §12/§17): "manages the conversation,
 * protocol-driven questions, captures responses, identifies symptoms,
 * handles clarification, decides when to end/transfer." Kept as its own
 * interface, separate from `AIProvider` (server/src/ai/types.ts),
 * specifically per product direction: the voice/telephony concern (how a
 * call is actually placed and a conversation captured) is a different swap
 * point than the reasoning-model concern — a real implementation might be
 * Twilio Media Streams + a speech-to-text/text-to-speech pipeline, or a
 * hosted voice-AI platform, and doesn't have to use the same AI provider (or
 * any LLM at all for STT/TTS) that the triage/documentation agents use. See
 * docs/voice-provider.md for what a real implementation would look like.
 */
export interface VoiceProvider {
  readonly name: string;
  conductConversation(context: VoiceCallContext, seed: string): Promise<ConversationResult>;
}
