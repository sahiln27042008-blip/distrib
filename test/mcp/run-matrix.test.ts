import test from "node:test";
import assert from "node:assert/strict";
import { runMatrixTool } from "../../src/mcp/tools/run-matrix.ts";
import { MATRIX_PRESETS, type MatrixConfig, type MatrixSnapshot } from "../../src/matrix-copy.ts";

test("run_matrix with valid config returns snapshot + trace", async () => {
  const config: MatrixConfig = {
    seed: 42,
    runId: "test-run-valid",
    A: "A1_single_task",
    B: "B1_zero_hold_2ms",
    C: "C1_clean_20ms",
    D: "D5_cqrs_duckdb_blackboard_o1",
    E: "E4_state_leases_ipc_worker",
    F: "F3_resilient_invariant_runtime",
    humanUsers: 10,
    concurrentAgents: 2,
    dbPoolSize: 10,
    workflowSteps: 5,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  };

  const res = await runMatrixTool.handler({ config });

  assert.equal(res.success, true);
  assert.ok(res.snapshot);
  assert.ok(res.trace);
  assert.ok(typeof res.traceId === "string");
  assert.ok(typeof res.virtualTimeMs === "number");
  assert.equal(res.life, "finished");
});

test("run_matrix with the login_freeze_db_hog preset produces non-zero virtualTimeMs", async () => {
  const preset = MATRIX_PRESETS.login_freeze_db_hog!;
  const res = await runMatrixTool.handler({ config: preset });

  assert.equal(res.success, true);
  assert.ok((res.virtualTimeMs as number) > 0);
  const snap = res.snapshot as MatrixSnapshot;
  assert.ok(snap.virtualTimeMs > 0);
});

test("run_matrix is deterministic — same config twice → deepEqual snapshot", async () => {
  const config: MatrixConfig = {
    seed: 12345,
    runId: "determinism-test",
    A: "A2_mixed_saas",
    B: "B1_zero_hold_2ms",
    C: "C1_clean_20ms",
    D: "D5_cqrs_duckdb_blackboard_o1",
    E: "E4_state_leases_ipc_worker",
    F: "F3_resilient_invariant_runtime",
    humanUsers: 20,
    concurrentAgents: 5,
    dbPoolSize: 10,
    workflowSteps: 5,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  };

  const res1 = await runMatrixTool.handler({ config });
  const res2 = await runMatrixTool.handler({ config });

  assert.equal(res1.success, true);
  assert.equal(res2.success, true);
  assert.deepEqual(res1.snapshot, res2.snapshot);
  assert.equal(JSON.stringify(res1.snapshot), JSON.stringify(res2.snapshot));
});

test("run_matrix with missing dials returns error", async () => {
  const incompleteConfig = {
    A: "A1_single_task",
    B: "B1_zero_hold_2ms",
    // C, D, E, F missing
  };

  const res = await runMatrixTool.handler({ config: incompleteConfig });
  assert.equal(res.success, false);
  assert.match(String(res.error), /config with all 6 dials is required/i);

  const noConfigRes = await runMatrixTool.handler({});
  assert.equal(noConfigRes.success, false);
  assert.match(String(noConfigRes.error), /config with all 6 dials is required/i);
});

test("run_matrix with C5+F1 produces duplicateDollars > 0", async () => {
  // C2 triggers socket drops leading to F1 non-idempotent payment retries ($500 duplicateDollars).
  // C5 triggers ERP batch tool duplicate shipments. Both demonstrate network duplicate vulnerabilities.
  const configC2: MatrixConfig = {
    seed: 42,
    runId: "test-duplicate-dollars",
    A: "A2_mixed_saas",
    B: "B1_zero_hold_2ms",
    C: "C2_socket_drop_2ms_late",
    D: "D5_cqrs_duckdb_blackboard_o1",
    E: "E4_state_leases_ipc_worker",
    F: "F1_blind_retry_unbounded_spend",
    humanUsers: 20,
    concurrentAgents: 5,
    dbPoolSize: 20,
    workflowSteps: 5,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  };

  const resC2 = await runMatrixTool.handler({ config: configC2 });
  assert.equal(resC2.success, true);
  const snapC2 = resC2.snapshot as MatrixSnapshot;
  assert.ok(snapC2.totals.duplicateDollars > 0, `Expected duplicateDollars > 0, got ${snapC2.totals.duplicateDollars}`);
  assert.ok(snapC2.network.duplicateDollars > 0);

  const configC5: MatrixConfig = {
    ...configC2,
    C: "C5_legacy_erp_no_idem",
  };
  const resC5 = await runMatrixTool.handler({ config: configC5 });
  assert.equal(resC5.success, true);
  const snapC5 = resC5.snapshot as MatrixSnapshot;
  assert.ok(snapC5.network.duplicateShipments >= 1);
});
