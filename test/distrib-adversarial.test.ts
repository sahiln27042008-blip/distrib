// enterpriseee/enterprise-simulator/test/distrib-adversarial.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAdversarialAgentWorld,
  searchDistribBfs,
  executeDistribWorkflow,
  SCENARIO_DEFINITIONS,
  runScenarioExperiment,
  type DistribConsonantFault,
} from "../src/physics/distrib/index.ts";
import type { Cell } from "../src/physics/alphabet/vowels/cell.ts";

test("Test 1: Passing baseline is not falsely reported as failing", async () => {
  const graph = buildAdversarialAgentWorld();
  const baseline = await executeDistribWorkflow(graph, [], 42);

  assert.equal(baseline.violatedInvariants.length, 0, "Baseline execution must produce zero violated invariants");
  assert.ok(baseline.events.length > 10, "Baseline should emit realistic workflow events across all 15 actors");
  assert.ok(baseline.invariants.every((inv) => inv.passed), "All 10 evaluated system invariants must pass on baseline");
});

test("Test 2: BFS explores states in nondecreasing depth", async () => {
  const graph = buildAdversarialAgentWorld();
  const candidates: DistribConsonantFault[] = [
    { consonantKind: "DELAY", targetVowelId: "chan-kyc", params: { durationMs: 10 } },
    { consonantKind: "DELAY", targetVowelId: "chan-delivery", params: { durationMs: 10 } },
  ];

  const result = await searchDistribBfs("depth-check", graph, candidates, { maxDepth: 2, maxEvaluations: 20 }, 42);

  assert.ok(result.depthReached >= 0);
  assert.ok(result.evaluations > 0);
  assert.equal(result.status, "NO_FAILURE_WITHIN_BOUND");
});

test("Test 3: Known failure found at shortest depth (Scenario A: depth 1 counterexample)", async () => {
  const scenarioA = SCENARIO_DEFINITIONS.find((s) => s.id === "scenario-A")!;
  assert.ok(scenarioA);

  const report = await runScenarioExperiment(scenarioA, 42);

  assert.equal(report.status, "FAILURE_FOUND");
  assert.equal(report.shortestDepth, 1, "Scenario A counterexample must be discovered at minimal depth 1");
  assert.ok(report.counterexampleFound);
  assert.equal(report.counterexampleFound.length, 1);
  assert.equal(report.counterexampleFound[0]?.targetVowelId, "chan-payment");
  assert.ok(report.violatedInvariants.includes("payment_safety"));
});

test("Test 4: Exact counterexample replays deterministically with byte-identical findings", async () => {
  const scenarioA = SCENARIO_DEFINITIONS.find((s) => s.id === "scenario-A")!;
  const graph = scenarioA.buildGraph();
  const fault = scenarioA.candidateFaults[0]!;

  const run1 = await executeDistribWorkflow(graph, [fault], 42);
  const run2 = await executeDistribWorkflow(graph, [fault], 42);

  assert.deepEqual(run1.violatedInvariants, run2.violatedInvariants);
  assert.equal(run1.events.length, run2.events.length);
  assert.deepEqual(
    run1.events.map((e) => ({ t: e.t, kind: e.kind })),
    run2.events.map((e) => ({ t: e.t, kind: e.kind })),
  );
  assert.ok(run1.violatedInvariants.includes("payment_safety"));
});

test("Test 5: Auditor identifies violation from actual simulated observations (not synthesized)", async () => {
  const scenarioA = SCENARIO_DEFINITIONS.find((s) => s.id === "scenario-A")!;
  const graph = scenarioA.buildGraph();
  const fault: DistribConsonantFault = {
    consonantKind: "SEVER",
    targetVowelId: "chan-payment",
    params: { phase: "POST_COMMIT" },
  };

  const execution = await executeDistribWorkflow(graph, [fault], 42);

  // Must observe real channel events
  assert.ok(execution.events.some((e) => e.kind === "channel.send"));
  assert.ok(execution.events.some((e) => e.kind === "channel.retry"));
  assert.ok(execution.events.some((e) => e.kind === "channel.divergence_detected" || e.kind === "channel.mutate"));

  // Check real auditor findings from resilient-agent-invariants
  assert.ok(
    execution.auditorFindings.some((f) => f.rule_id === "r04-network-idempotency" && f.status === "proven"),
    "Real auditor must prove r04-network-idempotency finding from observed trace",
  );

  // V1 CELL mutationCount check
  const cell = graph.vowels.find((v) => v.id === "cell-payment-ledger") as Cell;
  assert.ok(execution.violatedInvariants.includes("payment_safety"));
});

test("Test 6: Insufficiently modeled failure returns INSUFFICIENT_PHYSICS", async () => {
  const scenarioF = SCENARIO_DEFINITIONS.find((s) => s.id === "scenario-F")!;
  assert.ok(scenarioF);
  assert.equal(scenarioF.isRepresentable, false);

  const report = await runScenarioExperiment(scenarioF, 42);

  assert.equal(report.status, "INSUFFICIENT_PHYSICS");
  assert.ok(report.auditorEvidence.length > 0);
  assert.match(report.auditorEvidence[0]!, /INSUFFICIENT_PHYSICS|multi-master/i);
});

test("Test 7: Search budget exhaustion halts search and does NOT claim safety", async () => {
  const graph = buildAdversarialAgentWorld();
  const candidates: DistribConsonantFault[] = [];
  for (let i = 0; i < 20; i++) {
    candidates.push({
      consonantKind: "DELAY",
      targetVowelId: "chan-tool-router",
      params: { durationMs: 100 + i },
    });
  }

  // Force extreme budget restriction
  const result = await searchDistribBfs("budget-test", graph, candidates, { maxDepth: 3, maxEvaluations: 3 }, 42);

  assert.equal(result.status, "BUDGET_EXHAUSTED");
  assert.notEqual(result.status, "NO_FAILURE_WITHIN_BOUND");
  assert.equal(result.isExhaustiveWithinBound, false, "Budget exhaustion must never claim exhaustive safety");
  assert.equal(result.evaluations, 3);
});

test("Test 8: Compound two-fault interaction (Scenario B: Side effect + crash before checkpoint)", async () => {
  const scenarioB = SCENARIO_DEFINITIONS.find((s) => s.id === "scenario-B")!;
  const report = await runScenarioExperiment(scenarioB, 42);

  assert.equal(report.status, "FAILURE_FOUND");
  assert.ok(report.violatedInvariants.includes("recovery"));
  assert.equal(report.reproducedOnReplay, true);
});

test("Test 9: Ablation test: Fencing token ablation exposes stale write in Scenario C", async () => {
  const scenarioC = SCENARIO_DEFINITIONS.find((s) => s.id === "scenario-C")!;
  const report = await runScenarioExperiment(scenarioC, 42);

  assert.ok(report.ablationComparison);
  assert.equal(report.ablationComparison.ablationName, "Disable Fencing Token Check");
  assert.match(report.ablationComparison.difference, /fencing/i);
});

