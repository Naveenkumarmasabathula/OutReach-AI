import type { OutreachTask } from "../db/schema/index.js";

/**
 * PLACEHOLDER for Phase 5's real Voice Intake Agent + `VoiceProvider`. The
 * voice/AI layer is intentionally simulated for now (per explicit product
 * direction) so the queue can be built, tested, and demonstrated
 * independently of telephony/STT/TTS integration. This function is the
 * exact seam: `queueService.ts` calls `simulateCallOutcome` and nothing
 * else about how a call happened; Phase 5 replaces the implementation
 * behind that one call site with a real `VoiceProvider` + agent
 * conversation, not the queue/retry/scheduling logic around it.
 *
 * Deterministic, not random: the outcome is derived from a hash of
 * `taskId` + `attemptNumber`, so the same task's Nth attempt always
 * produces the same outcome. This matters beyond just testability — Phase
 * 9's safety evaluation needs a reproducible fixed dataset, and a real
 * `Math.random()` call here would make "re-run after a prompt/model change
 * and diff the results" impossible even before an LLM is involved.
 */
export type SimulatedOutcome =
  | "completed"
  | "no_answer"
  | "busy"
  | "voicemail"
  | "dropped"
  | "invalid_number"
  | "declined"
  | "callback_requested"
  | "escalated";

const OUTCOME_WEIGHTS: [SimulatedOutcome, number][] = [
  ["completed", 0.45],
  ["no_answer", 0.2],
  ["busy", 0.1],
  ["voicemail", 0.1],
  ["dropped", 0.05],
  ["callback_requested", 0.05],
  ["escalated", 0.03],
  ["declined", 0.01],
  ["invalid_number", 0.01],
];

/** Simple deterministic string hash (FNV-1a) — no crypto needed, just stable pseudo-randomness. */
function hashToUnitInterval(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Unsigned 32-bit, then normalized to [0, 1).
  return (hash >>> 0) / 0xffffffff;
}

export function simulateCallOutcome(taskId: string, attemptNumber: number): SimulatedOutcome {
  const roll = hashToUnitInterval(`${taskId}:${attemptNumber}`);
  let cumulative = 0;
  for (const [outcome, weight] of OUTCOME_WEIGHTS) {
    cumulative += weight;
    if (roll < cumulative) return outcome;
  }
  return "completed"; // unreachable if weights sum to 1, but keeps the function total
}

/** For a callback_requested outcome, a deterministic near-future time (2-26h out) to call back. */
export function simulateCallbackTime(task: Pick<OutreachTask, "id">, now: Date): Date {
  const hoursOut = 2 + Math.floor(hashToUnitInterval(`${task.id}:callback`) * 24);
  return new Date(now.getTime() + hoursOut * 60 * 60 * 1000);
}
