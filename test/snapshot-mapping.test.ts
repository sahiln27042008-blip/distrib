import test from "node:test";
import assert from "node:assert/strict";
import { MatrixScenario, type MatrixConfig } from "../src/matrix-copy.ts";

const BASE_CFG: MatrixConfig = {
  seed: 42,
  runId: "snapshot-mapping-test",
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

function snapshot() {
  const scenario = new MatrixScenario(BASE_CFG);
  scenario.run();
  return scenario.snapshot();
}

test("Snapshot has all required top-level fields", () => {
  const snap = snapshot();
  assert.ok(typeof snap.mode === "string");
  assert.ok(typeof snap.virtualTimeMs === "number");
  assert.ok(snap.dials);
  assert.ok(snap.db);
  assert.ok(snap.storage);
  assert.ok(snap.host);
  assert.ok(snap.context);
  assert.ok(snap.network);
  assert.ok(snap.security);
  assert.ok(snap.recovery);
  assert.ok(snap.economics);
  assert.ok(snap.totals);
});

test("Every required snapshot field is defined and numeric values are finite", () => {
  const snap = snapshot();
  const visit = (value: unknown, path: string): void => {
    assert.notEqual(value, undefined, `${path} is undefined`);
    assert.notEqual(value, null, `${path} is null`);
    if (typeof value === "number") assert.ok(Number.isFinite(value), `${path} is not finite: ${value}`);
    if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    else if (typeof value === "object") {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) visit(entry, `${path}.${key}`);
    }
  };
  visit(snap, "snapshot");
});

test("Measured snapshot values reflect pool, storage, LLM, payment, process, and checkpoint stats", () => {
  const db = snapshot();
  assert.ok(db.db.avgHoldMs >= 0);
  assert.ok(db.storage.bytesWritten >= 0);
  assert.ok(db.context.promptTokens > 0);
  assert.equal(db.network.duplicateDollars, 0);
  assert.equal(db.security.crashesFatal, 0);
  assert.ok(db.recovery.checkpointsWritten > 0);

  const hog = new MatrixScenario({ ...BASE_CFG, B: "B2_stream_hog_30s" });
  hog.run();
  assert.ok(hog.snapshot().db.avgHoldMs > 20000);

  const writeAmp = new MatrixScenario({ ...BASE_CFG, B: "B3_write_amp_15mb", F: "F1_blind_retry_unbounded_spend" });
  writeAmp.run();
  assert.ok(writeAmp.snapshot().storage.bytesWritten >= 15_000_000);

  const duplicate = new MatrixScenario({ ...BASE_CFG, C: "C2_socket_drop_2ms_late", F: "F1_blind_retry_unbounded_spend" });
  duplicate.run();
  assert.ok(duplicate.snapshot().network.duplicateDollars > 0);

  const fatal = new MatrixScenario({ ...BASE_CFG, E: "E1_god_mode_main_thread" });
  fatal.run();
  assert.ok(fatal.snapshot().security.crashesFatal >= 1);
});
