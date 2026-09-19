import type { ConversationTurn } from "../ai/types.js";
import type { ConversationResult, VoiceCallContext, VoiceProvider } from "./types.js";

function hashToUnitInterval(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0xffffffff;
}

// "declined" is a fifth, mutually-exclusive scenario bucket (not an
// independent random roll layered on top of the other four) specifically so
// it's fully deterministic per seed, same as everything else here — a
// routine/urgent seed always stays routine/urgent, it never separately has
// some additional chance of also failing verification. See `pickScenario`'s
// callers in `conductConversation` below.
const SCENARIOS = ["routine", "concerning", "urgent", "uncertain", "declined"] as const;
export type SimulatedScenario = (typeof SCENARIOS)[number];

// Weighted like callSimulator.ts's outcome buckets — most calls are
// unremarkable, escalation-worthy scenarios are the minority, matching a
// realistic post-discharge population. "declined" (wrong person answers, or
// the patient doesn't want to continue) is a small but real minority too.
const SCENARIO_WEIGHTS: [SimulatedScenario, number][] = [
  ["routine", 0.5],
  ["concerning", 0.18],
  ["uncertain", 0.09],
  ["urgent", 0.15],
  ["declined", 0.08],
];

// These phrases deliberately overlap with `simulatedProvider.ts`'s keyword
// vocabulary (so the free-text "AI" path can detect them) while
// `SCENARIO_SYMPTOMS` below is the separate, structured signal the
// rule-based protocol-matching path uses instead — see
// clinicalTriageAgent.ts for why those two paths intentionally read
// different inputs.
const SCENARIO_ANSWERS: Record<SimulatedScenario, string[]> = {
  routine: ["I'm feeling fine, no problems at all.", "I've been taking my medications as prescribed.", "No pain or issues since I got home."],
  concerning: ["I've noticed some swelling in my leg the last day or two.", "I've had a bit of a high fever today.", "Honestly it feels like it's getting worse since yesterday."],
  urgent: ["I've had chest pain since this morning.", "I'm having a hard time breathing, it's shortness of breath really.", "It came on suddenly and hasn't stopped."],
  uncertain: ["I'm not sure, maybe a little dizzy sometimes.", "Hard to tell if that's normal or not.", "I think it's fine but I'm not totally sure."],
  // Never fed to a protocol question — used only by the verification
  // exchange itself (a declined call ends before any protocol question is
  // asked). Kept here rather than a separate constant so `SimulatedScenario`
  // exhaustiveness is enforced by the type checker in one place.
  declined: [
    "Sorry, you have the wrong person.",
    "I'd rather not talk about this right now, please don't call back.",
    "I don't think I'm who you're looking for.",
  ],
};

const SCENARIO_SYMPTOMS: Record<SimulatedScenario, string[]> = {
  routine: [],
  concerning: ["swelling", "fever"],
  urgent: ["chest pain", "shortness of breath"],
  uncertain: ["dizziness"],
  declined: [],
};

// Reused to decide the early-exit/transfer branch point (PRD §14: "decide
// when the interaction should end or be transferred"). Deliberately a small,
// local list — the same kind of red-flag phrase matching
// `SimulatedAIProvider` (server/src/ai/simulatedProvider.ts) does against
// free text, duplicated rather than imported so this module stays
// independent of the `ai/` package the same way `hashToUnitInterval` above
// already is.
const URGENT_TRANSFER_PHRASES = ["chest pain", "shortness of breath", "can't breathe", "cannot breathe"];

function containsUrgentSignal(text: string): boolean {
  const haystack = text.toLowerCase();
  return URGENT_TRANSFER_PHRASES.some((phrase) => haystack.includes(phrase));
}

const DEFAULT_QUESTIONS = [
  "How are you feeling today compared to when you left the hospital?",
  "Have you noticed any new or worsening symptoms?",
  "Are you able to take your medications as prescribed?",
];

export function pickScenario(seed: string): SimulatedScenario {
  const roll = hashToUnitInterval(`${seed}:scenario`);
  let cumulative = 0;
  for (const [scenario, weight] of SCENARIO_WEIGHTS) {
    cumulative += weight;
    if (roll < cumulative) return scenario;
  }
  return "routine";
}

const VERIFICATION_QUESTION =
  "Before we go any further, can you confirm this is a good time to talk, and that I'm speaking with the right person?";
const VERIFICATION_CONFIRMED_ANSWER = "Yes, this is a good time — go ahead.";
const DECLINED_CLOSING = "Understood — we won't continue with this call today. Thank you for your time.";
const URGENT_TRANSFER_CLOSING =
  "That sounds like it needs attention right away — I'm ending the routine questions here and making sure a nurse reviews this immediately.";
const ROUTINE_CLOSING = "Thank you for the update. We'll make sure this information reaches your care team.";

/**
 * Picks one of `options` deterministically from `seed` — the same
 * hash-and-bucket approach as `pickScenario`, just for uniform (not
 * weighted) selection. Used for small cosmetic variety (e.g. which decline
 * phrase a "declined" scenario uses) where the specific choice doesn't
 * affect any downstream clinical logic.
 */
function pickOne<T>(options: T[], seed: string): T {
  const index = Math.floor(hashToUnitInterval(seed) * options.length) % options.length;
  return options[index]!;
}

/**
 * The Voice Intake Agent placeholder (PRD §12) — see types.ts for why this
 * is its own swap point, separate from `AIProvider`. Deterministic (hash on
 * `seed`, no `Math.random()`) for the same reproducibility reason as
 * `callSimulator.ts` and `SimulatedAIProvider`. Reuses the hospital's own
 * protocol-driven follow-up questions (Phase 4) rather than a fixed script,
 * so a real implementation swapped in later would need to honor the same
 * `protocolQuestions` input. See docs/voice-provider.md for the real
 * (Twilio/hosted voice-AI) swap-in this stands in for.
 *
 * Two branching behaviors beyond the original fixed script (PRD §14 —
 * "verify that the interaction can proceed" and "decide when the
 * interaction should end or be transferred"), both deterministic and both
 * driven off `seed`:
 *
 * 1. **In-call verification.** Every conversation opens with a short
 *    identity/consent check before any protocol question is asked. For the
 *    `declined` scenario bucket (see `SCENARIO_WEIGHTS` above), that check
 *    "fails" and the call ends immediately — `ConversationResult.verified`
 *    is `false`, `reportedSymptoms` is empty, and no protocol question was
 *    ever asked. `ai/pipeline.ts` checks this flag and skips triage
 *    entirely for a declined call.
 * 2. **Early exit / transfer.** While asking the protocol questions, if a
 *    patient's answer contains an urgent red-flag phrase
 *    (`containsUrgentSignal`), the remaining routine questions are skipped
 *    and the call closes immediately with a transfer-flavored line instead
 *    — a real nurse wouldn't keep asking routine follow-up questions after
 *    a patient reports chest pain. This is visible directly in the
 *    transcript (fewer turns than a routine call) and doesn't change what
 *    `reportedSymptoms` carries forward to triage.
 */
export class SimulatedVoiceProvider implements VoiceProvider {
  readonly name = "simulated-voice-provider";

  async conductConversation(context: VoiceCallContext, seed: string): Promise<ConversationResult> {
    const scenario = pickScenario(seed);

    const transcript: ConversationTurn[] = [
      {
        speaker: "agent",
        text: context.previousCallSummary
          ? `Hi ${context.patientFirstName}, this is a follow-up call from your care team. Last time we spoke: ${context.previousCallSummary} How have things been since then? ${VERIFICATION_QUESTION}`
          : `Hi ${context.patientFirstName}, this is a follow-up call from your care team checking in after your recent discharge. ${VERIFICATION_QUESTION}`,
      },
    ];

    if (scenario === "declined") {
      const declineAnswer = pickOne(SCENARIO_ANSWERS.declined, `${seed}:decline`);
      transcript.push({ speaker: "patient", text: declineAnswer });
      transcript.push({ speaker: "agent", text: DECLINED_CLOSING });
      return { transcript, reportedSymptoms: SCENARIO_SYMPTOMS.declined, verified: false };
    }

    transcript.push({ speaker: "patient", text: VERIFICATION_CONFIRMED_ANSWER });

    const questions = context.protocolQuestions.length > 0 ? context.protocolQuestions : DEFAULT_QUESTIONS;
    const answers = SCENARIO_ANSWERS[scenario];

    let endedEarly = false;
    for (let i = 0; i < questions.length; i++) {
      const answer = answers[i % answers.length]!;
      transcript.push({ speaker: "agent", text: questions[i]! });
      transcript.push({ speaker: "patient", text: answer });

      if (containsUrgentSignal(answer)) {
        endedEarly = true;
        break;
      }
    }

    transcript.push({ speaker: "agent", text: endedEarly ? URGENT_TRANSFER_CLOSING : ROUTINE_CLOSING });

    return { transcript, reportedSymptoms: SCENARIO_SYMPTOMS[scenario], verified: true };
  }
}
