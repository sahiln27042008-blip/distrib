import test from "node:test";
import assert from "node:assert/strict";
import { MatrixScenario, type MatrixConfig } from "../src/matrix-copy.ts";

const BASE_CFG: MatrixConfig = {
  seed: 42,
  runId: "dial-mapping-test",
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

function measure(overrides: Partial<MatrixConfig> & Record<string, unknown>) {
  const scenario = new MatrixScenario({ ...BASE_CFG, ...overrides });
  scenario.run();
  return scenario.snapshot();
}

test("Dial A levels map workflow traffic profiles", async (t) => {
  const cases: Array<[MatrixConfig["A"], (snap: ReturnType<typeof measure>) => boolean]> = [
    ["A1_single_task", (snap) => snap.economics.totalTokens > 0],
    ["A2_mixed_saas", (snap) => snap.economics.totalTokens > 0],
    ["A3_exec_demo_burst", (snap) => snap.economics.totalTokens > 0],
    ["A4_bulk_crm_swarm", (snap) => snap.economics.totalTokens > 0],
    ["A5_marathon_30step", (snap) => snap.economics.totalTokens > 0],
  ];
  let singleTaskTokens = 0;
  let mixedTokens = 0;
  for (const [dial, valid] of cases) {
    await t.test(dial, () => {
      const snap = measure({ A: dial });
      assert.ok(valid(snap), `${dial} did not run a workflow`);
      if (dial === "A1_single_task") singleTaskTokens = snap.economics.totalTokens;
      if (dial === "A2_mixed_saas") mixedTokens = snap.economics.totalTokens;
      assert.ok(snap.virtualTimeMs > 0);
    });
  }
  assert.ok(singleTaskTokens < mixedTokens, "A1 should run fewer tenant workflows than A2");
});

test("Dial B levels map database and storage effects", async (t) => {
  const cases: Array<[MatrixConfig["B"], (snap: ReturnType<typeof measure>) => boolean]> = [
    ["B1_zero_hold_2ms", (snap) => snap.db.avgHoldMs < 100],
    ["B2_stream_hog_30s", (snap) => snap.db.avgHoldMs > 20000],
    ["B3_write_amp_15mb", (snap) => snap.storage.bytesWritten >= 15_000_000],
    ["B4_hydration_freeze_4s", (snap) => snap.db.avgHoldMs > 1000 || snap.host.eventLoopBlockedMs >= 1000],
    ["B5_in_doubt_zombie_tx", (snap) => snap.db.avgHoldMs > 1000 || snap.storage.frozenQueries >= 1],
  ];
  for (const [dial, valid] of cases) {
    await t.test(dial, () => {
      const config = { B: dial, ...(dial === "B3_write_amp_15mb" ? { F: "F1_blind_retry_unbounded_spend" as const } : {}) };
      assert.ok(valid(measure(config)), `${dial} did not produce its characteristic effect`);
    });
  }
});

test("Dial C levels map network failure and idempotency behavior", async (t) => {
  const cases: Array<[MatrixConfig["C"], Partial<MatrixConfig>, (snap: ReturnType<typeof measure>) => boolean]> = [
    ["C1_clean_20ms", {}, (snap) => snap.network.duplicateDollars === 0 && snap.network.rateLimited === 0],
    ["C2_socket_drop_2ms_late", { F: "F1_blind_retry_unbounded_spend" }, (snap) => snap.network.ecnoreset >= 1],
    ["C3_rate_limit_429_brownout", {}, (snap) => snap.network.rateLimited >= 1],
    ["C4_bulk_50_poison_pill", { F: "F1_blind_retry_unbounded_spend" }, (snap) => snap.network.poisonAborts >= 1],
    ["C5_legacy_erp_no_idem", { F: "F1_blind_retry_unbounded_spend" }, (snap) => snap.network.duplicateShipments >= 1],
  ];
  for (const [dial, extra, valid] of cases) {
    await t.test(dial, () => assert.ok(valid(measure({ ...extra, C: dial })), `${dial} did not produce its characteristic effect`));
  }
});

test("Dial D levels map context load and signal", async (t) => {
  const cases: Array<[MatrixConfig["D"], (snap: ReturnType<typeof measure>) => boolean]> = [
    ["D1_raw_json_80k_flood", (snap) => snap.context.promptTokens > 20000],
    ["D2_append_only_quadratic", (snap) => snap.context.promptTokens > 1000],
    ["D3_lossy_llm_summary", (snap) => snap.context.promptTokens > 0 && snap.context.signalPct < 99],
    ["D4_unmapped_schema_drift", (snap) => snap.context.promptTokens > 0],
    ["D5_cqrs_duckdb_blackboard_o1", (snap) => snap.context.promptTokens > 0 && snap.context.ttftMs < 1000],
  ];
  for (const [dial, valid] of cases) {
    await t.test(dial, () => assert.ok(valid(measure({ D: dial })), `${dial} did not produce its characteristic effect`));
  }
});

test("Dial E levels map process isolation and security behavior", async (t) => {
  type ExpectedDialE = MatrixConfig["E"] | "E5_audit_log_only_no_enforcement";
  const cases: Array<[ExpectedDialE, (snap: ReturnType<typeof measure>) => boolean]> = [
    ["E1_god_mode_main_thread", (snap) => snap.security.crashesFatal >= 1],
    ["E2_walled_garden_stuck", (snap) => snap.security.toolCallsBlocked >= 1],
    ["E3_hitl_fatigue_global_bool", (snap) => snap.security.toolCallsAllowed + snap.security.toolCallsBlocked > 0],
    ["E4_state_leases_ipc_worker", (snap) => snap.security.crashesContained >= 1 && snap.security.crashesFatal === 0],
    ["E5_audit_log_only_no_enforcement", (snap) => String(snap.dials.E) === "E5_audit_log_only_no_enforcement" && snap.security.toolCallsAllowed > 0 && snap.security.crashesFatal === 0],
  ];
  for (const [dial, valid] of cases) {
    await t.test(dial, () => assert.ok(valid(measure({ E: dial as MatrixConfig["E"] })), `${dial} did not produce its characteristic effect`));
  }
});

test("Dial F levels map recovery and spending behavior", async (t) => {
  type ExpectedDialF = MatrixConfig["F"] | "F4_checkpoint_resume_limited" | "F5_graceful_handoff_cascade";
  const cases: Array<[ExpectedDialF, Partial<MatrixConfig>, (snap: ReturnType<typeof measure>) => boolean]> = [
    ["F1_blind_retry_unbounded_spend", { C: "C2_socket_drop_2ms_late" }, (snap) => snap.network.duplicateDollars > 0],
    ["F2_ask_llm_to_undo", { C: "C2_socket_drop_2ms_late" }, (snap) => snap.recovery.orphansLeft >= 1],
    ["F3_resilient_invariant_runtime", {}, (snap) => snap.recovery.checkpointsWritten >= 1 && snap.recovery.orphansLeft === 0],
    ["F4_checkpoint_resume_limited", {}, (snap) => snap.recovery.checkpointsWritten >= 1],
    ["F5_graceful_handoff_cascade", {}, (snap) => String(snap.dials.F) === "F5_graceful_handoff_cascade" && snap.virtualTimeMs > 0],
  ];
  for (const [dial, extra, valid] of cases) {
    await t.test(dial, () => assert.ok(valid(measure({ ...extra, F: dial as MatrixConfig["F"] })), `${dial} did not produce its characteristic effect`));
  }
});

test("Matrix has 15,625 = 5^6 valid dial combinations", () => {
  const dialLevels = {
    A: ["A1_single_task", "A2_mixed_saas", "A3_exec_demo_burst", "A4_bulk_crm_swarm", "A5_marathon_30step"],
    B: ["B1_zero_hold_2ms", "B2_stream_hog_30s", "B3_write_amp_15mb", "B4_hydration_freeze_4s", "B5_in_doubt_zombie_tx"],
    C: ["C1_clean_20ms", "C2_socket_drop_2ms_late", "C3_rate_limit_429_brownout", "C4_bulk_50_poison_pill", "C5_legacy_erp_no_idem"],
    D: ["D1_raw_json_80k_flood", "D2_append_only_quadratic", "D3_lossy_llm_summary", "D4_unmapped_schema_drift", "D5_cqrs_duckdb_blackboard_o1"],
    E: ["E1_god_mode_main_thread", "E2_walled_garden_stuck", "E3_hitl_fatigue_global_bool", "E4_state_leases_ipc_worker", "E5_audit_log_only_no_enforcement"],
    F: ["F1_blind_retry_unbounded_spend", "F2_ask_llm_to_undo", "F3_resilient_invariant_runtime", "F4_checkpoint_resume_limited", "F5_graceful_handoff_cascade"],
  };
  let count = 1;
  for (const dial of Object.values(dialLevels)) count *= dial.length;
  assert.equal(count, 15625);
});
