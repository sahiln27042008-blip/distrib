// src/scientist/discovery-loop.ts

import { generateHypotheses } from "./hypothesis-generator.ts";
import { runExperiment } from "./experiment-runner.ts";
import type {
  ScientistConfig,
  ScientistResult,
  DiscoveredFailure,
  FailureHypothesis,
  ExperimentResult,
} from "./types.ts";

export async function runScientist(
  scientistConfig: ScientistConfig,
): Promise<ScientistResult> {
  const { baseConfig, maxExperiments, invariants } = scientistConfig;

  // Step 1: Generate hypotheses
  const hypotheses = await generateHypotheses(
    baseConfig,
    invariants,
    maxExperiments,
  );

  const discoveredFailures: DiscoveredFailure[] = [];
  let experimentsRun = 0;
  let provenFindingsTotal = 0;

  // Step 2: Run experiments for each hypothesis
  for (const hypothesis of hypotheses) {
    if (experimentsRun >= maxExperiments) break;

    const result = await runExperiment(hypothesis, baseConfig);
    experimentsRun++;
    provenFindingsTotal += result.provenFindings.length;

    // Step 3: If hypothesis matched, record as discovered failure
    if (result.matchedHypothesis && result.provenFindings.length > 0) {
      const businessImpact = formatBusinessImpact(result);
      const failure: DiscoveredFailure = {
        id: `failure-${discoveredFailures.length + 1}`,
        hypothesis,
        experiment: result,
        businessImpact,
        counterexample: [], // filled by minimizer later
        replayHandle: {
          seed: result.config.seed,
          config: result.config,
        },
      };
      discoveredFailures.push(failure);
    }
  }

  return {
    config: scientistConfig,
    experimentsRun,
    hypothesesGenerated: hypotheses.length,
    discoveredFailures,
    provenFindingsTotal,
    budgetExhausted: experimentsRun >= maxExperiments,
  };
}

function formatBusinessImpact(result: ExperimentResult): string {
  const parts: string[] = [];
  if (result.duplicateDollars && result.duplicateDollars > 0) {
    parts.push(`$${result.duplicateDollars} in duplicate charges`);
  }
  if (result.orphanedResources && result.orphanedResources > 0) {
    parts.push(`${result.orphanedResources} orphaned cloud resources`);
  }
  if (result.costUsd && result.costUsd > 0) {
    parts.push(`$${result.costUsd.toFixed(2)} in compute cost`);
  }
  if (parts.length === 0) {
    parts.push("Invariant violation detected");
  }
  return parts.join(", ");
}

