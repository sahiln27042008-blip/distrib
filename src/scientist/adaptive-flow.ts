import type { MatrixConfig } from "../matrix-copy.ts";
import { minimizeCounterexample } from "./counterexample-minimizer.ts";
import { composeExperiments } from "./experiment-composer.ts";
import { detectPhysicsGaps, type MissingMechanism } from "./physics-gap-detector.ts";
import { proposePhysics, type ProposedPhysics } from "./physics-proposer.ts";
import { selectPhysics } from "./physics-selector.ts";
import { runExperiment } from "./experiment-runner.ts";
import type { DiscoveredFailure, FailureHypothesis } from "./types.ts";

export type AdaptiveResult =
  | { status: "FAILURE_FOUND"; failures: DiscoveredFailure[]; experimentsRun: number }
  | { status: "NO_FAILURE_FOUND"; experimentsRun: number }
  | { status: "INSUFFICIENT_PHYSICS"; missingMechanisms: MissingMechanism[]; proposedPhysics: ProposedPhysics[] };

export async function runAdaptiveFlow(
  config: MatrixConfig,
  invariants: string[],
  budget: number,
  systemDescription?: string,
): Promise<AdaptiveResult> {
  const selection = await selectPhysics(config, systemDescription);
  const gaps = detectPhysicsGaps(config, selection.selected, systemDescription);
  if (gaps.hasGap) {
    const proposedPhysics: ProposedPhysics[] = [];
    for (const gap of gaps.missingMechanisms) {
      try {
        proposedPhysics.push(await proposePhysics(gap));
      } catch {
        // A failed proposer must not suppress the explicit gap report.
      }
    }
    return { status: "INSUFFICIENT_PHYSICS", missingMechanisms: gaps.missingMechanisms, proposedPhysics };
  }

  const experiments = composeExperiments(config, selection.selected, invariants, budget);
  const failures: DiscoveredFailure[] = [];
  let experimentsRun = 0;
  for (const experiment of experiments) {
    if (experimentsRun >= budget) break;
    const hypothesis: FailureHypothesis = {
      id: experiment.id,
      description: experiment.hypothesis,
      interventionSequence: experiment.sequence,
      expectedInvariant: experiment.expectedInvariant,
      confidence: 0.8,
    };
    const result = await runExperiment(hypothesis, experiment.config);
    experimentsRun++;
    if (!result.matchedHypothesis || result.provenFindings.length === 0) continue;

    const failureId = `adaptive-failure-${failures.length + 1}`;
    const provisional: DiscoveredFailure = {
      id: failureId,
      hypothesis,
      experiment: result,
      businessImpact: formatImpact(result),
      counterexample: [],
      replayHandle: { seed: result.config.seed, config: result.config },
    };
    const minimal = minimizeCounterexample(provisional);
    failures.push({
      ...provisional,
      counterexample: minimal.events.map((event) => event.description),
    });
  }

  return failures.length > 0
    ? { status: "FAILURE_FOUND", failures, experimentsRun }
    : { status: "NO_FAILURE_FOUND", experimentsRun };
}

function formatImpact(result: Awaited<ReturnType<typeof runExperiment>>): string {
  const parts: string[] = [];
  if ((result.duplicateDollars ?? 0) > 0) parts.push(`$${result.duplicateDollars} in duplicate charges`);
  if ((result.orphanedResources ?? 0) > 0) parts.push(`${result.orphanedResources} orphaned resources`);
  if ((result.costUsd ?? 0) > 0) parts.push(`$${result.costUsd!.toFixed(2)} compute cost`);
  return parts.join(", ") || "Invariant violation detected";
}