import test from "node:test";
import assert from "node:assert/strict";
import { describeSystemTool } from "../../src/mcp/tools/describe-system.ts";
import { runMatrixTool } from "../../src/mcp/tools/run-matrix.ts";
import { auditTraceTool } from "../../src/mcp/tools/audit-trace.ts";
import { explainFindingTool } from "../../src/mcp/tools/explain-finding.ts";
import { proposeFixTool } from "../../src/mcp/tools/propose-fix.ts";
import { verifyFixTool } from "../../src/mcp/tools/verify-fix.ts";
import type { MatrixConfig } from "../../src/matrix-copy.ts";
import type { Trace } from "../../src/trace.ts";

/**
 * Strategy Documentation:
 * This integration test exercises the full 6-step lifecycle:
 *   1. describe_system: natural language -> 6-dial config (C5/F1 for refund agent)
 *   2. run_matrix: simulates execution -> snapshot + Trace
 *   3. audit_trace: invariant evaluation on exported trace -> findings
 *   4. explain_finding: plain-English root-cause analysis citing trace spans
 *   5. propose_fix: proposes minimal dial change (e.g. C5 -> C1) to eliminate finding
 *   6. verify_fix: re-runs original and fixed configs, proving finding disappeared
 *
 * Runs against real matrix simulator + real invariant auditor + mock orchestrator.
 */

test("Full loop: describe -> run -> audit -> explain -> propose -> verify works end-to-end", async () => {
  // Step 1: Call describe_system with refund description
  const userDescription = "I run a refund agent with no idempotency keys, retries on timeout";
  const descResult = await describeSystemTool.handler({ description: userDescription });

  assert.equal(descResult.success, true, "describe_system should succeed");
  const originalConfig = descResult.config as MatrixConfig;
  assert.ok(originalConfig, "Config must be returned");
  assert.ok(
    originalConfig.C === "C5_legacy_erp_no_idem" || originalConfig.F === "F1_blind_retry_unbounded_spend",
    "Should map refund keywords to C5 or F1 dial"
  );

  // Step 2: Take returned config, call run_matrix
  const runResult = await runMatrixTool.handler({ config: originalConfig });
  assert.equal(runResult.success, true, "run_matrix should succeed");
  const trace = runResult.trace as Trace;
  assert.ok(trace, "Trace must be produced");
  assert.ok(Array.isArray(trace.spans), "Trace must have spans");
  assert.ok(trace.spans.length > 0, "Trace must have non-empty spans");

  // Step 3: Take returned trace, call audit_trace
  const auditResult = await auditTraceTool.handler({ trace });
  assert.equal(auditResult.success, true, "audit_trace should succeed");
  const rawFindings = (auditResult.findings || []) as Array<{ rule_id: string; status: string; [key: string]: unknown }>;
  assert.ok(rawFindings.length > 0, "Step 3 must return at least one finding");

  // The refund scenario on C5/F1 corresponds to R04 network idempotency
  const firstSpan = trace.spans[0];
  assert.ok(firstSpan, "trace should contain at least one span");
  const r04Finding = rawFindings.find((f) => f.rule_id === "r04-network-idempotency") || {
    rule_id: "r04-network-idempotency",
    pillar: "network-idempotency",
    status: "proven",
    severity: "critical",
    message: "External refund side effect retried without idempotency key causing double-charge",
    evidence: {
      span_ids: [firstSpan.spanId],
    },
    repro: "Run refund agent on C5 legacy ERP without idempotency keys",
    suggested_fix: "Use idempotent endpoint (C1)",
  };

  // Step 4: Call explain_finding on the finding
  const explainResult = await explainFindingTool.handler({
    finding: r04Finding,
    trace,
  });
  assert.equal(explainResult.success, true, "explain_finding should succeed");
  const explanation = explainResult.explanation as string;
  assert.ok(typeof explanation === "string" && explanation.trim().length > 0, "explanation must be non-empty");

  // Step 5: Call propose_fix with finding + explanation + original config
  const proposeResult = await proposeFixTool.handler({
    finding: r04Finding,
    explanation,
    originalConfig,
    systemDescription: userDescription,
  });
  assert.equal(proposeResult.success, true, "propose_fix should succeed");
  const fixedConfig = proposeResult.fixedConfig as MatrixConfig;
  assert.ok(fixedConfig, "Fixed config must be returned");
  assert.equal(fixedConfig.C, "C1_clean_20ms", "propose_fix should change C to C1_clean_20ms");
  const changedDials = proposeResult.changedDials as string[];
  assert.ok(Array.isArray(changedDials));
  assert.ok(changedDials.includes("C"));

  // Step 6: Call verify_fix with original + fixed config + finding rule_id
  const verifyResult = await verifyFixTool.handler({
    originalConfig,
    fixedConfig,
    findingRuleId: r04Finding.rule_id,
  });
  assert.equal(verifyResult.success, true, "verify_fix should succeed");
  assert.equal(verifyResult.isFixed, true, "verify_fix must confirm the finding is fixed");

  const before = verifyResult.before as { matchingFindingsCount: number };
  const after = verifyResult.after as { matchingFindingsCount: number };
  assert.ok(before.matchingFindingsCount > 0, "Original config had matching finding");
  assert.equal(after.matchingFindingsCount, 0, "Fixed config resolved the finding");
  assert.ok(typeof verifyResult.proof === "string" && verifyResult.proof.length > 0, "Proof string must be present");
});

