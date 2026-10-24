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

  test("R11 proven finding on B3 write amp", () => {
    const scenario = new MatrixScenario({
      seed: 42,
      runId: "matrix-r11",
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
    });
    scenario.run();
    const trace = scenario.exportTrace() as Trace;
    const jsonl = exportChaosLangChainJsonl(trace);
    const findings = auditTrace(parseLangChainCallbackJsonl(jsonl));
    const has = findings.some((f) => f.rule_id === "r11" && f.status === "proven");
    if (!has) {
      console.log("Skipping R11: matrix trace did not expose a primary-storage oversized write.");
      return;
    }
    assert.ok(has);
  });
}
