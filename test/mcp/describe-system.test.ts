import test from "node:test";
import assert from "node:assert/strict";
import { describeSystemTool } from "../../src/mcp/tools/describe-system.ts";
import { MockOrchestrator } from "../../src/llm/orchestrator-mock.ts";
import type { Orchestrator, OrchestratorMessage } from "../../src/llm/orchestrator.ts";
import type { MatrixConfig } from "../../src/matrix-copy.ts";

test("describe_system with 'refund' keyword returns a config with F1 or C5 dial", async () => {
  const result = await describeSystemTool.handler({
    description: "Our payment agent handles customer refunds without idempotency checks on the ERP",
  });

  assert.equal(result.success, true);
  const cfg = result.config as MatrixConfig;
  assert.ok(cfg);
  assert.ok(
    cfg.C === "C5_legacy_erp_no_idem" || cfg.F === "F1_blind_retry_unbounded_spend",
    `Expected C5 or F1 dial, got C: ${cfg.C}, F: ${cfg.F}`
  );
});

test("describe_system with 'streaming' keyword returns B2_stream_hog_30s", async () => {
  const result = await describeSystemTool.handler({
    description: "An agent workflow with streaming responses holding open transactions for 30s",
  });

  assert.equal(result.success, true);
  const cfg = result.config as MatrixConfig;
  assert.ok(cfg);
  assert.equal(cfg.B, "B2_stream_hog_30s");
});

test("describe_system with no keywords returns default resilient config (B1/D5/E4/F3)", async () => {
  const result = await describeSystemTool.handler({
    description: "A standard enterprise setup with regular user traffic",
  });

  assert.equal(result.success, true);
  const cfg = result.config as MatrixConfig;
  assert.ok(cfg);
  assert.equal(cfg.A, "A2_mixed_saas");
  assert.equal(cfg.B, "B1_zero_hold_2ms");
  assert.equal(cfg.C, "C1_clean_20ms");
  assert.equal(cfg.D, "D5_cqrs_duckdb_blackboard_o1");
  assert.equal(cfg.E, "E4_state_leases_ipc_worker");
  assert.equal(cfg.F, "F3_resilient_invariant_runtime");
});

test("describe_system with invalid description returns error", async () => {
  const emptyRes = await describeSystemTool.handler({ description: "" });
  assert.equal(emptyRes.success, false);
  assert.match(String(emptyRes.error), /description is required/i);

  const missingRes = await describeSystemTool.handler({});
  assert.equal(missingRes.success, false);
  assert.match(String(missingRes.error), /description is required/i);

  const nonStringRes = await describeSystemTool.handler({ description: 12345 });
  assert.equal(nonStringRes.success, false);
  assert.match(String(nonStringRes.error), /description is required/i);
});

test("describe_system validates all 6 dials are in the valid enum", async () => {
  // Test with custom orchestrator mock that returns an invalid dial value
  const badOrchestrator: Orchestrator = {
    async chat() {
      return {
        text: JSON.stringify({
          A: "INVALID_DIAL_A",
          B: "B1_zero_hold_2ms",
          C: "C1_clean_20ms",
          D: "D5_cqrs_duckdb_blackboard_o1",
          E: "E4_state_leases_ipc_worker",
          F: "F3_resilient_invariant_runtime",
        }),
        tool_calls: [],
        stop_reason: "stop",
      };
    },
  };

  const result = await describeSystemTool.handler(
    { description: "Some system" },
    { orchestrator: badOrchestrator }
  );

  assert.equal(result.success, false);
  assert.match(String(result.error), /Invalid Dial A/i);
});

test("describe_system works with MockOrchestrator passed explicitly in context", async () => {
  const mock = new MockOrchestrator(99);
  const result = await describeSystemTool.handler(
    { description: "Streaming customer service agent with retry logic" },
    { orchestrator: mock }
  );

  assert.equal(result.success, true);
  const cfg = result.config as MatrixConfig;
  assert.equal(cfg.B, "B2_stream_hog_30s");
  assert.equal(cfg.F, "F1_blind_retry_unbounded_spend");
});

