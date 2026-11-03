// src/scientist/discovery-loop.ts

import { generateHypotheses } from "./hypothesis-generator.ts";
import { runExperiment } from "./experiment-runner.ts";
import { minimizeCounterexample } from "./counterexample-minimizer.ts";
import { interventionsToConfig } from "../interventions/dial-mapper.ts";
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
  const { baseConfig, maxExperiments, invariants, orchestrator, systemDescription, includeConfigurationInPrompt } = scientistConfig;
  const discoveredFailures: DiscoveredFailure[] = [];
  const inconclusiveReasons: string[] = [];
  const modelExchanges: ScientistResult["modelExchanges"] = [];
  const experimentLog: ScientistResult["experimentLog"] = [];
  const hypotheses: FailureHypothesis[] = [];
  let experimentsRun = 0;
  let provenFindingsTotal = 0;

  function matchesInvariant(actual: string | undefined, expected: string): boolean {
    if (!actual) return false;
    const actualId = actual.toLowerCase();
    const expectedId = expected.toLowerCase();
    if (actualId === expectedId) return true;
    return ["r04", "r05", "r10", "r11"].some(
      (prefix) => expectedId.startsWith(prefix) && actualId.startsWith(prefix),
    );
  }

  const priorEvidence: string[] = [];
  const selectedExperiments = new Set<string>();
  while (experimentsRun < maxExperiments) {
    let nextHypotheses: FailureHypothesis[];
    try {
      nextHypotheses = await generateHypotheses(
        baseConfig,
        invariants,
        1,
        orchestrator,
        (exchange) => {
          modelExchanges.push(exchange);
          scientistConfig.onModelExchange?.(exchange);
        },
        priorEvidence,
        systemDescription,
        includeConfigurationInPrompt ?? true,
      );
    } catch (error) {
      inconclusiveReasons.push(`Hypothesis generation failed: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    const hypothesis = nextHypotheses[0];
    if (!hypothesis) {
      inconclusiveReasons.push("No hypotheses were generated for the next experiment; discovery stopped without treating missing evidence as safety.");
      break;
    }
    const experimentKey = JSON.stringify(
      interventionsToConfig(baseConfig, hypothesis.interventionSequence.interventions),
    );
    if (selectedExperiments.has(experimentKey)) {
      inconclusiveReasons.push("Model repeated a previously executed experiment; discovery stopped to avoid duplicate evidence.");
      break;
    }
    selectedExperiments.add(experimentKey);
    hypotheses.push(hypothesis);
    let result: ExperimentResult;
    try {
      result = await runExperiment(hypothesis, baseConfig);
    } catch (error) {
      inconclusiveReasons.push(`Experiment ${experimentsRun + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    experimentsRun++;
    const experimentRecord: ScientistResult["experimentLog"][number] = {
      hypothesis,
      result,
      claimStatus: "auditor_not_proven",
    };
    experimentLog.push(experimentRecord);
    provenFindingsTotal += result.provenFindings.length;
    priorEvidence.push(JSON.stringify({
      experiment: experimentsRun,
      hypothesis: hypothesis.description,
      selectedInterventions: hypothesis.interventionSequence.interventions.map((item) => item.type),
      provenRuleIds: result.provenFindings.map((finding) => finding.rule_id),
      unknownRuleIds: result.findings.filter((finding) => finding.status === "unknown").map((finding) => finding.rule_id),
      metrics: {
        duplicateDollars: result.duplicateDollars ?? "unknown",
        orphanedResources: result.orphanedResources ?? "unknown",
        costUsd: result.costUsd ?? "unknown",
      },
    }));

    // Step 3: If hypothesis matched, record as discovered failure
    const confirmedFinding = result.provenFindings.some((finding) =>
      matchesInvariant(finding.rule_id, hypothesis.expectedInvariant),
    );
    if (confirmedFinding) {
      try {
        const replay = await runExperiment(hypothesis, baseConfig);
        const replayMatched = JSON.stringify(replay.trace) === JSON.stringify(result.trace);
        const auditorProven = replay.provenFindings.some((finding) =>
          matchesInvariant(finding.rule_id, hypothesis.expectedInvariant),
        );
        const replayCandidate: DiscoveredFailure = {
          id: `verification-${hypothesis.id}`,
          hypothesis,
          experiment: replay,
          businessImpact: formatBusinessImpact(replay),
          counterexample: [],
          independentVerification: {
            replayMatched,
            auditorProven,
            minimizedStillViolates: false,
            minimizedEventCount: 0,
          },
          replayHandle: { seed: replay.config.seed, config: replay.config },
        };
        const minimized = minimizeCounterexample(replayCandidate);
        const independentlyConfirmed = replayMatched && auditorProven && minimized.stillViolates;
        experimentRecord.independentVerification = {
          replayMatched,
          auditorProven,
          minimizedStillViolates: minimized.stillViolates,
          minimizedEventCount: minimized.minimizedEventCount,
        };
        if (independentlyConfirmed) {
          experimentRecord.claimStatus = "confirmed";
          discoveredFailures.push({
            ...replayCandidate,
            id: `failure-${discoveredFailures.length + 1}`,
            counterexample: minimized.events.map((event) => event.description),
            independentVerification: {
              replayMatched,
              auditorProven,
              minimizedStillViolates: minimized.stillViolates,
              minimizedEventCount: minimized.minimizedEventCount,
            },
          });
        } else {
          experimentRecord.claimStatus = "independent_proof_failed";
          inconclusiveReasons.push(
            `Experiment ${experimentsRun} did not survive independent replay and counterexample minimization; the model hypothesis is unsupported.`,
          );
        }
      } catch (error) {
        experimentRecord.claimStatus = "independent_proof_failed";
        inconclusiveReasons.push(
          `Experiment ${experimentsRun} could not be independently verified: ${error instanceof Error ? error.message : String(error)}.`,
        );
      }
    } else if (result.provenFindings.length > 0) {
      inconclusiveReasons.push(
        `Experiment ${experimentsRun} produced proven findings that did not match its hypothesis: ${result.provenFindings.map((finding) => finding.rule_id).join(", ") || "unknown rule"}.`,
      );
    } else {
      const expected = hypothesis.expectedInvariant.toLowerCase();
      const hasUnknownFinding = result.findings.some(
        (finding) =>
          finding.status === "unknown" &&
          matchesInvariant(finding.rule_id, expected),
      );
      const metric = expected.startsWith("r04")
        ? result.duplicateDollars
        : expected.startsWith("r05")
          ? result.orphanedResources
          : expected.startsWith("r10")
            ? result.costUsd
            : undefined;
      if (hasUnknownFinding) {
        inconclusiveReasons.push(
          `Experiment ${experimentsRun} had unknown auditor evidence for ${hypothesis.expectedInvariant}.`,
        );
      } else if (metric === undefined) {
        inconclusiveReasons.push(
          `Experiment ${experimentsRun} did not provide the business metric needed to assess ${hypothesis.expectedInvariant}.`,
        );
      } else if (
        (expected.startsWith("r04") || expected.startsWith("r05")) &&
        metric > 0
      ) {
        inconclusiveReasons.push(
          `Experiment ${experimentsRun} measured business impact (${metric}) without a proven ${hypothesis.expectedInvariant} finding.`,
        );
      }
    }
  }

  if (hypotheses.length === 0 && inconclusiveReasons.length === 0) {
    inconclusiveReasons.push("No hypotheses were generated; no experiment was run.");
  }

  if (experimentsRun >= maxExperiments && discoveredFailures.length === 0) {
    inconclusiveReasons.push("Experiment budget was exhausted without a confirmed matching failure.");
  }
  const status = discoveredFailures.length > 0
    ? "FAILURE_FOUND"
    : inconclusiveReasons.length > 0
      ? "INCONCLUSIVE"
      : "NO_FAILURE_FOUND";
  return makeResult(status);

  function makeResult(status: ScientistResult["status"]): ScientistResult {
    return {
      status,
      inconclusiveReasons,
      config: scientistConfig,
      experimentsRun,
      hypothesesGenerated: hypotheses.length,
      discoveredFailures,
      provenFindingsTotal,
      budgetExhausted: experimentsRun >= maxExperiments,
      modelExchanges,
      experimentLog,
    };
  }
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

