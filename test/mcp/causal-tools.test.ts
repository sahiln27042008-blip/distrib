// enterpriseee/enterprise-simulator/test/mcp/causal-tools.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { causalAuditTool } from "../../src/mcp/tools/causal-audit.ts";
import { causalCliffTool } from "../../src/mcp/tools/causal-cliff.ts";
import { causalVerifyTool } from "../../src/mcp/tools/causal-verify.ts";

test("audit_workflow_reliability returns APPROVED for a known-safe scenario", async () => {
  const result = await causalAuditTool.handler({
    scenarioId: "scenario-B",
    maxDepth: 2,
    seed: 42817,
  });

  assert.equal(result.success, true);
  assert.equal(result.verdict, "APPROVED");
  assert.equal(result.status, "NO_FAILURE_WITHIN_BOUND");
  assert.deepEqual(result.violatedInvariants, []);
  assert.deepEqual(result.minimalCounterexample, []);
  assert.ok(typeof result.evaluationsCount === "number" && (result.evaluationsCount as number) > 0);
  assert.ok(typeof result.durationMs === "number");
});

test("audit_workflow_reliability returns BLOCKED for a known-failing scenario", async () => {
  const result = await causalAuditTool.handler({
    scenarioId: "scenario-A",
    maxDepth: 2,
    seed: 42817,
  });

  assert.equal(result.success, true);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.status, "FAILURE_FOUND");
  assert.equal(result.shortestDepth, 1);
  assert.ok(Array.isArray(result.violatedInvariants));
  assert.ok((result.violatedInvariants as string[]).includes("r04-network-idempotency"));
  assert.ok(typeof result.evaluationsCount === "number" && (result.evaluationsCount as number) > 0);
});

test("audit_workflow_reliability returns minimalCounterexample when BLOCKED", async () => {
  const result = await causalAuditTool.handler({
    scenarioId: "scenario-A",
    maxDepth: 2,
    seed: 42817,
  });

  assert.equal(result.verdict, "BLOCKED");
  assert.ok(Array.isArray(result.minimalCounterexample));
  assert.equal((result.minimalCounterexample as any[]).length, 1);

  const firstFault = (result.minimalCounterexample as any[])[0];
  assert.equal(firstFault.targetVowelId, "chan-payment");
  assert.ok(firstFault.consonantKind === "DELAY" || firstFault.consonantKind === "SEVER");
});

test("audit_workflow_reliability is deterministic (same seed = same result)", async () => {
  const run1 = await causalAuditTool.handler({
    scenarioId: "scenario-A",
    maxDepth: 2,
    seed: 42817,
  });

  const run2 = await causalAuditTool.handler({
    scenarioId: "scenario-A",
    maxDepth: 2,
    seed: 42817,
  });

  assert.equal(run1.verdict, run2.verdict);
  assert.equal(run1.status, run2.status);
  assert.equal(run1.shortestDepth, run2.shortestDepth);
  assert.equal(run1.evaluationsCount, run2.evaluationsCount);
  assert.deepEqual(run1.violatedInvariants, run2.violatedInvariants);
  assert.deepEqual(run1.minimalCounterexample, run2.minimalCounterexample);
  assert.equal(run1.fingerprint, run2.fingerprint);
});

test("sweep_latency_cliff returns a cliff threshold", async () => {
  const result = await causalCliffTool.handler({
    scenarioId: "scenario-A",
    targetChannel: "chan-payment",
    minMs: 0,
    maxMs: 60000,
  });

  assert.equal(result.success, true);
  assert.equal(result.status, "CLIFF_FOUND");
  assert.ok(typeof result.cliffMs === "number");
  assert.ok(typeof result.safeMs === "number");
  assert.ok(typeof result.collapseMs === "number");

  const cliffMs = result.cliffMs as number;
  const safeMs = result.safeMs as number;
  const collapseMs = result.collapseMs as number;

  assert.ok(safeMs <= cliffMs && cliffMs <= collapseMs);
  // chan-payment has an 8000ms timeout
  assert.ok(safeMs >= 7900 && collapseMs <= 8100);
  assert.ok(typeof result.evaluationsCount === "number" && (result.evaluationsCount as number) > 0);
  assert.ok(typeof result.durationMs === "number");
});

test("sweep_latency_cliff is deterministic", async () => {
  const run1 = await causalCliffTool.handler({
    scenarioId: "scenario-A",
    targetChannel: "chan-payment",
    minMs: 0,
    maxMs: 60000,
    seed: 42817,
  });

  const run2 = await causalCliffTool.handler({
    scenarioId: "scenario-A",
    targetChannel: "chan-payment",
    minMs: 0,
    maxMs: 60000,
    seed: 42817,
  });

  assert.equal(run1.status, run2.status);
  assert.equal(run1.cliffMs, run2.cliffMs);
  assert.equal(run1.safeMs, run2.safeMs);
  assert.equal(run1.collapseMs, run2.collapseMs);
  assert.equal(run1.evaluationsCount, run2.evaluationsCount);
});

test("verify_architecture_patch returns APPROVED when ablation fixes the failure", async () => {
  const result = await causalVerifyTool.handler({
    scenarioId: "scenario-A",
    ablation: "enforce_idempotency",
    seed: 42817,
  });

  assert.equal(result.success, true);
  assert.equal(result.verdict, "APPROVED");
  assert.equal(result.status, "NO_FAILURE_WITHIN_BOUND");
  assert.equal(result.immuneUpToDepth, 2);
  assert.equal(result.regressionCheck, "PASSED");
  assert.deepEqual(result.violatedInvariants, []);
  assert.ok(typeof result.durationMs === "number");
});

test("verify_architecture_patch returns BLOCKED when ablation doesn't fix the failure", async () => {
  const result = await causalVerifyTool.handler({
    scenarioId: "scenario-A",
    ablation: "zero_hold_lease",
    seed: 42817,
  });

  assert.equal(result.success, true);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.status, "FAILURE_FOUND");
  assert.equal(result.immuneUpToDepth, 0);
  assert.equal(result.regressionCheck, "FAILED");
  assert.ok(Array.isArray(result.violatedInvariants));
  assert.ok((result.violatedInvariants as string[]).includes("r04-network-idempotency"));
});

test("All 3 tools handle missing scenarioId gracefully", async () => {
  const auditRes = await causalAuditTool.handler({});
  assert.equal(auditRes.success, false);
  assert.match(String(auditRes.error), /scenarioId is required/i);

  const cliffRes = await causalCliffTool.handler({ targetChannel: "chan-payment" });
  assert.equal(cliffRes.success, false);
  assert.match(String(cliffRes.error), /scenarioId is required/i);

  const verifyRes = await causalVerifyTool.handler({ ablation: "enforce_idempotency" });
  assert.equal(verifyRes.success, false);
  assert.match(String(verifyRes.error), /scenarioId is required/i);

  // Missing targetChannel in cliff tool
  const cliffMissingChan = await causalCliffTool.handler({ scenarioId: "scenario-A" });
  assert.equal(cliffMissingChan.success, false);
  assert.match(String(cliffMissingChan.error), /targetChannel is required/i);

  // Missing ablation in verify tool
  const verifyMissingAblation = await causalVerifyTool.handler({ scenarioId: "scenario-A" });
  assert.equal(verifyMissingAblation.success, false);
  assert.match(String(verifyMissingAblation.error), /ablation is required/i);

  // Unknown scenario
  const auditUnknown = await causalAuditTool.handler({ scenarioId: "nonexistent-scenario-xyz" });
  assert.equal(auditUnknown.success, false);
  assert.match(String(auditUnknown.error), /Unknown scenario/i);
});

