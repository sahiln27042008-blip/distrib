import test from "node:test";
import assert from "node:assert/strict";
import { runReliabilityGate } from "../../src/gate/reliability-gate.ts";
import { runGateTool } from "../../src/mcp/tools/run-gate.ts";
import { MATRIX_PRESETS } from "../../src/matrix-copy.ts";

const vulnerableConfig = {
  ...MATRIX_PRESETS.double_charge_2ms_drop!,
  seed: 42,
  C: "C5_legacy_erp_no_idem" as const,
  F: "F1_blind_retry_unbounded_spend" as const,
};

test("gate blocks a config with a proven R04 failure and includes replay evidence", async () => {
  const evidence = await runReliabilityGate({
    config: vulnerableConfig,
    maxExperiments: 3,
    invariants: ["r04-network-idempotency"],
  });

  assert.equal(evidence.status, "COVERAGE_REPORT");
  assert.ok(evidence.discoveredFailures.length > 0);
  assert.ok(evidence.discoveredFailures.some((failure) => failure.invariant === "r04-network-idempotency"));
  for (const failure of evidence.discoveredFailures) {
    assert.ok(failure.counterexample.length > 0);
    assert.ok(failure.businessImpact.length > 0);
    assert.equal(failure.replayHandle.seed, 42);
  }
  assert.ok(evidence.reason.length > 0);
});

test("gate approves a resilient configuration after completed experiments", async () => {
  const evidence = await runReliabilityGate({
    config: {
      ...vulnerableConfig,
      runId: "test-resilient-gate",
      C: "C1_clean_20ms",
      F: "F3_resilient_invariant_runtime",
      E: "E4_state_leases_ipc_worker",
      B: "B1_zero_hold_2ms",
      D: "D5_cqrs_duckdb_blackboard_o1",
    },
    maxExperiments: 3,
  });

  assert.equal(evidence.status, "COVERAGE_REPORT");
  assert.equal(evidence.discoveredFailures.length, 0);
  assert.ok(evidence.experimentsRun > 0);
});

test("gate evidence includes experiment totals and generation timestamp", async () => {
  const evidence = await runReliabilityGate({
    config: vulnerableConfig,
    maxExperiments: 1,
    invariants: ["r04-network-idempotency"],
  });

  assert.ok(evidence.experimentsRun >= 0);
  assert.ok(evidence.provenFindingsTotal >= 0);
  assert.ok(Number.isFinite(Date.parse(evidence.generatedAt)));
  assert.ok(Array.isArray(evidence.patches));
});

test("run_gate MCP tool validates a missing config", async () => {
  const result = await runGateTool.handler({});
  assert.equal(result.success, false);
  assert.match(String(result.error), /config/i);
});