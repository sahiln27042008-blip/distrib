import test from "node:test";
import assert from "node:assert/strict";
import { verifyFixTool } from "../../src/mcp/tools/verify-fix.ts";
import { MATRIX_PRESETS, type MatrixConfig } from "../../src/matrix-copy.ts";

const originalR04Config: MatrixConfig = {
  seed: 42,
  runId: "verify-r04",
  A: "A2_mixed_saas",
  B: "B1_zero_hold_2ms",
  C: "C5_legacy_erp_no_idem",
  D: "D3_lossy_llm_summary",
  E: "E4_state_leases_ipc_worker",
  F: "F1_blind_retry_unbounded_spend",
  humanUsers: 200,
  concurrentAgents: 10,
  dbPoolSize: 20,
  workflowSteps: 10,
  saasPriceUsd: 20,
  ticketValueUsd: 5,
};

test("verify_fix confirms R04 disappears when C5→C1", async () => {
  const fixedConfig: MatrixConfig = {
    ...originalR04Config,
    C: "C1_clean_20ms",
  };

  const res = await verifyFixTool.handler({
    originalConfig: originalR04Config,
    fixedConfig,
    findingRuleId: "r04-network-idempotency",
  });

  assert.equal(res.success, true);
  assert.equal(res.isFixed, true);
  const before = res.before as { matchingFindingsCount: number; allFindingsCount: number };
  const after = res.after as { matchingFindingsCount: number; allFindingsCount: number };
  assert.ok(before.matchingFindingsCount > 0, "Original config must have >0 matching findings");
  assert.equal(after.matchingFindingsCount, 0, "Fixed config must have 0 matching findings");
});

test("verify_fix confirms R11 disappears when B3→B1", async () => {
  const originalR11Config: MatrixConfig = {
    seed: 42,
    runId: "verify-r11",
    A: "A5_marathon_30step",
    B: "B3_write_amp_15mb",
    C: "C1_clean_20ms",
    D: "D2_append_only_quadratic",
    E: "E4_state_leases_ipc_worker",
    F: "F1_blind_retry_unbounded_spend",
    humanUsers: 50,
    concurrentAgents: 5,
    dbPoolSize: 20,
    workflowSteps: 30,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  };

  const fixedConfig: MatrixConfig = {
    ...originalR11Config,
    B: "B1_zero_hold_2ms",
  };

  const res = await verifyFixTool.handler({
    originalConfig: originalR11Config,
    fixedConfig,
    findingRuleId: "r11",
  });

  assert.equal(res.success, true);
  assert.equal(res.isFixed, true);
  const before = res.before as { matchingFindingsCount: number };
  const after = res.after as { matchingFindingsCount: number };
  assert.ok(before.matchingFindingsCount > 0);
  assert.equal(after.matchingFindingsCount, 0);
});

test("verify_fix reports NOT fixed when dial doesn't change", async () => {
  const res = await verifyFixTool.handler({
    originalConfig: originalR04Config,
    fixedConfig: originalR04Config, // identical config
    findingRuleId: "r04-network-idempotency",
  });

  assert.equal(res.success, true);
  assert.equal(res.isFixed, false);
  const before = res.before as { matchingFindingsCount: number };
  const after = res.after as { matchingFindingsCount: number };
  assert.ok(before.matchingFindingsCount > 0);
  assert.ok(after.matchingFindingsCount > 0);
  assert.match(String(res.proof), /Fix did NOT resolve the finding/i);
});

test("verify_fix does not approve comparisons with different seeds", async () => {
  const fixedConfig: MatrixConfig = {
    ...originalR04Config,
    C: "C1_clean_20ms",
    seed: originalR04Config.seed + 1,
  };

  const res = await verifyFixTool.handler({
    originalConfig: originalR04Config,
    fixedConfig,
    findingRuleId: "r04-network-idempotency",
  });

  assert.equal(res.success, true);
  assert.equal(res.isFixed, false);
  assert.match(String(res.proof), /same seed|seed mismatch/i);
});

test("verify_fix with invalid configs returns error", async () => {
  // Missing required originalConfig
  const res1 = await verifyFixTool.handler({
    fixedConfig: originalR04Config,
    findingRuleId: "r04-network-idempotency",
  });
  assert.equal(res1.success, false);
  assert.match(String(res1.error), /originalConfig with valid dials A-F is required/i);

  // Missing required fixedConfig
  const res2 = await verifyFixTool.handler({
    originalConfig: originalR04Config,
    findingRuleId: "r04-network-idempotency",
  });
  assert.equal(res2.success, false);
  assert.match(String(res2.error), /fixedConfig with valid dials A-F is required/i);

  // Missing required findingRuleId
  const res3 = await verifyFixTool.handler({
    originalConfig: originalR04Config,
    fixedConfig: originalR04Config,
    findingRuleId: "",
  });
  assert.equal(res3.success, false);
  assert.match(String(res3.error), /findingRuleId is required/i);

  // Invalid dial in config
  const res4 = await verifyFixTool.handler({
    originalConfig: { ...originalR04Config, A: "INVALID_DIAL" },
    fixedConfig: originalR04Config,
    findingRuleId: "r04-network-idempotency",
  });
  assert.equal(res4.success, false);
});

test("verify_fix returns before/after proof string", async () => {
  const fixedConfig: MatrixConfig = {
    ...originalR04Config,
    C: "C1_clean_20ms",
  };

  const res = await verifyFixTool.handler({
    originalConfig: originalR04Config,
    fixedConfig,
    findingRuleId: "r04-network-idempotency",
  });

  assert.equal(res.success, true);
  assert.equal(res.isFixed, true);
  assert.ok(typeof res.proof === "string");
  assert.ok(res.proof.length > 0);
  assert.match(res.proof, /Fix verified/i);
});

