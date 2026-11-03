import test from "node:test";
import assert from "node:assert/strict";
import {
  composeSequence,
  configToInterventions,
  INTERVENTIONS,
  interventionsToConfig,
  KNOWN_FAILURE_SEQUENCES,
  type Intervention,
} from "../../src/interventions/index.ts";
import type { MatrixConfig } from "../../src/matrix-copy.ts";

const BASE_CONFIG: MatrixConfig = {
  seed: 42,
  runId: "interventions-test",
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

test("defines all 16 intervention types", () => {
  assert.equal(Object.keys(INTERVENTIONS).length, 16);
});

test("defines three known failure sequences", () => {
  assert.equal(KNOWN_FAILURE_SEQUENCES.length, 3);
  assert.deepEqual(
    KNOWN_FAILURE_SEQUENCES.map((sequence) => sequence.id),
    ["double-charge-classic", "orphaned-resource", "budget-burn"],
  );
});

test("double-charge-classic preserves resilient idempotency and recovery dials", () => {
  const sequence = KNOWN_FAILURE_SEQUENCES.find((item) => item.id === "double-charge-classic");
  assert.ok(sequence);
  const config = interventionsToConfig(BASE_CONFIG, sequence.interventions);
  assert.equal(config.C, "C2_socket_drop_2ms_late");
  assert.equal(config.E, "E4_state_leases_ipc_worker");
  assert.equal(config.F, "F3_resilient_invariant_runtime");
});

test("missing-key intervention does not replace the configured payment policy", () => {
  const mapped = interventionsToConfig(BASE_CONFIG, [INTERVENTIONS.missing_idempotency_key]);
  assert.equal(
    mapped.C,
    "C1_clean_20ms",
  );
  assert.deepEqual(mapped.injectedInterventions, ["missing_idempotency_key"]);
});

test("state-loss and duplicate interventions preserve resilient recovery", () => {
  for (const intervention of [INTERVENTIONS.lose_state, INTERVENTIONS.duplicate_request]) {
    assert.equal(
      interventionsToConfig(BASE_CONFIG, [intervention]).F,
      "F3_resilient_invariant_runtime",
    );
  }
});

test("maps dropped response to C2", () => {
  assert.equal(
    interventionsToConfig(BASE_CONFIG, [INTERVENTIONS.drop_response]).C,
    "C2_socket_drop_2ms_late",
  );
});

test("maps worker failure to E1 when isolation is not enabled", () => {
  const config = interventionsToConfig(
    { ...BASE_CONFIG, E: "E3_hitl_fatigue_global_bool" },
    [INTERVENTIONS.kill_worker],
  );
  assert.equal(config.E, "E1_god_mode_main_thread");
});

test("maps context bloat to D1", () => {
  assert.equal(
    interventionsToConfig(BASE_CONFIG, [INTERVENTIONS.context_bloat]).D,
    "D1_raw_json_80k_flood",
  );
});

test("composes interventions without replacing the configured payment policy", () => {
  const config = interventionsToConfig(BASE_CONFIG, [
    INTERVENTIONS.missing_idempotency_key,
    INTERVENTIONS.rate_limit,
    INTERVENTIONS.context_bloat,
    INTERVENTIONS.write_amplification,
  ]);
  assert.equal(config.C, "C3_rate_limit_429_brownout");
  assert.equal(config.D, "D1_raw_json_80k_flood");
  assert.equal(config.B, "B3_write_amp_15mb");
  assert.match(config.runId, /^experiment-\d+$/);
});

test("reverse-maps C5 and C2 payment dials", () => {
  assert.ok(configToInterventions({ ...BASE_CONFIG, C: "C5_legacy_erp_no_idem" }).includes("missing_idempotency_key"));
  assert.ok(configToInterventions({ ...BASE_CONFIG, C: "C2_socket_drop_2ms_late" }).includes("drop_response"));
});

test("reverse-maps only interventions represented by the effective dials", () => {
  const sequence = KNOWN_FAILURE_SEQUENCES.find((item) => item.id === "double-charge-classic");
  assert.ok(sequence);
  const config = interventionsToConfig(
    { ...BASE_CONFIG, E: "E1_god_mode_main_thread" },
    sequence.interventions,
  );
  const inferred = configToInterventions(config);
  assert.ok(inferred.includes("missing_idempotency_key"));
  assert.ok(inferred.includes("kill_worker"));
  assert.ok(!inferred.includes("duplicate_request"));
  assert.ok(!inferred.includes("lose_state"));
});

test("composeSequence generates unique ids and stores hypothesis metadata", () => {
  const intervention: Intervention = INTERVENTIONS.drop_response;
  const first = composeSequence([intervention], "Response is lost", "r04-network-idempotency");
  const second = composeSequence([intervention], "Response is lost");

  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.interventions, [intervention]);
  assert.equal(first.hypothesis, "Response is lost");
  assert.equal(first.expectedInvariant, "r04-network-idempotency");
  assert.equal(second.expectedInvariant, undefined);
});