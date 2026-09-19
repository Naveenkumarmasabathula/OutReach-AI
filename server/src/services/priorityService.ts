/**
 * The outbound queue's priority algorithm (PRD §8/§10 — "you must design and
 * document an actual algorithm... explain how priority is calculated, how
 * competing campaigns are handled, how starvation is prevented"). A pure,
 * synchronous function for the same reason eligibilityService's rule is pure:
 * explainability. See docs/queue-design.md for the full justification of the
 * weights and curve shape below — this is the implementation of that design,
 * not a restatement of it.
 *
 * Score is a weighted sum of five independently-normalized [0,1] signals,
 * so the whole score is also roughly [0,1] and each input's contribution is
 * legible on its own:
 *
 *   score = W_DEADLINE * deadlineUrgency
 *         + W_RISK     * normalizedRisk
 *         + W_CAMPAIGN * normalizedCampaignPriority
 *         + W_WAIT     * starvationBoost
 *         + W_ATTEMPT  * attemptPressure
 *
 * Weights sum to 1.0. Deadline pressure dominates (0.4) because PRD §8
 * explicitly calls out that a soon-to-expire patient should be scheduled
 * ahead of a higher-priority-campaign patient with hours still to spare —
 * that only holds if deadline pressure outweighs campaign priority, not the
 * other way around. Clinical risk (0.3) outweighs campaign priority for the
 * same reason: PRD's core safety principle is that clinical need should not
 * be overridden by an operational campaign preference.
 *
 * Campaign priority's weight was reduced from its original 0.2 to 0.1 to
 * make room for `attemptPressure` (PRD §10: "previous failed attempts...
 * retry state" is a scheduling input, not just a backoff-delay input) without
 * disturbing the deadline/risk dominance the PRD explicitly grades on. Wait
 * (0.1) and attempt pressure (0.1) are both small, deliberately weak
 * signals — safety nets against a task being neglected, not drivers a task
 * should routinely win on.
 *
 * PRD §10's other two named factors, and why they're not additional score
 * terms here: "requested callback times" already drives scheduling directly
 * — a `callback_requested` outcome sets `scheduledFor`/`callbackRequestedFor`
 * to the patient's actual requested time (`queueService.recordAttemptOutcome`),
 * which already gates whether a task is claimable at all (`claimNextTasks`'s
 * `scheduledFor <= now` filter) — a second "callback-ness" score term would
 * be redundant with a hard gate that already exists. "Patient availability"
 * (e.g. a preferred time-of-day window) is genuinely NOT modeled anywhere in
 * this schema today — see docs/queue-design.md's priority-algorithm section
 * for why it's left out rather than backed by an invented/fake signal.
 */

export const PRIORITY_WEIGHTS = {
  deadline: 0.4,
  risk: 0.3,
  campaign: 0.1,
  wait: 0.1,
  attempts: 0.1,
} as const;

/** Hours a task can sit eligible before its starvation-prevention boost maxes out. */
export const STARVATION_HOURS = 24;

export type PriorityInput = {
  /** Encounter's clinical follow-up window, in hours from discharge. */
  followUpWindowHours: number;
  /** Hours since the patient's discharge, as of `now`. */
  hoursSinceDischarge: number;
  /** encounters.riskLevel — 1 (lowest) .. 5 (highest clinical risk). */
  riskLevel: number;
  /** campaigns.priority — 1 (highest) .. 5 (lowest). */
  campaignPriority: number;
  /** Hours this task has been sitting eligible (scheduledFor <= now) without being claimed. */
  hoursWaiting: number;
  /**
   * outreach_tasks.attemptCount as of this scoring pass — the number of call
   * attempts already made on this task (0 for a never-claimed task). Distinct
   * from `hoursWaiting`: a task can be waiting a long time on its FIRST
   * attempt (no urgency signal from retries), or come back around quickly
   * after several failed attempts (high urgency signal even with little wait
   * time). See `attemptPressure` below for the direction/justification.
   */
  attemptCount: number;
  /**
   * outreach_tasks.maxAttempts for this task — the total attempts allowed,
   * including the first. Needed alongside `attemptCount` because "2 prior
   * attempts" means very different things for a task allowed 2 retries vs.
   * one allowed 5 — what matters is proximity to exhausting the budget, not
   * the raw count.
   */
  maxAttempts: number;
};

export type PriorityBreakdown = {
  score: number;
  deadlineUrgency: number;
  normalizedRisk: number;
  normalizedCampaignPriority: number;
  starvationBoost: number;
  attemptPressure: number;
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Convex (cubic), not linear: a task should stay low-urgency for most of its
 * window and then rise sharply near the deadline, rather than climbing
 * steadily from the moment it's created. A linear ramp would make
 * "deadline pressure" indistinguishable from "just discharged" for most of
 * a task's life; cubic keeps early tasks calm and late tasks urgent, which
 * is the actual behavior PRD §8 describes ("a patient whose clinical window
 * is about to expire" — near expiry, not proportionally-through-window).
 * A deadline already passed (fractionElapsed > 1) clamps to full urgency
 * rather than being deprioritized further — an overdue patient is never
 * less urgent for having been missed.
 */
function deadlineUrgency(followUpWindowHours: number, hoursSinceDischarge: number): number {
  if (followUpWindowHours <= 0) return 1;
  const fractionElapsed = hoursSinceDischarge / followUpWindowHours;
  // clamp01 alone already gives 1.0 once the deadline has passed
  // (fractionElapsed >= 1), so the cubic curve naturally caps at full
  // urgency for an overdue task without needing a separate branch.
  return clamp01(fractionElapsed) ** 3;
}

/**
 * PRD §10 lists "previous failed attempts... and retry state" as scheduling
 * inputs, not just backoff-delay inputs (which `backoffMinutesForAttempt`
 * already covers below). Direction chosen: MORE prior failed attempts means
 * HIGHER priority, not lower — a task on attempt 2 of a 3-attempt budget is
 * running out of runway before it falls into `manual_follow_up` (taking a
 * human out of the loop entirely), so it should get first crack at the next
 * available calling-hours slot rather than sit behind fresher tasks that
 * still have their whole retry budget ahead of them. The alternative
 * (deprioritizing tasks that have already failed, on the theory that they're
 * "less likely to connect") isn't consistent with the platform's own retry
 * design: `enqueueEligiblePatients`/`recordAttemptOutcome` already assume a
 * retried task is still worth calling (that's why it's retried at all,
 * within calling-hours/backoff constraints) — deprioritizing it further on
 * top of that would just mean it's more likely to age out unclaimed and
 * silently miss its last attempt before its own clinical deadline, which is
 * exactly the outcome the deadline-urgency term already exists to prevent
 * elsewhere in this formula.
 *
 * Normalized against the task's own `maxAttempts` (not a fixed constant),
 * since "2 prior attempts" is maximal pressure for a 3-total-attempt task but
 * only mid-way for a 5-total-attempt one. Reaches 1.0 exactly on a task's
 * last possible attempt (`attemptCount === maxAttempts - 1`) — its final
 * chance before automated retries give up. A task that has never been
 * attempted (`attemptCount === 0`) scores 0 here, same as a task with no
 * retry budget at all (`maxAttempts <= 1`, guarded below) — there is no
 * "prior failed attempt" pressure to apply in either case.
 */
function attemptPressure(attemptCount: number, maxAttempts: number): number {
  const lastAttemptIndex = Math.max(1, maxAttempts - 1);
  return clamp01(attemptCount / lastAttemptIndex);
}

export function computeTaskPriority(input: PriorityInput): PriorityBreakdown {
  const urgency = deadlineUrgency(input.followUpWindowHours, input.hoursSinceDischarge);

  const normalizedRisk = clamp01((input.riskLevel - 1) / 4);
  const normalizedCampaignPriority = clamp01((5 - input.campaignPriority) / 4);
  const starvationBoost = clamp01(input.hoursWaiting / STARVATION_HOURS);
  const attempts = attemptPressure(input.attemptCount, input.maxAttempts);

  const score =
    PRIORITY_WEIGHTS.deadline * urgency +
    PRIORITY_WEIGHTS.risk * normalizedRisk +
    PRIORITY_WEIGHTS.campaign * normalizedCampaignPriority +
    PRIORITY_WEIGHTS.wait * starvationBoost +
    PRIORITY_WEIGHTS.attempts * attempts;

  return {
    score,
    deadlineUrgency: urgency,
    normalizedRisk,
    normalizedCampaignPriority,
    starvationBoost,
    attemptPressure: attempts,
  };
}

/**
 * Retry backoff schedule (PRD §11: "retries should use sensible backoff
 * rather than repeatedly calling a patient immediately"). Indexed by
 * attempt number (1st retry = index 0). Deliberately a short, fixed,
 * documented table rather than a generic exponential formula — the actual
 * values matter clinically (a patient shouldn't wait 12 hours for a first
 * retry, but also shouldn't be called back in 2 minutes), more than the
 * shape of the curve does. Holds at the last value if more retries are
 * configured than this table has entries.
 */
export const RETRY_BACKOFF_MINUTES = [30, 120, 360, 720] as const;

export function backoffMinutesForAttempt(attemptNumber: number): number {
  const index = Math.min(Math.max(0, attemptNumber - 1), RETRY_BACKOFF_MINUTES.length - 1);
  return RETRY_BACKOFF_MINUTES[index] ?? RETRY_BACKOFF_MINUTES[RETRY_BACKOFF_MINUTES.length - 1]!;
}
