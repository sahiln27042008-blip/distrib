import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createOrchestrator, MetaClient } from "../src/llm/meta-client.ts";
import { MockOrchestrator } from "../src/llm/orchestrator-mock.ts";
import { MatrixScenario } from "../src/matrix-copy.ts";
import { runScientist } from "../src/scientist/discovery-loop.ts";
import { runExperiment } from "../src/scientist/experiment-runner.ts";
import { minimizeCounterexample } from "../src/scientist/counterexample-minimizer.ts";
import { composeSequence } from "../src/interventions/composer.ts";
import { INTERVENTIONS } from "../src/interventions/primitives.ts";
import type { FailureHypothesis } from "../src/scientist/types.ts";
import type { ScientistResult } from "../src/scientist/types.ts";
import { blindCases } from "../test/phase5-benchmark-cases.ts";
import { answerKey } from "../test/phase5-answer-key.ts";

export const BUDGET = 3;
export const FIXED_BASELINE_SEQUENCES = [
  ["drop_response", "missing_idempotency_key"],
  ["partial_failure", "lose_state", "kill_worker"],
  ["rate_limit", "duplicate_request", "write_amplification"],
] as const;
const TRACKED_INVARIANTS = [
  "r04-network-idempotency",
  "r05-distributed-sagas",
  "r10-unit-economics",
  "r11-event-compaction",
];

function requireRealModel() {
  const orchestrator = createOrchestrator();
  if (orchestrator instanceof MockOrchestrator) {
    const metaMissing = [
      ...(!process.env.META_API_KEY ? ["META_API_KEY"] : []),
      ...(!process.env.META_BASE_URL ? ["META_BASE_URL"] : []),
    ];
    const googleMissing = !process.env.GOOGLE_API_KEY ? ["GOOGLE_API_KEY"] : [];
    throw new Error(
      `Phase 6 requires a real model; MockOrchestrator is active. Set either ${metaMissing.length ? metaMissing.join(" and ") : "META_API_KEY and META_BASE_URL"}, or ${googleMissing.length ? googleMissing.join("") : "GOOGLE_API_KEY"}. No secret values were read or printed.`,
    );
  }
  if (!(orchestrator instanceof MetaClient)) {
    throw new Error(`Unsupported model provider instance: ${orchestrator.constructor.name}`);
  }

  const provider = process.env.META_API_KEY && process.env.META_BASE_URL
    ? "Meta OpenAI-compatible"
    : "Google OpenAI-compatible";
  return {
    orchestrator,
    provider,
    model: orchestrator.config.model,
    endpoint: new URL(orchestrator.config.baseUrl).origin,
  };
}

function invariantMatches(actual: string | undefined, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  return actual.toLowerCase() === expected.toLowerCase() ||
    actual.toLowerCase().startsWith(expected.slice(0, 3).toLowerCase());
}

async function runBaseline(testCase: (typeof blindCases)[number]) {
  const executions: any[] = [];
  for (let index = 0; index < Math.min(BUDGET, FIXED_BASELINE_SEQUENCES.length); index++) {
    const interventionKeys = FIXED_BASELINE_SEQUENCES[index]!;
    const interventions = interventionKeys
      .map((key) => INTERVENTIONS[key as keyof typeof INTERVENTIONS])
      .filter((value) => value !== undefined);
    const hypothesis: FailureHypothesis = {
      id: `baseline-${index + 1}`,
      description: "Pre-registered fixed intervention sequence",
      experimentRationale: "The same fixed sequence is applied to every case; the baseline does not adapt to evidence.",
      expectedInvariant: "unscored",
      confidence: 1,
      interventionSequence: composeSequence(interventions, "fixed baseline"),
    };
    try {
      const result = await runExperiment(hypothesis, testCase.config);
      executions.push({
        interventionKeys,
        provenRuleIds: result.provenFindings.map((finding) => finding.rule_id),
        uniqueProvenRuleIds: [...new Set(result.provenFindings.map((finding) => finding.rule_id))],
        provenFindingCount: result.provenFindings.length,
        unknownRuleIds: [...new Set(result.findings.filter((finding) => finding.status === "unknown").map((finding) => finding.rule_id))],
        measuredMetrics: {
          duplicateDollars: result.duplicateDollars ?? null,
          orphanedResources: result.orphanedResources ?? null,
          costUsd: result.costUsd ?? null,
        },
        verificationTrace: result.trace,
        config: result.config,
        hypothesis,
        verificationExperiment: result,
      });
    } catch (error) {
      executions.push({ error: error instanceof Error ? error.message : String(error), interventionKeys });
      break;
    }
  }
  return executions;
}

async function main() {
  const model = requireRealModel();
  const trialCount = Math.max(1, Number.parseInt(process.argv[3] ?? "1", 10) || 1);
  console.log(`Phase 7 model: provider=${model.provider}, model=${model.model}, endpoint=${model.endpoint}`);
  const caseResults: any[] = [];
  for (let trial = 1; trial <= trialCount; trial++) {
    for (const testCase of blindCases) {
    const modelExchanges: unknown[] = [];
    let scientist: ScientistResult;
    try {
      scientist = await runScientist({
        baseConfig: testCase.config,
        maxExperiments: BUDGET,
        maxSteps: 10_000,
        invariants: TRACKED_INVARIANTS,
        orchestrator: model.orchestrator,
        systemDescription: testCase.description,
        includeConfigurationInPrompt: false,
        onModelExchange: (exchange) => modelExchanges.push(exchange),
      });
    } catch (error) {
      scientist = {
        status: "INCONCLUSIVE",
        experimentsRun: 0,
        hypothesesGenerated: 0,
        provenFindingsTotal: 0,
        discoveredFailures: [],
        experimentLog: [],
        inconclusiveReasons: [error instanceof Error ? error.message : String(error)],
        budgetExhausted: false,
        config: {
          baseConfig: testCase.config,
          maxExperiments: BUDGET,
          maxSteps: 10_000,
          invariants: TRACKED_INVARIANTS,
          orchestrator: model.orchestrator,
          systemDescription: testCase.description,
          includeConfigurationInPrompt: false,
        },
        modelExchanges: modelExchanges as ScientistResult["modelExchanges"],
      };
    }
    const baseline = await runBaseline(testCase);
    const key = answerKey[testCase.id]!;
    for (const execution of baseline) {
      execution.matchedExpected = false;
      if (!key.expectedInvariant || !execution.verificationExperiment) continue;
      const hadExpectedFinding = execution.provenRuleIds.some((ruleId: string) =>
        invariantMatches(ruleId, key.expectedInvariant),
      );
      if (!hadExpectedFinding) continue;

      const verificationHypothesis: FailureHypothesis = {
        ...execution.hypothesis,
        expectedInvariant: key.expectedInvariant,
      };
      const replay = await runExperiment(verificationHypothesis, testCase.config);
      const replayMatched = JSON.stringify(replay.trace) === JSON.stringify(execution.verificationExperiment.trace);
      const auditorProven = replay.provenFindings.some((finding) =>
        invariantMatches(finding.rule_id, key.expectedInvariant),
      );
      const minimized = minimizeCounterexample({
        id: `baseline-${testCase.id}`,
        hypothesis: verificationHypothesis,
        experiment: replay,
        businessImpact: "Independent baseline verification",
        counterexample: [],
        independentVerification: {
          replayMatched,
          auditorProven,
          minimizedStillViolates: false,
          minimizedEventCount: 0,
        },
        replayHandle: { seed: replay.config.seed, config: replay.config },
      });
      execution.independentVerification = {
        replayMatched,
        auditorProven,
        minimizedStillViolates: minimized.stillViolates,
        minimizedEventCount: minimized.minimizedEventCount,
      };
      execution.matchedExpected = replayMatched && auditorProven && minimized.stillViolates;
    }
    const aiConfirmed = scientist.discoveredFailures.some((failure) =>
      failure.independentVerification?.replayMatched &&
      failure.independentVerification?.auditorProven &&
      failure.independentVerification?.minimizedStillViolates &&
      failure.experiment.provenFindings.some((finding) => invariantMatches(finding.rule_id, key.expectedInvariant)),
    );
    const baselineConfirmed = baseline.some((execution: any) => execution.matchedExpected === true);
    const independentChecks = [];
    const discovered: any[] = scientist.discoveredFailures.map((failure) => ({
      source: "scientist",
      hypothesis: failure.hypothesis,
      experiment: failure.experiment,
      replayConfig: failure.replayHandle.config,
    }));
    const baselineDiscovery = baseline.find((execution: any) => execution.matchedExpected && execution.hypothesis);
    if (baselineDiscovery) {
      discovered.push({
        source: "fixed-baseline",
        hypothesis: baselineDiscovery.hypothesis,
        experiment: baselineDiscovery.verificationExperiment,
        replayConfig: baselineDiscovery.config,
      });
    }
    for (const failure of discovered) {
      const replay = new MatrixScenario(failure.replayConfig);
      replay.run();
      const replayTrace = replay.exportTrace();
      const replayMatches = JSON.stringify(replayTrace) === JSON.stringify(failure.experiment.trace);
      const minimized = minimizeCounterexample({
        id: `${failure.source}-${testCase.id}`,
        hypothesis: failure.hypothesis,
        experiment: failure.experiment,
        businessImpact: "Auditor-confirmed simulated failure",
        counterexample: [],
        replayHandle: { seed: failure.replayConfig.seed, config: failure.replayConfig },
      } as any);
      const repairDial = failure.hypothesis.expectedInvariant.startsWith("r04") ? "C" :
        failure.hypothesis.expectedInvariant.startsWith("r11") ? "B" : "F";
      const repairedValue = repairDial === "C" ? "C1_clean_20ms" :
        repairDial === "B" ? "B1_zero_hold_2ms" : "F3_resilient_invariant_runtime";
      const fixedConfig = { ...failure.replayConfig, [repairDial]: repairedValue } as typeof testCase.config;
      const repairHypothesis: FailureHypothesis = {
        ...failure.hypothesis,
        interventionSequence: {
          ...failure.hypothesis.interventionSequence,
          interventions: failure.hypothesis.interventionSequence.interventions.filter(
            (intervention: { type: string }) => !(repairDial === "C" && intervention.type === "missing_idempotency_key"),
          ),
        },
      };
      const repaired = await runExperiment(repairHypothesis, fixedConfig);
      const ablated = await runExperiment(failure.hypothesis, failure.experiment.config);
      const adversarial = await runExperiment(failure.hypothesis, {
        ...testCase.config,
        C: testCase.config.C === "C2_socket_drop_2ms_late" ? "C5_legacy_erp_no_idem" : "C2_socket_drop_2ms_late",
        seed: testCase.config.seed + 1,
      });
      const repairedSnapshot = repaired.snapshot as any;
      independentChecks.push({
        discoverySource: failure.source,
        findingRuleIds: failure.experiment.provenFindings.map((finding: { rule_id: string }) => finding.rule_id),
        replay: { sameSeed: failure.replayConfig.seed, byteIdenticalTrace: replayMatches },
        minimized: {
          originalRelevantSpanCount: minimized.originalEventCount,
          minimizedEventCount: minimized.minimizedEventCount,
          stillViolatesOnIndependentAuditorReplay: minimized.stillViolates,
          events: minimized.events,
        },
        repair: {
          method: "simulator dial-equivalent only; no source diff applied",
          removedFaultAsRepair: repairDial === "C" ? "missing_idempotency_key" : null,
          retainedInterventions: repairHypothesis.interventionSequence.interventions.map((intervention) => intervention.type),
          config: repaired.config,
          remainingExpectedFindings: repaired.provenFindings.filter((finding) =>
            invariantMatches(finding.rule_id, key.expectedInvariant),
          ).map((finding) => finding.rule_id),
          measuredCallsAfterRepair: repairedSnapshot?.network?.calls ?? null,
          workflowStepsPreserved: repaired.config.workflowSteps === testCase.config.workflowSteps,
          businessOperationStillExecuted: Number.isFinite(repairedSnapshot?.network?.calls) && repairedSnapshot.network.calls > 0,
        },
        repairAblation: {
          restoredOriginalConfiguration: JSON.stringify(ablated.config) === JSON.stringify(failure.experiment.config),
          returnedExpectedFinding: ablated.provenFindings.some((finding) => invariantMatches(finding.rule_id, key.expectedInvariant)),
          adversarialVariant: {
            seed: adversarial.config.seed,
            networkDial: adversarial.config.C,
            provenRuleIds: adversarial.provenFindings.map((finding) => finding.rule_id),
          },
        },
      });
    }

    caseResults.push({
      trial,
      id: testCase.id,
      descriptionSentToScientist: testCase.description,
      answerKeyUsedAfterRuns: key,
      scientist: {
        status: scientist.status,
        experimentsRun: scientist.experimentsRun,
        hypothesesGenerated: scientist.hypothesesGenerated,
        confirmedByAuditor: aiConfirmed,
        unsupportedClaims: scientist.experimentLog.filter((entry) => entry.claimStatus !== "confirmed").length,
        inconclusiveReasons: scientist.inconclusiveReasons,
        modelExchanges,
        experiments: scientist.experimentLog.map(({ hypothesis, result }) => ({
          hypothesis,
          config: result.config,
          provenRuleIds: result.provenFindings.map((finding) => finding.rule_id),
          claimStatus: scientist.experimentLog.find((entry) => entry.hypothesis.id === hypothesis.id)?.claimStatus ?? "auditor_not_proven",
          independentVerification: scientist.experimentLog.find((entry) => entry.hypothesis.id === hypothesis.id)?.independentVerification ?? null,
          findings: result.findings,
          missingMetricBehavior: {
            duplicateDollars: result.duplicateDollars ?? null,
            orphanedResources: result.orphanedResources ?? null,
            costUsd: result.costUsd ?? null,
          },
          trace: result.trace,
        })),
        adaptiveEvidenceChecks: scientist.modelExchanges.slice(1).map((exchange: any, index) => ({
          iteration: index + 2,
          includedPriorExperimentEvidence: JSON.stringify(exchange.messages).includes("Prior experiment evidence"),
          priorEvidenceContainsObservation: JSON.stringify(exchange.messages).includes("provenRuleIds"),
        })),
      },
      fixedBaseline: {
        budget: BUDGET,
        executions: baseline.map((execution: any) => ({
          interventionKeys: execution.interventionKeys,
          uniqueProvenRuleIds: execution.uniqueProvenRuleIds,
          provenFindingCount: execution.provenFindingCount,
          unknownRuleIds: execution.unknownRuleIds,
          measuredMetrics: execution.measuredMetrics,
          matchedExpected: execution.matchedExpected,
          independentVerification: execution.independentVerification ?? null,
          config: execution.config,
          hypothesis: execution.hypothesis,
          ...(execution.error ? { error: execution.error } : {}),
        })),
        confirmedByAuditor: baselineConfirmed,
      },
      independentChecks,
    });
    }
  }

  const controls = caseResults.filter((item: any) => item.id === "case-negative-control");
  const output: any = {
    schema: "phase5-benchmark/1",
      modelIdentity: { provider: model.provider, model: model.model, endpoint: model.endpoint },
    reproducibility: {
      trials: trialCount,
      identicalCaseSeedsAcrossTrials: true,
      seeds: blindCases.map((testCase: any) => ({ caseId: testCase.id, seed: testCase.config.seed })),
    },
    budgetPerMethodPerCase: BUDGET,
    cases: caseResults,
    summary: {
      cases: caseResults.length,
      scientistConfirmed: caseResults.filter((item: any) => item.scientist.confirmedByAuditor).length,
      baselineConfirmed: caseResults.filter((item: any) => item.fixedBaseline.confirmedByAuditor).length,
      auditorProvenClaims: caseResults.reduce((total: number, item: any) => total + item.scientist.experiments.filter((experiment: any) =>
        experiment.provenRuleIds.some((ruleId: string) => invariantMatches(ruleId, experiment.hypothesis.expectedInvariant)),
      ).length, 0),
      negativeControlFalsePositive: controls.some((item: any) =>
        item.scientist.experiments.some((experiment: any) => experiment.claimStatus === "independent_proof_failed"),
      ),
      negativeControlMinimizedFalsePositive: controls.some((item: any) =>
        item.scientist.experiments.some((experiment: any) =>
          experiment.claimStatus === "independent_proof_failed" &&
          experiment.independentVerification?.auditorProven &&
          !experiment.independentVerification?.minimizedStillViolates,
        ),
      ),
      scientistInconclusive: caseResults.filter((item: any) => item.scientist.status === "INCONCLUSIVE").length,
      unsupportedClaims: caseResults.reduce((total: number, item: any) => total + item.scientist.experiments.filter((experiment: any) => experiment.claimStatus === "independent_proof_failed").length, 0),
      unprovenHypotheses: caseResults.reduce((total: number, item: any) => total + item.scientist.experiments.filter((experiment: any) => experiment.claimStatus === "auditor_not_proven").length, 0),
      falseNegatives: caseResults.filter((item: any) =>
        answerKey[item.id]?.expectedInvariant && !item.scientist.confirmedByAuditor,
      ).length,
      scientistExperimentsUsed: caseResults.reduce((total: number, item: any) => total + item.scientist.experimentsRun, 0),
      baselineExperimentsUsed: caseResults.reduce((total: number, item: any) => total + item.fixedBaseline.executions.length, 0),
      providerErrors: caseResults.reduce((total: number, item: any) => total + item.scientist.modelExchanges.filter((exchange: any) => exchange.response?.error).length, 0),
      executions: caseResults.map((item: any) => ({
        trial: item.trial,
        id: item.id,
        scientist: item.scientist.experimentsRun,
        baseline: item.fixedBaseline.executions.length,
        firstScientistDiscovery: item.scientist.experiments.findIndex((experiment: any) =>
          experiment.claimStatus === "confirmed" &&
          experiment.provenRuleIds.some((ruleId: string) => invariantMatches(ruleId, answerKey[item.id]?.expectedInvariant)),
        ) + 1 || null,
        firstBaselineDiscovery: item.fixedBaseline.executions.findIndex((execution: any) => execution.matchedExpected) + 1 || null,
      })),
      modelTokenUsage: caseResults.flatMap((item: any) => item.scientist.modelExchanges.map((exchange: any, index: number) => ({
        caseId: item.id,
        call: index + 1,
        inputTokens: exchange.response?.usage?.inputTokens ?? null,
        outputTokens: exchange.response?.usage?.outputTokens ?? null,
        totalTokens: exchange.response?.usage?.totalTokens ?? null,
        error: exchange.response?.error ?? null,
      }))),
      measuredTokenTotals: caseResults.reduce((totals: any, item: any) => {
        for (const exchange of item.scientist.modelExchanges as any[]) {
          const usage = exchange.response?.usage;
          if (Number.isFinite(usage?.inputTokens)) totals.inputTokens += usage.inputTokens;
          if (Number.isFinite(usage?.outputTokens)) totals.outputTokens += usage.outputTokens;
          if (Number.isFinite(usage?.totalTokens)) totals.totalTokens += usage.totalTokens;
        }
        return totals;
      }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
      modelCostUsd: "Unavailable: provider pricing metadata was not returned.",
      byTrial: Array.from({ length: trialCount }, (_, index) => {
        const trialCases = caseResults.filter((item: any) => item.trial === index + 1);
        return {
          trial: index + 1,
          scientistConfirmed: trialCases.filter((item: any) => item.scientist.confirmedByAuditor).length,
          baselineConfirmed: trialCases.filter((item: any) => item.fixedBaseline.confirmedByAuditor).length,
          auditorProvenClaims: trialCases.reduce((sum: number, item: any) => sum + item.scientist.experiments.filter((experiment: any) =>
            experiment.provenRuleIds.some((ruleId: string) => invariantMatches(ruleId, experiment.hypothesis.expectedInvariant)),
          ).length, 0),
          negativeControlFalsePositive: trialCases.some((item: any) =>
            item.id === "case-negative-control" && item.scientist.experiments.some((experiment: any) =>
              experiment.claimStatus === "independent_proof_failed",
            ),
          ),
          inconclusiveCases: trialCases.filter((item: any) => item.scientist.status === "INCONCLUSIVE").length,
          unsupportedClaims: trialCases.reduce((sum: number, item: any) => sum + item.scientist.experiments.filter((experiment: any) => experiment.claimStatus === "independent_proof_failed").length, 0),
          unprovenHypotheses: trialCases.reduce((sum: number, item: any) => sum + item.scientist.experiments.filter((experiment: any) => experiment.claimStatus === "auditor_not_proven").length, 0),
          scientistExperiments: trialCases.reduce((sum: number, item: any) => sum + item.scientist.experimentsRun, 0),
          baselineExperiments: trialCases.reduce((sum: number, item: any) => sum + item.fixedBaseline.executions.length, 0),
        };
      }),
      measuredModelCalls: caseResults.reduce((total: number, item: any) => total + item.scientist.modelExchanges.length, 0),
      measuredModelLatencyMs: caseResults.map((item: any) => ({
        id: item.id,
        calls: item.scientist.modelExchanges.map((exchange: any) => exchange.durationMs ?? null),
      })),
    },
  };

  const outputPath = process.argv[2] || "phase5-benchmark-results.json";
  if (trialCount === 2) {
    try {
      const previous = JSON.parse(await readFile("phase7-real-model-results.json", "utf8"));
      const caseComparison = [];
      for (const testCase of blindCases) {
        for (let trial = 1; trial <= trialCount; trial++) {
          const before = previous.cases.find((item: any) => item.id === testCase.id && item.trial === trial);
          const after = caseResults.find((item: any) => item.id === testCase.id && item.trial === trial);
          if (!before || !after) continue;
          caseComparison.push({
            trial,
            caseId: testCase.id,
            phase7: {
              scientistConfirmed: before.scientist.confirmedByAuditor,
              baselineConfirmed: before.fixedBaseline.confirmedByAuditor,
              scientistStatus: before.scientist.status,
            },
            phase8: {
              scientistConfirmed: after.scientist.confirmedByAuditor,
              baselineConfirmed: after.fixedBaseline.confirmedByAuditor,
              scientistStatus: after.scientist.status,
            },
          });
        }
      }
      output.comparisonToPhase7 = {
        sourceReport: "phase7-real-model-results.json",
        sameCaseSeedsAndBudgets: true,
        cases: caseComparison,
        scientistConfirmedDelta: output.summary.scientistConfirmed - previous.summary.scientistConfirmed,
        baselineConfirmedDelta: output.summary.baselineConfirmed - previous.summary.baselineConfirmed,
      };
    } catch (error) {
      output.comparisonToPhase7 = {
        sourceReport: "phase7-real-model-results.json",
        unavailable: error instanceof Error ? error.message : String(error),
      };
    }
  
    try {
      const previous8 = JSON.parse(await readFile("phase8-real-model-results.json", "utf8"));
      const caseComparison8 = [];
      for (const testCase of blindCases) {
        for (let trial = 1; trial <= trialCount; trial++) {
          const before = previous8.cases.find((item: any) => item.id === testCase.id && item.trial === trial);
          const after = caseResults.find((item: any) => item.id === testCase.id && item.trial === trial);
          if (!before || !after) continue;
          caseComparison8.push({
            trial,
            caseId: testCase.id,
            phase8: {
              scientistConfirmed: before.scientist.confirmedByAuditor,
              baselineConfirmed: before.fixedBaseline.confirmedByAuditor,
              scientistStatus: before.scientist.status,
            },
            current: {
              scientistConfirmed: after.scientist.confirmedByAuditor,
              baselineConfirmed: after.fixedBaseline.confirmedByAuditor,
              scientistStatus: after.scientist.status,
            },
          });
        }
      }
      output.comparisonToPhase8 = {
        sourceReport: "phase8-real-model-results.json",
        sameCaseSeedsAndBudgets: true,
        cases: caseComparison8,
        scientistConfirmedDelta: output.summary.scientistConfirmed - previous8.summary.scientistConfirmed,
        baselineConfirmedDelta: output.summary.baselineConfirmed - previous8.summary.baselineConfirmed,
      };
    } catch (error) {
      output.comparisonToPhase8 = {
        sourceReport: "phase8-real-model-results.json",
        unavailable: error instanceof Error ? error.message : String(error),
      };
    }
}
  await writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ outputPath, summary: output.summary }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
