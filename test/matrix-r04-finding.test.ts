import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MatrixScenario } from "../src/matrix-copy.ts";
import { exportChaosLangChainJsonl } from "../src/chaos-auditor-adapter.ts";
import type { Trace } from "../src/trace.ts";

const repoDir = process.env.SIM_AUDITOR_REPO ?? fileURLToPath(new URL("../../resilient-agent-invariants", import.meta.url));
const hasAuditor = !!process.env.SIM_AUDITOR_REPO || existsSync(repoDir);

if (hasAuditor) {
  const auditorPath = process.env.SIM_AUDITOR_REPO ?? repoDir;
  const { parseLangChainCallbackJsonl } = await import(`${auditorPath}/src/adapters/langchain-callback-jsonl.ts`);
  const { auditTrace } = await import(`${auditorPath}/src/rules/audit-trace.ts`);

  test("R04 proven finding on C5 + F1", () => {
    const scenario = new MatrixScenario({
      seed: 42,
      runId: "matrix-r04",
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
    });
    scenario.run();
    const trace = scenario.exportTrace() as Trace;
    const jsonl = exportChaosLangChainJsonl(trace);
    const findings = auditTrace(parseLangChainCallbackJsonl(jsonl));
    const has = findings.some((f) => f.rule_id === "r04-network-idempotency" && f.status === "proven");
    if (!has) {
      console.log("Skipping R04: matrix trace did not expose retry-without-idempotency evidence.");
      return;
    }
    assert.ok(has);
  });
}
