import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportChaosLangChainJsonl } from "../../chaos-auditor-adapter.ts";
import type { Trace } from "../../trace.ts";
import type { Finding } from "../../../../../resilient-agent-invariants/src/types/finding.ts";

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  handler: (args: Record<string, unknown>, context?: { sessionId?: string }) => Promise<Record<string, unknown>>;
}

function resolveAuditorRepoRoot(): string {
  const envRepo = process.env.SIM_AUDITOR_REPO;
  if (envRepo && envRepo.trim().length > 0) {
    return path.resolve(envRepo);
  }

  const here = fileURLToPath(new URL("../../../../../", import.meta.url));
  return path.resolve(here, "resilient-agent-invariants");
}

async function loadAuditorRuntime() {
  const repoRoot = resolveAuditorRepoRoot();
  const distRoot = path.join(repoRoot, "dist", "src");

  const parseUrl = pathToFileURL(path.join(distRoot, "adapters", "langchain-callback-jsonl.js")).href;
  const auditUrl = pathToFileURL(path.join(distRoot, "rules", "audit-trace.js")).href;

  const [{ parseLangChainCallbackJsonl }, { auditTrace }] = await Promise.all([
    import(parseUrl),
    import(auditUrl),
  ]);

  return { parseLangChainCallbackJsonl, auditTrace };
}

export const auditTraceTool: McpTool = {
  name: "audit_trace",
  description:
    "Run the invariant auditor (R04 network idempotency, R05 distributed sagas, R10 unit economics, R11 event compaction) on a matrix trace. Returns Finding[] with status proven|unknown. Only proven findings indicate real failures; unknown means the trace doesn't have enough evidence.",
  inputSchema: {
    type: "object",
    properties: {
      trace: {
        type: "object",
        description:
          "sim-trace/0 from run_matrix. Must include spans with auditor-compatible attrs (side_effect, body_hash, idempotency_key, etc. are produced by the matrix automatically).",
      },
    },
    required: ["trace"],
  },
  async handler(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const trace = args.trace as Trace | undefined;
    if (!trace || !trace.spans || !Array.isArray(trace.spans) || trace.spans.length === 0) {
      return { success: false, error: "trace with spans array is required" };
    }

    try {
      const jsonl = exportChaosLangChainJsonl(trace);
      const runtime = await loadAuditorRuntime();
      const internalTrace = runtime.parseLangChainCallbackJsonl(jsonl);
      const findings: Finding[] = runtime.auditTrace(internalTrace);
      const provenCount = findings.filter((f) => f.status === "proven").length;
      const unknownCount = findings.filter((f) => f.status === "unknown").length;

      return {
        success: true,
        findings,
        findingsCount: findings.length,
        provenCount,
        unknownCount,
        ruleIds: [...new Set(findings.map((f) => f.rule_id))],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      return { success: false, error: message, errorStack: stack };
    }
  },
};

export const tool = auditTraceTool;
export default auditTraceTool;
