import test from "node:test";
import assert from "node:assert/strict";
import { replayTool } from "../../src/mcp/tools/replay.ts";
import { MATRIX_PRESETS, type MatrixConfig, type MatrixSnapshot } from "../../src/matrix-copy.ts";

test("replay with config returns snapshot + trace + findings", async () => {
  const preset = MATRIX_PRESETS.login_freeze_db_hog!;
  const res = await replayTool.handler({ config: preset });

  assert.equal(res.success, true);
  assert.ok(res.handle, "handle must be present");
  assert.ok(typeof res.handle === "string");
  assert.ok(res.snapshot, "snapshot must be present");
  assert.ok(typeof res.traceId === "string");
  assert.ok(Array.isArray(res.findings));
  assert.ok(typeof res.findingsCount === "number");
});

test("replay with handle string reproduces the same result", async () => {
  const preset = MATRIX_PRESETS.double_charge_2ms_drop!;
  const firstRes = await replayTool.handler({ config: preset });
  assert.equal(firstRes.success, true);
  const handleString = firstRes.handle as string;

  const secondRes = await replayTool.handler({ handle: handleString });
  assert.equal(secondRes.success, true);

  assert.deepEqual(firstRes.snapshot, secondRes.snapshot);
  assert.equal(firstRes.traceId, secondRes.traceId);
});

test("replay is deterministic", async () => {
  const config: MatrixConfig = {
    seed: 9999,
    runId: "determinism-check",
    A: "A2_mixed_saas",
    B: "B1_zero_hold_2ms",
    C: "C1_clean_20ms",
    D: "D5_cqrs_duckdb_blackboard_o1",
    E: "E4_state_leases_ipc_worker",
    F: "F3_resilient_invariant_runtime",
    humanUsers: 30,
    concurrentAgents: 5,
    dbPoolSize: 10,
    workflowSteps: 5,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  };

  const run1 = await replayTool.handler({ config });
  const run2 = await replayTool.handler({ config });

  assert.equal(run1.success, true);
  assert.equal(run2.success, true);
  assert.deepEqual(run1.snapshot, run2.snapshot);
});

test("replay with neither handle nor config returns error", async () => {
  const res = await replayTool.handler({});
  assert.equal(res.success, false);
  assert.match(String(res.error), /Either handle or config is required/i);
});

test("replay with invalid handle returns error", async () => {
  const res = await replayTool.handler({ handle: "not-json" });
  assert.equal(res.success, false);
  assert.match(String(res.error), /Invalid handle/i);
});

