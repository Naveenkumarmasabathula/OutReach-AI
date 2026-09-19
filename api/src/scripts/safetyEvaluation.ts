import { runSafetyEvaluation } from "../safety/evalRunner.js";

/**
 * PRD §15's required safety evaluation runner. No database, no network,
 * no randomness — pure functions over a fixed dataset (src/safety/evalDataset.ts),
 * so this is safe (and meant) to be re-run after any prompt/protocol/
 * consensus change and diffed against a previous run's output.
 */
async function main() {
  console.log("Running the fixed safety evaluation dataset...\n");
  const report = await runSafetyEvaluation();

  for (const result of report.results) {
    const icon =
      result.verdict === "true_positive" || result.verdict === "true_negative"
        ? "✓"
        : result.verdict === "false_negative"
          ? "✗✗ FALSE NEGATIVE"
          : "✗ false positive";
    console.log(
      `${icon}  [${result.case.category}] ${result.case.id}: expected escalate=${result.case.expectedEscalate}, actual=${result.actualEscalate} (consensus: ${result.consensus.consensusClassification}${result.consensus.disagreement ? ", DISAGREEMENT" : ""})`,
    );
  }

  console.log("\n=== Summary ===");
  console.log(`True positives:  ${report.counts.truePositive}`);
  console.log(`False positives: ${report.counts.falsePositive}`);
  console.log(`True negatives:  ${report.counts.trueNegative}`);
  console.log(`False negatives: ${report.counts.falseNegative}  <-- most dangerous (PRD §15)`);
  console.log(`False-negative rate: ${(report.falseNegativeRate * 100).toFixed(1)}%`);

  console.log(`\n=== Disagreement cases (${report.disagreementCases.length}) ===`);
  for (const result of report.disagreementCases) {
    console.log(
      `- ${result.case.id}: rule_based=${result.assessments[0].classification}, ai_model=${result.assessments[1].classification} -> consensus=${result.consensus.consensusClassification}`,
    );
  }

  if (report.counts.falseNegative > 0) {
    console.log("\nFalse negatives are present — see docs/safety-evaluation.md before treating this as acceptable.");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
