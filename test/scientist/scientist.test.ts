import test from "node:test";
import assert from "node:assert/strict";
import { runScientist } from "../../src/scientist/discovery-loop.ts";
import type { ScientistConfig } from "../../src/scientist/types.ts";
import { MATRIX_PRESETS, type MatrixConfig } from "../../src/matrix-copy.ts";
import { runScientistTool } from "../../src/mcp/tools/run-scientist.ts";

const BASE_CONFIG: MatrixConfig = {
  ...MATRIX_PRESETS.double_charge_2ms_drop!,
  C: "C5_legacy_erp_no_idem",
  seed: 42,
};

function testOnlyHypothesisModel(expectedInvariant: string, empty = false) {
  return {
    async chat() {
      const hypotheses = empty ? [] : [{
        description: "Test fixture: provoke a deterministic payment retry and inspect auditor evidence.",
        rationale: "A lost response followed by a duplicate request distinguishes retry ambiguity from a clean single-attempt path.",
        interventions: expectedInvariant.startsWith("r05")
          ? ["partial_failure", "lose_state"]
          : ["missing_idempotency_key", "drop_response", "duplicate_request"],
        expectedInvariant,
        confidence: 0.75,
      }];
      return { text: JSON.stringify(hypotheses), tool_calls: [], stop_reason: "stop" as const };
    },
  };
}

function runWithTestModel(config: ScientistConfig) {
  return runScientist({
    ...config,
    orchestrator: config.orchestrator ?? testOnlyHypothesisModel(config.invariants[0] ?? "r04-network-idempotency"),
  });
}

test("Scientist discovers R04 failure on C5+F1 config", async () => {
  const config: ScientistConfig = {
    baseConfig: BASE_CONFIG,
    maxExperiments: 5,
    maxSteps: 10000,
    invariants: ["r04-network-idempotency"],
  };

  const result = await runWithTestModel(config);
  assert.ok(result.experimentsRun > 0);
  assert.equal(result.status, "FAILURE_FOUND");
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

  const result = await runWithTestModel(config);
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

  const result = await runWithTestModel(config);
  assert.ok(result.hypothesesGenerated > 0);
});

test("Scientist returns replay handle for each failure", async () => {
  const config: ScientistConfig = {
    baseConfig: BASE_CONFIG,
    maxExperiments: 5,
    maxSteps: 10000,
    invariants: ["r04-network-idempotency"],
  };

  const result = await runWithTestModel(config);
  for (const failure of result.discoveredFailures) {
    assert.ok(failure.replayHandle.seed);
    assert.ok(failure.replayHandle.config.A);
  }
});

test("Scientist with resilient config discovers fewer failures", async () => {
  const resilientConfig: MatrixConfig = {
    ...BASE_CONFIG,
    C: "C1_clean_20ms",
    F: "F3_resilient_invariant_runtime",
    E: "E4_state_leases_ipc_worker",
    B: "B1_zero_hold_2ms",
    D: "D5_cqrs_duckdb_blackboard_o1",
  };

  const result = await runScientist({
    orchestrator: testOnlyHypothesisModel("r04-network-idempotency", true),
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

test("Scientist reports INCONCLUSIVE when proven evidence contradicts the hypothesis", async () => {
  const result = await runWithTestModel({
    baseConfig: {
      ...BASE_CONFIG,
      C: "C5_legacy_erp_no_idem",
      F: "F1_blind_retry_unbounded_spend",
    },
    maxExperiments: 3,
    maxSteps: 10000,
    invariants: ["r10-unit-economics"],
  });

  assert.equal(result.status, "INCONCLUSIVE");
  assert.ok(result.provenFindingsTotal > 0);
  assert.equal(result.discoveredFailures.length, 0);
  assert.match(result.inconclusiveReasons.join(" "), /did not match its hypothesis/i);
});

test("Scientist reports INCONCLUSIVE for orphan metrics without proven saga evidence", async () => {
  const result = await runScientist({
    baseConfig: {
      ...MATRIX_PRESETS.split_brain_orphan_aws!,
      runId: "opaque-saga-control",
      seed: 73,
      F: "F2_ask_llm_to_undo",
      E: "E1_god_mode_main_thread",
    },
    maxExperiments: 4,
    maxSteps: 10000,
    invariants: ["r05-distributed-sagas"],
  });

  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.discoveredFailures.length, 0);
  assert.ok(result.inconclusiveReasons.length > 0);
});

test("Scientist reports INCONCLUSIVE when no hypotheses are generated", async () => {
  const result = await runScientist({
    baseConfig: {
      ...BASE_CONFIG,
      C: "C1_clean_20ms",
      F: "F3_resilient_invariant_runtime",
      E: "E4_state_leases_ipc_worker",
      B: "B1_zero_hold_2ms",
      D: "D5_cqrs_duckdb_blackboard_o1",
    },
    maxExperiments: 4,
    maxSteps: 10000,
    invariants: ["r04-network-idempotency", "r05-distributed-sagas", "r10-unit-economics"],
    orchestrator: testOnlyHypothesisModel("r04-network-idempotency", true),
  });

  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.experimentsRun, 0);
  assert.match(result.inconclusiveReasons.join(" "), /no hypotheses were generated/i);
});

test("Scientist fails closed for model timeout and malformed hypothesis output", async () => {
  const base = {
    baseConfig: BASE_CONFIG,
    maxExperiments: 2,
    maxSteps: 10000,
    invariants: ["r04-network-idempotency"],
  };

  const timeout = await runScientist({
    ...base,
    orchestrator: {
      async chat() { throw new Error("model timeout"); },
    },
  });
  assert.equal(timeout.status, "INCONCLUSIVE");
  assert.equal(timeout.experimentsRun, 0);
  assert.match(timeout.inconclusiveReasons.join(" "), /model timeout/i);

  const malformed = await runScientist({
    ...base,
    orchestrator: {
      async chat() { return { text: "not json", tool_calls: [], stop_reason: "stop" }; },
    },
  });
  assert.equal(malformed.status, "INCONCLUSIVE");
  assert.equal(malformed.experimentsRun, 0);
  assert.match(malformed.inconclusiveReasons.join(" "), /malformed hypothesis output/i);
});

test("blind Scientist prompt withholds dial values and includes supplied description", async () => {
  let promptText = "";
  const result = await runScientist({
    baseConfig: BASE_CONFIG,
    maxExperiments: 1,
    maxSteps: 10000,
    invariants: ["r04-network-idempotency"],
    systemDescription: "A payment worker retries after a timeout.",
    includeConfigurationInPrompt: false,
    orchestrator: {
      async chat(messages) {
        promptText = JSON.stringify(messages);
        return { text: "[]", tool_calls: [], stop_reason: "stop" };
      },
    },
  });

  assert.equal(result.status, "INCONCLUSIVE");
  assert.match(promptText, /A payment worker retries after a timeout/);
  assert.ok(promptText.includes("expectedInvariant"));
  assert.ok(promptText.includes("missing_idempotency_key"));
  assert.doesNotMatch(promptText, /C5_legacy_erp_no_idem|C1_clean_20ms|\"A\":\"A2_mixed_saas\"/);
});

test("Scientist rejects free-form intervention descriptions from the model", async () => {
  const result = await runScientist({
    baseConfig: BASE_CONFIG,
    maxExperiments: 1,
    maxSteps: 10000,
    invariants: ["r04-network-idempotency"],
    orchestrator: {
      async chat() {
        return {
          text: JSON.stringify([{
            description: "A retry after a lost payment response may duplicate a side effect.",
            rationale: "This distinguishes retry ambiguity from a single successful request.",
            expectedInvariant: "r04-network-idempotency",
            interventions: ["Inject network timeout on first payment request"],
            confidence: 0.8,
          }]),
          tool_calls: [],
          stop_reason: "stop",
        };
      },
    },
  });

  assert.equal(result.status, "INCONCLUSIVE");
  assert.equal(result.experimentsRun, 0);
  assert.match(result.inconclusiveReasons.join(" "), /unsupported interventions/i);
});

test("Scientist does not create a control failure by downgrading protected dials", async () => {
  let calls = 0;
  const result = await runScientist({
    baseConfig: {
      seed: 812,
      runId: "minimized-control-regression",
      A: "A1_single_task",
      B: "B1_zero_hold_2ms",
      C: "C1_clean_20ms",
      D: "D5_cqrs_duckdb_blackboard_o1",
      E: "E4_state_leases_ipc_worker",
      F: "F3_resilient_invariant_runtime",
      humanUsers: 3,
      concurrentAgents: 1,
      dbPoolSize: 4,
      workflowSteps: 2,
      saasPriceUsd: 30,
      ticketValueUsd: 20,
    },
    maxExperiments: 2,
    maxSteps: 10000,
    invariants: ["r04-network-idempotency"],
    orchestrator: {
      async chat() {
        calls++;
        return {
          text: JSON.stringify(calls === 1 ? [{
            description: "Injected retry faults may expose an idempotency violation.",
            rationale: "This tests whether the combined injected faults yield a durable auditor counterexample.",
            expectedInvariant: "r04-network-idempotency",
            interventions: ["lose_state", "missing_idempotency_key"],
            confidence: 0.9,
          }] : []),
          tool_calls: [],
          stop_reason: "stop",
        };
      },
    },
  });

  assert.equal(result.experimentLog[0]?.result.config.C, "C1_clean_20ms");
  assert.equal(result.experimentLog[0]?.result.config.F, "F3_resilient_invariant_runtime");
  assert.deepEqual(result.experimentLog[0]?.result.config.injectedInterventions, ["missing_idempotency_key"]);
  assert.equal(result.experimentLog[0]?.result.provenFindings.some(
    (finding) => finding.rule_id === "r04-network-idempotency",
  ), false);
  assert.equal(result.discoveredFailures.length, 0);
  assert.equal(result.status, "INCONCLUSIVE");
});

test("adaptive Scientist supplies prior auditor evidence to next model selection", async () => {
  const prompts: string[] = [];
  let calls = 0;
  const result = await runScientist({
    baseConfig: BASE_CONFIG,
    maxExperiments: 2,
    maxSteps: 10000,
    invariants: ["r04-network-idempotency"],
    orchestrator: {
      async chat(messages) {
        prompts.push(JSON.stringify(messages));
        calls++;
        if (calls === 1) {
          return {
            text: JSON.stringify([{
              description: "Test fixture: lost payment acknowledgment followed by retry.",
              rationale: "This sequence tests whether retrying after a lost acknowledgment duplicates a committed side effect.",
              interventions: ["missing_idempotency_key", "drop_response", "duplicate_request"],
              expectedInvariant: "r04-network-idempotency",
              confidence: 0.8,
            }]),
            tool_calls: [],
            stop_reason: "stop",
          };
        }
        return { text: "[]", tool_calls: [], stop_reason: "stop" };
      },
    },
  });

  assert.equal(result.status, "FAILURE_FOUND");
  assert.equal(result.experimentsRun, 1);
  assert.equal(calls, 2);
  assert.match(prompts[1]!, /Prior experiment evidence/);
  assert.match(prompts[1]!, /r04-network-idempotency/);
});

test("Scientist business impact includes duplicate dollars when present", async () => {
  const result = await runWithTestModel({
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
  assert.equal(toolRes.status, "INCONCLUSIVE");
  assert.equal(toolRes.experimentsRun, 0);
  assert.ok(Array.isArray(toolRes.failures));
});

test("run_scientist MCP tool validates missing config", async () => {
  const toolRes = await runScientistTool.handler({});
  assert.equal(toolRes.success, false);
  assert.match(String(toolRes.error), /config/i);
});

