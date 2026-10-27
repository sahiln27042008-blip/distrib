import test from "node:test";
import assert from "node:assert/strict";
import { runMatrixTool } from "../../src/mcp/tools/run-matrix.ts";
import { auditTraceTool } from "../../src/mcp/tools/audit-trace.ts";
import { explainFindingTool } from "../../src/mcp/tools/explain-finding.ts";
import type { MatrixConfig } from "../../src/matrix-copy.ts";

async function runAuditForFinding(config: MatrixConfig, ruleId: string) {
  const runRes = await runMatrixTool.handler({ config });
  assert.equal(runRes.success, true, `matrix run failed: ${String(runRes.error)}`);
  const trace = runRes.trace as any;

  const auditRes = await auditTraceTool.handler({ trace });
  assert.equal(auditRes.success, true, `audit failed: ${String(auditRes.error)}`);
  const findings = Array.isArray(auditRes.findings) ? auditRes.findings : [];
  const matching = findings.find(f => f.rule_id === ruleId);
  assert.ok(matching, `expected finding ${ruleId} in audited trace`);
  return { trace, finding: matching };
}

test("explain_finding for R04 returns non-empty explanation", async () => {
  const config: MatrixConfig = {
    seed: 42,
    runId: "explain-r04",
    A: "A2_mixed_saas",
    B: "B1_zero_hold_2ms",
    C: "C5_legacy_erp_no_idem",
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

  const { trace, finding } = await runAuditForFinding(config, "r04-network-idempotency");
  const res = await explainFindingTool.handler({ finding, trace });
  assert.equal(res.success, true);
  assert.ok(typeof res.explanation === "string" && res.explanation.length > 0);
  assert.ok(Array.isArray(res.citedSpanIds) && res.citedSpanIds.length > 0);
});

test("explain_finding for R05 returns non-empty explanation", async () => {
  const config: MatrixConfig = {
    seed: 42,
    runId: "explain-r05",
    A: "A2_mixed_saas",
    B: "B1_zero_hold_2ms",
    C: "C2_socket_drop_2ms_late",
    D: "D5_cqrs_duckdb_blackboard_o1",
    E: "E4_state_leases_ipc_worker",
    F: "F2_ask_llm_to_undo",
    humanUsers: 20,
    concurrentAgents: 5,
    dbPoolSize: 20,
    workflowSteps: 10,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  };

  const { trace, finding } = await runAuditForFinding(config, "r05-distributed-sagas");
  const res = await explainFindingTool.handler({ finding, trace });
  assert.equal(res.success, true);
  assert.ok(typeof res.explanation === "string" && res.explanation.length > 0);
  assert.ok(Array.isArray(res.citedSpanIds) && res.citedSpanIds.length > 0);
});

test("explain_finding for R11 returns non-empty explanation", async () => {
  const config: MatrixConfig = {
    seed: 42,
    runId: "explain-r11",
    A: "A2_mixed_saas",
    B: "B3_write_amp_15mb",
    C: "C1_clean_20ms",
    D: "D5_cqrs_duckdb_blackboard_o1",
    E: "E4_state_leases_ipc_worker",
    F: "F3_resilient_invariant_runtime",
    humanUsers: 50,
    concurrentAgents: 6,
    dbPoolSize: 20,
    workflowSteps: 15,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  };

  const { trace, finding } = await runAuditForFinding(config, "r11");
  const res = await explainFindingTool.handler({ finding, trace });
  assert.equal(res.success, true);
  assert.ok(typeof res.explanation === "string" && res.explanation.length > 0);
  assert.ok(Array.isArray(res.citedSpanIds) && res.citedSpanIds.length > 0);
});

test("explain_finding with invalid finding returns error", async () => {
  const res = await explainFindingTool.handler({ finding: {}, trace: { spans: [] } });
  assert.equal(res.success, false);
  assert.match(String(res.error), /finding with rule_id|trace with spans/i);
});

test("explain_finding with missing trace returns error", async () => {
  const res = await explainFindingTool.handler({ finding: { rule_id: "r04-network-idempotency" }, trace: null as any });
  assert.equal(res.success, false);
  assert.match(String(res.error), /trace with spans/i);
});

test("explain_finding against mock returns deterministic explanation", async () => {
  const config: MatrixConfig = {
    seed: 42,
    runId: "explain-deterministic",
    A: "A2_mixed_saas",
    B: "B1_zero_hold_2ms",
    C: "C5_legacy_erp_no_idem",
    D: "D5_cqrs_duckdb_blackboard_o1",
    E: "E4_state_leases_ipc_worker",
    F: "F1_blind_retry_unbounded_spend",
    humanUsers: 20,
    concurrentAgents: 5,
    dbPoolSize: 20,
    workflowSteps: 8,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  };

  const { trace, finding } = await runAuditForFinding(config, "r04-network-idempotency");
  const res1 = await explainFindingTool.handler({ finding, trace });
  const res2 = await explainFindingTool.handler({ finding, trace });
  assert.deepEqual(res1, res2);
});
