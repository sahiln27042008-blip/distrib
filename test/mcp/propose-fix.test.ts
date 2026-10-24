import test from "node:test";
import assert from "node:assert/strict";
import { proposeFixTool } from "../../src/mcp/tools/propose-fix.ts";
import { MockOrchestrator } from "../../src/llm/orchestrator-mock.ts";
import type { Orchestrator, OrchestratorMessage, OrchestratorResponse } from "../../src/llm/orchestrator.ts";
import type { MatrixConfig } from "../../src/matrix-copy.ts";

/**
 * Mocking Strategy Documentation:
 * We test propose_fix both with the default MockOrchestrator (which exercises the
 * built-in keyword/rule-based canned fallback) and with custom Orchestrator mocks
 * that return specific tool_calls or JSON text responses to verify exact parsing,
 * dial validation, merging behavior, and error handling.
 */

class CustomResponseMockOrchestrator implements Orchestrator {
  private response: OrchestratorResponse;
  constructor(response: OrchestratorResponse) {
    this.response = response;
  }
  async chat(_messages: OrchestratorMessage[], _tools: unknown): Promise<OrchestratorResponse> {
    return this.response;
  }
}

const baseConfig: MatrixConfig = {
  seed: 42,
  runId: "orig-run-123",
  A: "A2_mixed_saas",
  B: "B1_zero_hold_2ms",
  C: "C5_legacy_erp_no_idem",
  D: "D5_cqrs_duckdb_blackboard_o1",
  E: "E4_state_leases_ipc_worker",
  F: "F1_blind_retry_unbounded_spend",
  humanUsers: 50,
  concurrentAgents: 10,
  dbPoolSize: 20,
  workflowSteps: 10,
  saasPriceUsd: 20,
  ticketValueUsd: 5,
};

test("propose_fix for R04 returns a fixed config with C != C5_legacy_erp_no_idem", async () => {
  const customMock = new CustomResponseMockOrchestrator({
    text: JSON.stringify({ C: "C1_clean_20ms" }),
    tool_calls: [],
    stop_reason: "stop",
  });

  const finding = {
    rule_id: "r04-network-idempotency",
    pillar: "P02",
    status: "proven",
    severity: "critical",
    message: "POST non-idempotent call retried",
    evidence: { span_ids: ["span-1", "span-2"] },
    repro: "run with C5 + F1",
    suggested_fix: "Use idempotent endpoint (C1)",
  };

  const result = await proposeFixTool.handler(
    {
      finding,
      originalConfig: baseConfig,
      explanation: "ERP retried without idempotency key causing double-charge.",
    },
    { orchestrator: customMock }
  );

  assert.equal(result.success, true);
  const fixedConfig = result.fixedConfig as MatrixConfig;
  assert.ok(fixedConfig);
  assert.equal(fixedConfig.C, "C1_clean_20ms");
  assert.notEqual(fixedConfig.C, "C5_legacy_erp_no_idem");
});

test("propose_fix for R11 returns a fixed config with B != B3_write_amp_15mb", async () => {
  const customMock = new CustomResponseMockOrchestrator({
    text: JSON.stringify({ B: "B1_zero_hold_2ms" }),
    tool_calls: [],
    stop_reason: "stop",
  });

  const finding = {
    rule_id: "r11",
    pillar: "P05",
    status: "proven",
    severity: "critical",
    message: "Primary storage oversized write amplification",
    evidence: { span_ids: ["span-b3"] },
    repro: "run with B3",
    suggested_fix: "Zero hold 2ms writes",
  };

  const originalWithB3: MatrixConfig = {
    ...baseConfig,
    B: "B3_write_amp_15mb",
    C: "C1_clean_20ms",
  };

  const result = await proposeFixTool.handler(
    {
      finding,
      originalConfig: originalWithB3,
      explanation: "Large write amplification exhausted disk bandwidth.",
    },
    { orchestrator: customMock }
  );

  assert.equal(result.success, true);
  const fixedConfig = result.fixedConfig as MatrixConfig;
  assert.ok(fixedConfig);
  assert.equal(fixedConfig.B, "B1_zero_hold_2ms");
  assert.notEqual(fixedConfig.B, "B3_write_amp_15mb");
});

test("propose_fix validates all 6 dials", async () => {
  const invalidMock = new CustomResponseMockOrchestrator({
    text: JSON.stringify({ C: "C99_non_existent_dial" }),
    tool_calls: [],
    stop_reason: "stop",
  });

  const finding = { rule_id: "r04-network-idempotency", status: "proven" };

  const result = await proposeFixTool.handler(
    {
      finding,
      originalConfig: baseConfig,
    },
    { orchestrator: invalidMock }
  );

  assert.equal(result.success, false);
  assert.match(String(result.error), /Invalid Dial C/i);
});

test("propose_fix merges with originalConfig for unchanged dials", async () => {
  const customMock = new CustomResponseMockOrchestrator({
    text: JSON.stringify({ C: "C1_clean_20ms" }),
    tool_calls: [],
    stop_reason: "stop",
  });

  const finding = { rule_id: "r04-network-idempotency", status: "proven" };

  const result = await proposeFixTool.handler(
    {
      finding,
      originalConfig: baseConfig,
    },
    { orchestrator: customMock }
  );

  assert.equal(result.success, true);
  const fixed = result.fixedConfig as MatrixConfig;
  assert.equal(fixed.A, "A2_mixed_saas");
  assert.equal(fixed.B, "B1_zero_hold_2ms");
  assert.equal(fixed.D, "D5_cqrs_duckdb_blackboard_o1");
  assert.equal(fixed.E, "E4_state_leases_ipc_worker");
  assert.equal(fixed.F, "F1_blind_retry_unbounded_spend");
  assert.equal(fixed.humanUsers, 50);
});

test("propose_fix returns changedDials list", async () => {
  const customMock = new CustomResponseMockOrchestrator({
    text: JSON.stringify({ C: "C1_clean_20ms" }),
    tool_calls: [],
    stop_reason: "stop",
  });

  const finding = { rule_id: "r04-network-idempotency", status: "proven" };

  const result = await proposeFixTool.handler(
    {
      finding,
      originalConfig: baseConfig,
    },
    { orchestrator: customMock }
  );

  assert.equal(result.success, true);
  assert.deepEqual(result.changedDials, ["C"]);
});

test("propose_fix works with default MockOrchestrator fallback for R04 and R11", async () => {
  const defaultMock = new MockOrchestrator();

  // Test R04 default fallback
  const r04Result = await proposeFixTool.handler(
    {
      finding: { rule_id: "r04-network-idempotency", status: "proven" },
      originalConfig: baseConfig,
    },
    { orchestrator: defaultMock }
  );
  assert.equal(r04Result.success, true);
  assert.equal((r04Result.fixedConfig as MatrixConfig).C, "C1_clean_20ms");

  // Test R11 default fallback
  const r11Result = await proposeFixTool.handler(
    {
      finding: { rule_id: "r11", status: "proven" },
      originalConfig: { ...baseConfig, B: "B3_write_amp_15mb" },
    },
    { orchestrator: defaultMock }
  );
  assert.equal(r11Result.success, true);
  assert.equal((r11Result.fixedConfig as MatrixConfig).B, "B1_zero_hold_2ms");
});

test("propose_fix returns error when missing finding or originalConfig", async () => {
  const res1 = await proposeFixTool.handler({});
  assert.equal(res1.success, false);
  assert.match(String(res1.error), /finding with rule_id is required/i);

  const res2 = await proposeFixTool.handler({ finding: { rule_id: "r04" } });
  assert.equal(res2.success, false);
  assert.match(String(res2.error), /originalConfig with dials is required/i);
});

