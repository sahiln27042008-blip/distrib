import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MatrixScenario } from "../src/matrix-copy.ts";
import { exportChaosLangChainJsonl } from "../src/chaos-auditor-adapter.ts";
import type { Trace } from "../src/trace.ts";
import type { Finding } from "../../../resilient-agent-invariants/src/types/finding.ts";

const repoDir = process.env.SIM_AUDITOR_REPO ?? fileURLToPath(new URL("../../resilient-agent-invariants", import.meta.url));
const hasAuditor = !!process.env.SIM_AUDITOR_REPO || existsSync(repoDir);

if (hasAuditor) {
  const auditorPath = process.env.SIM_AUDITOR_REPO ?? repoDir;
  const { parseLangChainCallbackJsonl } = await import(`${auditorPath}/src/adapters/langchain-callback-jsonl.ts`);
  const { auditTrace } = await import(`${auditorPath}/src/rules/audit-trace.ts`);

  test("R05 proven finding on F2 saga failure path", () => {
    const scenario = new MatrixScenario({
      seed: 42,
      runId: "matrix-r05",
      A: "A1_single_task",
      B: "B1_zero_hold_2ms",
      C: "C2_socket_drop_2ms_late",
      D: "D2_append_only_quadratic",
      E: "E4_state_leases_ipc_worker",
      F: "F2_ask_llm_to_undo",
      humanUsers: 0,
      concurrentAgents: 1,
      dbPoolSize: 20,
      workflowSteps: 10,
      saasPriceUsd: 20,
      ticketValueUsd: 5,
    });
    scenario.run();
    const trace = scenario.exportTrace() as Trace;
    const jsonl = exportChaosLangChainJsonl(trace);
    const findings = auditTrace(parseLangChainCallbackJsonl(jsonl));
    const finding = findings.find((f: Finding) => f.rule_id === "r05-distributed-sagas" && f.status === "proven");
    assert.ok(finding, "matrix trace should preserve the first compensation event and its failed saga context");
  });
}
