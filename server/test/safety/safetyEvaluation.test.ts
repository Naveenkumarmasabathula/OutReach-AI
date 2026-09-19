import { SAFETY_EVAL_DATASET } from "../../src/safety/evalDataset.js";
import { runSafetyEvaluation } from "../../src/safety/evalRunner.js";

describe("Phase 9 safety evaluation (fixed dataset, PRD §15)", () => {
  it("covers all seven required case categories with at least two cases each", () => {
    const categories = [
      "routine",
      "concerning",
      "urgent",
      "ambiguous",
      "incomplete_information",
      "conflicting_information",
      "adversarial",
    ] as const;
    for (const category of categories) {
      const count = SAFETY_EVAL_DATASET.filter((c) => c.category === category).length;
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });

  it("produces zero false negatives against the current triage/consensus logic", async () => {
    const report = await runSafetyEvaluation();
    expect(report.counts.falseNegative).toBe(0);
    expect(report.falseNegativeRate).toBe(0);
  });

  it("produces zero false positives", async () => {
    const report = await runSafetyEvaluation();
    expect(report.counts.falsePositive).toBe(0);
  });

  it("accounts for every case in exactly one verdict bucket", async () => {
    const report = await runSafetyEvaluation();
    const total =
      report.counts.truePositive + report.counts.falsePositive + report.counts.trueNegative + report.counts.falseNegative;
    expect(total).toBe(SAFETY_EVAL_DATASET.length);
  });

  it("is deterministic — re-running produces byte-identical verdicts (the reproducibility PRD §15 requires)", async () => {
    const first = await runSafetyEvaluation();
    const second = await runSafetyEvaluation();
    expect(second.counts).toEqual(first.counts);
    expect(second.results.map((r) => r.verdict)).toEqual(first.results.map((r) => r.verdict));
  });

  it("both adversarial cases escalate correctly despite embedded instructions attempting to suppress it", async () => {
    const report = await runSafetyEvaluation();
    const adversarial = report.results.filter((r) => r.case.category === "adversarial");
    expect(adversarial).toHaveLength(2);
    for (const result of adversarial) {
      expect(result.actualEscalate).toBe(true);
    }
  });

  it("genuinely exercises disagreement between the two independent assessment paths (not a contrived 0-disagreement dataset)", async () => {
    const report = await runSafetyEvaluation();
    expect(report.disagreementCases.length).toBeGreaterThan(0);
    for (const result of report.disagreementCases) {
      expect(result.assessments[0].classification).not.toBe(result.assessments[1].classification);
    }
  });
});
