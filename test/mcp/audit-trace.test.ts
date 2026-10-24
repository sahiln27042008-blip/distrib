import test from "node:test";
import assert from "node:assert/strict";
import { runMatrixTool } from "../../src/mcp/tools/run-matrix.ts";
import { auditTraceTool } from "../../src/mcp/tools/audit-trace.ts";
import type { MatrixConfig } from "../../src/matrix-copy.ts";

async function auditPreset(config: MatrixConfig) {
  const runRes = await runMatrixTool.handler({ config });
  assert.equal(runRes.success, true, `matrix run failed: ${String(runRes.error)}`);
  const trace = runRes.trace as any;
  assert.ok(trace && Array.isArray(trace.spans), "trace should include spans");

  const auditRes = await auditTraceTool.handler({ trace });
  assert.equal(auditRes.success, true, `audit failed: ${String(auditRes.error)}`);
  const findings = Array.isArray(auditRes.findings) ? auditRes.findings : [];
  return { trace, findings, auditRes };
}

test("audit_trace on a matrix trace from C5+F1 returns R04 proven finding", async () => {
  const config: MatrixConfig = {
    seed: 42,
    runId: "audit-r04",
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

  const { findings } = await auditPreset(config);
  assert.ok(findings.some(f => f.rule_id === "r04-network-idempotency" && f.status === "proven"));
});

test("audit_trace on B3 returns R11 proven finding", async () => {
  const config: MatrixConfig = {
    seed: 42,
    runId: "audit-r11",
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

  const { findings } = await auditPreset(config);
  assert.ok(findings.some(f => f.rule_id === "r11" && f.status === "proven"));
});

test("audit_trace on a clean resilient config returns 0 proven findings", async () => {
  const config: MatrixConfig = {
    seed: 42,
    runId: "audit-clean",
    A: "A2_mixed_saas",
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

  const { auditRes } = await auditPreset(config);
  assert.equal(auditRes.provenCount, 0);
});

test("audit_trace with invalid trace returns error", async () => {
  const res = await auditTraceTool.handler({ trace: { spans: [] } as any });
  assert.equal(res.success, false);
  assert.match(String(res.error), /spans array|trace with spans/i);
});

test("audit_trace returns findingsCount, provenCount, unknownCount, and ruleIds", async () => {
  const config: MatrixConfig = {
    seed: 42,
    runId: "audit-stats",
    A: "A2_mixed_saas",
    B: "B1_zero_hold_2ms",
    C: "C2_socket_drop_2ms_late",
    D: "D5_cqrs_duckdb_blackboard_o1",
    E: "E4_state_leases_ipc_worker",
    F: "F1_blind_retry_unbounded_spend",
    humanUsers: 30,
    concurrentAgents: 5,
    dbPoolSize: 20,
    workflowSteps: 8,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  };

  const { auditRes } = await auditPreset(config);
  const findings = Array.isArray(auditRes.findings) ? auditRes.findings : [];
  assert.ok(typeof auditRes.findingsCount === "number");
  assert.ok(typeof auditRes.provenCount === "number");
  assert.ok(typeof auditRes.unknownCount === "number");
  assert.ok(Array.isArray(auditRes.ruleIds));
  assert.equal(auditRes.findingsCount, findings.length);
  assert.equal(auditRes.provenCount + auditRes.unknownCount, findings.length);
  assert.ok(auditRes.ruleIds.length >= 1);
});
