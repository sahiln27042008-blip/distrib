// enterpriseee/enterprise-simulator/test/mcp/channel-idempotency.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { causalAuditTool } from "../../src/mcp/tools/causal-audit.ts";
import { causalVerifyTool } from "../../src/mcp/tools/causal-verify.ts";
import { proposeFixTool } from "../../src/mcp/tools/propose-fix.ts";

test("audit_workflow_reliability proves the channel retry failure without inventing an R08 lease finding", async () => {
  const result = await causalAuditTool.handler({
    scenarioId: "wf-multitenant-saga-reversal",
    seed: 42817,
  });

  assert.equal(result.success, true);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.status, "FAILURE_FOUND");
  assert.ok(Array.isArray(result.violatedInvariants));
  assert.ok((result.violatedInvariants as string[]).includes("r04-network-idempotency"));
  assert.ok(!(result.violatedInvariants as string[]).includes("r08-zero-hold-lease"));
  assert.ok(Array.isArray(result.minimalCounterexample));
  assert.ok((result.minimalCounterexample as any[]).length > 0);
  const firstFault = (result.minimalCounterexample as any[])[0];
  assert.equal(firstFault.targetVowelId, "channel-1-2");
});

test("verify_architecture_patch with single ablation zero_hold_lease remains BLOCKED", async () => {
  const result = await causalVerifyTool.handler({
    scenarioId: "wf-multitenant-saga-reversal",
    ablation: "zero_hold_lease",
    seed: 42817,
  });

  assert.equal(result.success, true);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.regressionCheck, "FAILED");
});

test("channel_idempotency ablation removes R04 but retains event-proven lease expiry", async () => {
  const result = await causalVerifyTool.handler({
    scenarioId: "wf-multitenant-saga-reversal",
    ablation: "channel_idempotency",
    seed: 42817,
  });

  assert.equal(result.success, true);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.regressionCheck, "FAILED");
  assert.ok((result.violatedInvariants as string[]).includes("native-lease-epoch-expiry"));
  assert.ok(!(result.violatedInvariants as string[]).includes("r04-network-idempotency"));
});

test("compound idempotency and zero-hold patch still reports the saturated lease expiry event", async () => {
  const result = await causalVerifyTool.handler({
    scenarioId: "wf-multitenant-saga-reversal",
    ablations: ["channel_idempotency", "zero_hold_lease"],
    seed: 42817,
  });

  assert.equal(result.success, true);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.status, "FAILURE_FOUND");
  assert.equal(result.regressionCheck, "FAILED");
  assert.ok((result.violatedInvariants as string[]).includes("native-lease-epoch-expiry"));
});

test("audit_workflow_reliability resolves and audits all 4 complex enterprise incidents", async () => {
  const scenarios = [
    "wf-multitenant-saga-reversal",
    "wf-speculative-batch-unrolling",
    "wf-zombie-checkpoint-desync",
    "wf-epistemic-context-tax",
  ];

  for (const s of scenarios) {
    const res = await causalAuditTool.handler({
      scenarioId: s,
      seed: 42817,
      maxDepth: 1,
    });
    assert.equal(res.success, true);
    assert.ok(res.verdict === "APPROVED" || res.verdict === "BLOCKED");
  }
});

test("propose_fix auto-resolves finding and rule_id from session memory or active trace", async () => {
  const mockContext = {
    lastViolatedInvariants: ["r08-zero-hold-lease"],
    lastConfig: {
      A: "A1_single_task",
      B: "B3_write_amp_15mb",
      C: "C5_legacy_erp_no_idem",
      D: "D1_raw_json_80k_flood",
      E: "E1_god_mode_main_thread",
      F: "F1_blind_retry_unbounded_spend",
      seed: 42817,
      runId: "run-test",
      humanUsers: 1,
      concurrentAgents: 1,
      dbPoolSize: 10,
      workflowSteps: 5,
      saasPriceUsd: 100,
      ticketValueUsd: 50,
    },
  };

  const result = await proposeFixTool.handler({}, mockContext);
  assert.equal(result.success, true);
  assert.ok(result.fixedConfig);
});

