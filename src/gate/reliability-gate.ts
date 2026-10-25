import { minimizeCounterexample } from "../scientist/counterexample-minimizer.ts";
import { runScientist } from "../scientist/discovery-loop.ts";
import { runExperiment } from "../scientist/experiment-runner.ts";
import type { DiscoveredFailure, FailureHypothesis, ScientistConfig } from "../scientist/types.ts";
import { proposeFixTool } from "../mcp/tools/propose-fix.ts";
import { verifyFixTool } from "../mcp/tools/verify-fix.ts";
import type { GateEvidence, GateRequest, GateStatus } from "./gate-types.ts";

const DEFAULT_INVARIANTS = [
  "r04-network-idempotency",
  "r05-distributed-sagas",
  "r10-unit-economics",
];

export async function runReliabilityGate(request: GateRequest): Promise<GateEvidence> {
  const { config, maxExperiments = 10, invariants = DEFAULT_INVARIANTS } = request;
  const scientistConfig: ScientistConfig = {
    baseConfig: config,
    maxExperiments,
    maxSteps: 10000,
    invariants,
  };
  const scientistResult = await runScientist(scientistConfig);

  if (scientistResult.hypothesesGenerated === 0 && maxExperiments > 0) {
    for (const invariant of invariants.slice(0, maxExperiments)) {
      const hypothesis: FailureHypothesis = {
        id: `baseline-${invariant}`,
        description: `Audit the submitted configuration for ${invariant} without adding interventions.`,
        interventionSequence: {
          id: `baseline-${invariant}`,
          interventions: [],
          hypothesis: `Baseline audit for ${invariant}`,
          expectedInvariant: invariant,
        },
        expectedInvariant: invariant,
        confidence: 1,
      };
      const experiment = await runExperiment(hypothesis, config);
      scientistResult.experimentsRun++;
      scientistResult.provenFindingsTotal += experiment.provenFindings.length;
      if (!experiment.matchedHypothesis || experiment.provenFindings.length === 0) continue;

      const impact: string[] = [];
      if ((experiment.duplicateDollars ?? 0) > 0) impact.push(`$${experiment.duplicateDollars} in duplicate charges`);
      if ((experiment.orphanedResources ?? 0) > 0) impact.push(`${experiment.orphanedResources} orphaned cloud resources`);
      if ((experiment.costUsd ?? 0) > 0) impact.push(`$${experiment.costUsd!.toFixed(2)} in compute cost`);
      const failure: DiscoveredFailure = {
        id: `baseline-failure-${scientistResult.discoveredFailures.length + 1}`,
        hypothesis,
        experiment,
        businessImpact: impact.join(", ") || "Invariant violation detected during baseline audit",
        counterexample: [],
        replayHandle: { seed: experiment.config.seed, config: experiment.config },
      };
      scientistResult.discoveredFailures.push(failure);
    }
  }

  const discoveredFailures: GateEvidence["discoveredFailures"] = scientistResult.discoveredFailures.map((failure) => {
    let events: Array<{ description: string; timestamp: number }> = [];
    try {
      events = minimizeCounterexample(failure).events.map((event) => ({
        description: event.description,
        timestamp: event.timestamp,
      }));
    } catch {
      events = failure.experiment.trace.spans.map((span) => ({
        description: span.name,
        timestamp: span.startMs,
      }));
    }

    return {
      id: failure.id,
      hypothesis: failure.hypothesis.description,
      invariant: failure.hypothesis.expectedInvariant,
      businessImpact: failure.businessImpact,
      counterexample: events,
      replayHandle: failure.replayHandle,
    };
  });

  const patches: GateEvidence["patches"] = [];
  for (const failure of scientistResult.discoveredFailures) {
    const finding = failure.experiment.provenFindings[0];
    if (!finding) continue;

    try {
      const proposed = await proposeFixTool.handler({
        finding,
        explanation: failure.businessImpact,
        originalConfig: config,
        systemDescription: request.systemDescription,
      });
      const patch = proposed.patch as Record<string, unknown> | undefined;
      if (!proposed.success || !patch) continue;

      const verified = await verifyFixTool.handler({
        patch,
        originalConfig: config,
      });
      const verification = (verified.verification ?? verified) as Record<string, unknown>;
      patches.push({
        ruleId: String(patch.ruleId ?? finding.rule_id),
        description: String(patch.description ?? "Generated repair"),
        diff: String(patch.diff ?? ""),
        isVerified: verified.success !== false && verification.isFixed === true,
        beforeImpact: String(verification.beforeBusinessImpact ?? "Unavailable"),
        afterImpact: String(verification.afterBusinessImpact ?? "Unavailable"),
        proof: String(verification.proof ?? "Patch verification returned no proof."),
      });
    } catch {
      // A missing or failed patch must not erase the discovered failure.
    }
  }

  let status: GateStatus;
  let reason: string;
  if (scientistResult.experimentsRun === 0) {
    status = "INSUFFICIENT_EVIDENCE";
    reason = "No experiments completed, so the system could not be evaluated.";
  } else if (discoveredFailures.length > 0 || scientistResult.provenFindingsTotal > 0) {
    status = "BLOCKED";
    reason = discoveredFailures.length > 0
      ? `${discoveredFailures.length} proven failure(s) were discovered. Generated or simulator-verified patches do not change the submitted system configuration.`
      : `${scientistResult.provenFindingsTotal} proven finding(s) were reported but did not match a generated hypothesis; the gate will not approve an unresolved result.`;
  } else {
    status = "APPROVED";
    reason = `No invariant violations were discovered across ${scientistResult.experimentsRun} adversarial experiments.`;
  }

  return {
    discoveredFailures,
    patches,
    experimentsRun: scientistResult.experimentsRun,
    scenariosTested: scientistResult.experimentsRun,
    provenFindingsTotal: scientistResult.provenFindingsTotal,
    status,
    reason,
    generatedAt: new Date().toISOString(),
  };
}