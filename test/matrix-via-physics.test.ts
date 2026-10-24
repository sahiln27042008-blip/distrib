import test from "node:test";
import assert from "node:assert/strict";
import { MatrixScenario, type MatrixConfig } from "../src/matrix-copy.ts";

const BASE_CFG: MatrixConfig = {
  seed: 42,
  runId: "matrix-via-physics-test",
  A: "A2_mixed_saas",
  B: "B1_zero_hold_2ms",
  C: "C1_clean_20ms",
  D: "D5_cqrs_duckdb_blackboard_o1",
  E: "E4_state_leases_ipc_worker",
  F: "F3_resilient_invariant_runtime",
  humanUsers: 200,
  concurrentAgents: 10,
  dbPoolSize: 20,
  workflowSteps: 10,
  saasPriceUsd: 20,
  ticketValueUsd: 5,
};

function run(config: MatrixConfig) {
  const scenario = new MatrixScenario(config);
  scenario.run();
  return scenario.snapshot();
}

test("10 representative configs produce non-zero measured values", () => {
  const configs: MatrixConfig[] = [
    { ...BASE_CFG, A: "A2_mixed_saas", B: "B2_stream_hog_30s" },
    { ...BASE_CFG, B: "B1_zero_hold_2ms" },
    { ...BASE_CFG, C: "C5_legacy_erp_no_idem", F: "F1_blind_retry_unbounded_spend" },
    { ...BASE_CFG, C: "C1_clean_20ms", F: "F3_resilient_invariant_runtime" },
    { ...BASE_CFG, D: "D1_raw_json_80k_flood" },
    { ...BASE_CFG, D: "D5_cqrs_duckdb_blackboard_o1" },
    { ...BASE_CFG, E: "E1_god_mode_main_thread" },
    { ...BASE_CFG, E: "E4_state_leases_ipc_worker" },
    { ...BASE_CFG, B: "B3_write_amp_15mb" },
    { ...BASE_CFG, F: "F5_graceful_handoff_cascade" as MatrixConfig["F"] },
  ];

  for (const config of configs) {
    const snap = run(config);
    assert.ok(snap.virtualTimeMs > 0, `virtualTimeMs for ${config.B}/${config.C}`);
    assert.ok(snap.economics.totalTokens > 0, `totalTokens for ${config.D}`);
  }
});

test("B2 stream_hog produces materially higher avgHoldMs than B1", () => {
  const hog = run({ ...BASE_CFG, B: "B2_stream_hog_30s" });
  const zero = run({ ...BASE_CFG, B: "B1_zero_hold_2ms" });
  assert.ok(hog.db.avgHoldMs > zero.db.avgHoldMs * 100);
});

test("C2 socket drop plus F1 blind_retry produces duplicate dollars", () => {
  const snap = run({ ...BASE_CFG, C: "C2_socket_drop_2ms_late", F: "F1_blind_retry_unbounded_spend" });
  assert.ok(snap.network.duplicateDollars > 0);
});

test("C1 clean plus F3 resilient produces zero duplicate dollars", () => {
  const snap = run({ ...BASE_CFG, C: "C1_clean_20ms", F: "F3_resilient_invariant_runtime" });
  assert.equal(snap.network.duplicateDollars, 0);
});
