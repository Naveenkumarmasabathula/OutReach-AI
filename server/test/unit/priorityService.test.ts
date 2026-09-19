import { backoffMinutesForAttempt, computeTaskPriority } from "../../src/services/priorityService.js";

const base = {
  followUpWindowHours: 72,
  hoursSinceDischarge: 10,
  riskLevel: 3,
  campaignPriority: 3,
  hoursWaiting: 0,
  attemptCount: 0,
  maxAttempts: 3,
};

describe("computeTaskPriority", () => {
  it("returns a score in [0, 1]", () => {
    const { score } = computeTaskPriority(base);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("gives higher scores to higher clinical risk, all else equal", () => {
    const low = computeTaskPriority({ ...base, riskLevel: 1 });
    const high = computeTaskPriority({ ...base, riskLevel: 5 });
    expect(high.score).toBeGreaterThan(low.score);
  });

  it("gives higher scores to higher-priority campaigns (priority 1 = highest), all else equal", () => {
    const lowPriorityCampaign = computeTaskPriority({ ...base, campaignPriority: 5 });
    const highPriorityCampaign = computeTaskPriority({ ...base, campaignPriority: 1 });
    expect(highPriorityCampaign.score).toBeGreaterThan(lowPriorityCampaign.score);
  });

  it("rises sharply as the deadline approaches (deadline pressure), not linearly", () => {
    const early = computeTaskPriority({ ...base, followUpWindowHours: 72, hoursSinceDischarge: 10 }); // ~14% through
    const mid = computeTaskPriority({ ...base, followUpWindowHours: 72, hoursSinceDischarge: 36 }); // 50% through
    const late = computeTaskPriority({ ...base, followUpWindowHours: 72, hoursSinceDischarge: 65 }); // ~90% through

    expect(early.deadlineUrgency).toBeLessThan(mid.deadlineUrgency);
    expect(mid.deadlineUrgency).toBeLessThan(late.deadlineUrgency);
    // Convexity: the jump from mid->late should be larger than early->mid,
    // even though both represent the same ~36-hour-then-29-hour gaps loosely —
    // the point of the cubic curve is that urgency concentrates near the end.
    const earlyToMid = mid.deadlineUrgency - early.deadlineUrgency;
    const midToLate = late.deadlineUrgency - mid.deadlineUrgency;
    expect(midToLate).toBeGreaterThan(earlyToMid);
  });

  it("caps deadline urgency at 1.0 for an already-overdue task, never penalizing it further", () => {
    const overdue = computeTaskPriority({ ...base, followUpWindowHours: 72, hoursSinceDischarge: 200 });
    expect(overdue.deadlineUrgency).toBe(1);
  });

  it("a near-expiry low-priority-campaign task can outrank a fresh high-priority-campaign task", () => {
    // PRD §8's explicit example: deadline pressure should be able to override campaign priority.
    const nearExpiry = computeTaskPriority({
      followUpWindowHours: 24,
      hoursSinceDischarge: 23, // 1 hour left
      riskLevel: 3,
      campaignPriority: 5, // lowest campaign priority
      hoursWaiting: 0,
      attemptCount: 0,
      maxAttempts: 3,
    });
    const freshHighPriority = computeTaskPriority({
      followUpWindowHours: 72,
      hoursSinceDischarge: 1, // just discharged, hours to spare
      riskLevel: 3,
      campaignPriority: 1, // highest campaign priority
      hoursWaiting: 0,
      attemptCount: 0,
      maxAttempts: 3,
    });
    expect(nearExpiry.score).toBeGreaterThan(freshHighPriority.score);
  });

  it("applies a small starvation-prevention boost for tasks waiting longer, without letting it dominate", () => {
    const justEligible = computeTaskPriority({ ...base, hoursWaiting: 0 });
    const waitedADay = computeTaskPriority({ ...base, hoursWaiting: 24 });
    expect(waitedADay.score).toBeGreaterThan(justEligible.score);
    // The wait boost alone (weight 0.1) should never be enough to beat a
    // meaningfully more urgent task on deadline/risk grounds.
    const veryUrgent = computeTaskPriority({ ...base, followUpWindowHours: 24, hoursSinceDischarge: 23, riskLevel: 5 });
    expect(veryUrgent.score).toBeGreaterThan(waitedADay.score);
  });

  it("gives higher scores to tasks with more prior failed attempts, all else equal (PRD §10 retry state)", () => {
    const neverAttempted = computeTaskPriority({ ...base, attemptCount: 0, maxAttempts: 3 });
    const oneFailure = computeTaskPriority({ ...base, attemptCount: 1, maxAttempts: 3 });
    const onLastChance = computeTaskPriority({ ...base, attemptCount: 2, maxAttempts: 3 });

    expect(oneFailure.score).toBeGreaterThan(neverAttempted.score);
    expect(onLastChance.score).toBeGreaterThan(oneFailure.score);
    expect(onLastChance.attemptPressure).toBe(1); // maxed out on its final possible attempt
    expect(neverAttempted.attemptPressure).toBe(0);
  });

  it("normalizes attempt pressure against the task's own retry budget, not a fixed attempt count", () => {
    // 1 prior attempt is "on the last chance" for a 2-attempt task, but only
    // partway for a 5-attempt task — the same raw attemptCount should carry
    // more urgency the smaller the remaining budget is.
    const tightBudget = computeTaskPriority({ ...base, attemptCount: 1, maxAttempts: 2 });
    const generousBudget = computeTaskPriority({ ...base, attemptCount: 1, maxAttempts: 5 });
    expect(tightBudget.attemptPressure).toBeGreaterThan(generousBudget.attemptPressure);
    expect(tightBudget.score).toBeGreaterThan(generousBudget.score);
  });

  it("the attempt-pressure boost is weak enough not to override deadline/risk urgency on its own", () => {
    const onLastChanceButLowUrgency = computeTaskPriority({
      ...base,
      attemptCount: 2,
      maxAttempts: 3,
      followUpWindowHours: 72,
      hoursSinceDischarge: 1,
      riskLevel: 1,
    });
    const veryUrgentNeverAttempted = computeTaskPriority({
      ...base,
      attemptCount: 0,
      maxAttempts: 3,
      followUpWindowHours: 24,
      hoursSinceDischarge: 23,
      riskLevel: 5,
    });
    expect(veryUrgentNeverAttempted.score).toBeGreaterThan(onLastChanceButLowUrgency.score);
  });
});

describe("backoffMinutesForAttempt", () => {
  it("increases with each attempt, then holds at the last configured value", () => {
    const first = backoffMinutesForAttempt(1);
    const second = backoffMinutesForAttempt(2);
    const third = backoffMinutesForAttempt(3);
    const farBeyondConfigured = backoffMinutesForAttempt(50);

    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(farBeyondConfigured).toBe(backoffMinutesForAttempt(4)); // holds at the table's last entry
  });

  it("never returns a non-positive backoff", () => {
    expect(backoffMinutesForAttempt(0)).toBeGreaterThan(0);
    expect(backoffMinutesForAttempt(-5)).toBeGreaterThan(0);
  });
});
