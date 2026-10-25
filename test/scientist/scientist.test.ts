import test from "node:test";
import assert from "node:assert/strict";
import { runScientist } from "../../src/scientist/discovery-loop.ts";
import type { ScientistConfig } from "../../src/scientist/types.ts";
import { MATRIX_PRESETS } from "../../src/matrix-copy.ts";
import { runScientistTool } from "../../src/mcp/tools/run-scientist.ts";

const BASE_CONFIG = {
  ...MATRIX_PRESETS.double_charge_2ms_drop,
  seed: 42,
};

test("Scientist discovers R04 failure on C5+F1 config", async () => {
  const config: ScientistConfig = {
    baseConfig: BASE_CONFIG,
    maxExperiments: 5,
    maxSteps: 10000,
    invariants: ["r04-network-idempotency"],
  };

  const result = await runScientist(config);
  assert.ok(result.experimentsRun > 0);
  assert.ok(result.discoveredFailures.length > 0);
  const r04Failure = result.discoveredFailures.find(
    (f) => f.hypothesis.expectedInvariant === "r04-network-idempotency",
  );
  assert.ok(r04Failure, "Should discover R04 failure");
  assert.ok(r04Failure.experiment.provenFindings.length > 0);
  assert.ok(r04Failure.businessImpact.includes("duplicate"));
});

test("Scientist respects experiment budget", async () => {
  const config: ScientistConfig = {
    baseConfig: BASE_CONFIG,
    maxExperiments: 2,
    maxSteps: 10000,
    invariants: [
      "r04-network-idempotency",
      "r05-distributed-sagas",
    ],
  };

  const result = await runScientist(config);
  assert.ok(result.experimentsRun <= 2);
});

test("Scientist generates hypotheses from world model", async () => {
  const config: ScientistConfig = {
    baseConfig: {
      ...BASE_CONFIG,
      C: "C5_legacy_erp_no_idem",
      F: "F1_blind_retry_unbounded_spend",
    },
    maxExperiments: 3,
    maxSteps: 10000,
    invariants: [
      "r04-network-idempotency",
      "r10-unit-economics",
    ],
  };

  const result = await runScientist(config);
  assert.ok(result.hypothesesGenerated > 0);
});

test("Scientist returns replay handle for each failure", async () => {
  const config: ScientistConfig = {
    baseConfig: BASE_CONFIG,
    maxExperiments: 5,
    maxSteps: 10000,
    invariants: ["r04-network-idempotency"],
  };

  const result = await runScientist(config);
  for (const failure of result.discoveredFailures) {
    assert.ok(failure.replayHandle.seed);
    assert.ok(failure.replayHandle.config.A);
  }
});

test("Scientist with resilient config discovers fewer failures", async () => {
  const resilientConfig = {
    ...BASE_CONFIG,
    C: "C1_clean_20ms",
    F: "F3_resilient_invariant_runtime",
    E: "E4_state_leases_ipc_worker",
    B: "B1_zero_hold_2ms",
    D: "D5_cqrs_duckdb_blackboard_o1",
  };

  const result = await runScientist({
    baseConfig: resilientConfig,
    maxExperiments: 5,
    maxSteps: 10000,
    invariants: [
      "r04-network-idempotency",
      "r05-distributed-sagas",
      "r10-unit-economics",
    ],
  });

  // Resilient config should produce fewer or zero
  // discovered failures
  const r04Failures = result.discoveredFailures.filter(
    (f) => f.hypothesis.expectedInvariant === "r04-network-idempotency",
  );
  assert.equal(
    r04Failures.length,
    0,
    "Resilient config should not produce R04 failures",
  );
});

test("Scientist business impact includes duplicate dollars when present", async () => {
  const result = await runScientist({
    baseConfig: {
      ...BASE_CONFIG,
      C: "C5_legacy_erp_no_idem",
      F: "F1_blind_retry_unbounded_spend",
    },
    maxExperiments: 3,
    maxSteps: 10000,
    invariants: ["r04-network-idempotency"],
  });

  for (const failure of result.discoveredFailures) {
    if (failure.experiment.duplicateDollars && failure.experiment.duplicateDollars > 0) {
      assert.ok(failure.businessImpact.includes("$"));
    }
  }
});

test("run_scientist MCP tool discovers failures and returns structured results", async () => {
  const toolRes = await runScientistTool.handler({
    config: {
      ...BASE_CONFIG,
      C: "C5_legacy_erp_no_idem",
      F: "F1_blind_retry_unbounded_spend",
    },
    maxExperiments: 3,
    invariants: ["r04-network-idempotency"],
  });

  assert.equal(toolRes.success, true);
  assert.ok(typeof toolRes.experimentsRun === "number");
  assert.ok(typeof toolRes.hypothesesGenerated === "number");
  assert.ok((toolRes.discoveredFailures as number) > 0);
  assert.ok(Array.isArray(toolRes.failures));
});

test("run_scientist MCP tool validates missing config", async () => {
  const toolRes = await runScientistTool.handler({});
  assert.equal(toolRes.success, false);
  assert.match(String(toolRes.error), /config/i);
});

