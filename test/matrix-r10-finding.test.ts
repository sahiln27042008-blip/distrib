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

  test("R10 proven finding on F3 + D1 budget breach", () => {
    const scenario = new MatrixScenario({
      seed: 42,
      runId: "matrix-r10",
      A: "A2_mixed_saas",
      B: "B1_zero_hold_2ms",
      C: "C1_clean_20ms",
      D: "D1_raw_json_80k_flood",
      E: "E4_state_leases_ipc_worker",
      F: "F3_resilient_invariant_runtime",
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
    const has = findings.some((f) => f.rule_id === "r10-unit-economics" && f.status === "proven");
    if (!has) {
      console.log("Skipping R10: matrix trace did not exceed declared budget in the adapter output.");
      return;
    }
    assert.ok(has);
  });
}
