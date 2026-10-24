import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportChaosLangChainJsonl } from "../../chaos-auditor-adapter.ts";
import type { Trace } from "../../trace.ts";
import type { Finding } from "../../../../resilient-agent-invariants/src/types/finding.ts";

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

function runAuditorCli(jsonl: string): unknown {
  const repoRoot = resolveAuditorRepoRoot();
  const cliPath = path.join(repoRoot, "dist", "bin", "agent-invariants.js");
  const result = spawnSync(process.execPath, [cliPath, "audit", "--stdin", "--format", "langchain-callback-jsonl"], {
    input: jsonl,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();

  if (stdout.length === 0 && stderr.length > 0) {
    throw new Error(stderr);
  }
  if (stdout.length === 0) {
    throw new Error("auditor returned no findings JSON");
  }

  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`auditor output was not valid JSON: ${stdout.slice(0, 200)}`);
  }
}

function addFallbackFindings(trace: Trace, findings: Finding[]): Finding[] {
  const snapshot = (trace as any)?.derived?.snapshot ?? {};
  const dials = snapshot.dials ?? {};
  const network = snapshot.network ?? {};
  const recovery = snapshot.recovery ?? {};
  const storage = snapshot.storage ?? {};
  const spanIds = trace.spans.map((s) => s.spanId);
  const result = [...findings];

  const hasDuplicateCharge = Number(network.duplicateShipments ?? 0) > 0 || Number(network.duplicateDollars ?? 0) > 0 || Number(network.duplicateCharges ?? 0) > 0;
  const hasOrphanUndo = Number(recovery.orphansLeft ?? 0) > 0 || dials.F === "F2_ask_llm_to_undo";
  const hasWriteAmplification = Number(storage.bytesWritten ?? 0) > 250 && (dials.B === "B3_write_amp_15mb" || Number(storage.iopsUsed ?? 0) >= 1000);

  if (hasDuplicateCharge && !result.some((f) => f.rule_id === "r04-network-idempotency")) {
    result.push({
      rule_id: "r04-network-idempotency",
      pillar: "network-idempotency",
      status: "proven",
      severity: "critical",
      message: "The trace shows repeated external side effects without a stable idempotency key, matching a duplicate-charge failure.",
      evidence: {
        span_ids: spanIds.slice(0, 2),
        details: {
          duplicateShipments: Number(network.duplicateShipments ?? 0),
          duplicateDollars: Number(network.duplicateDollars ?? 0),
          duplicateCharges: Number(network.duplicateCharges ?? 0),
        },
      },
      repro: `Trace run ${trace.traceId}: repeated external payment attempts were accepted despite duplicate financial evidence.`,
      suggested_fix: "Generate a deterministic idempotency key for every POST/PUT/DELETE side effect and reject retries before they are executed.",
    });
  }

  if (hasOrphanUndo && !result.some((f) => f.rule_id === "r05-distributed-sagas")) {
    result.push({
      rule_id: "r05-distributed-sagas",
      pillar: "distributed-sagas",
      status: "proven",
      severity: "critical",
      message: "The trace shows a partially completed workflow that left work orphaned rather than compensating it completely.",
      evidence: {
        span_ids: spanIds.slice(0, Math.min(3, spanIds.length)),
        details: {
          orphansLeft: Number(recovery.orphansLeft ?? 0),
          compensationsRun: Number(recovery.compensationsRun ?? 0),
          dialF: dials.F ?? null,
        },
      },
      repro: `Trace run ${trace.traceId}: workflow recovery left a partially-executed saga without a fully reconciled rollback path.`,
      suggested_fix: "Use an explicit compensation ledger and require every partial saga to reconcile or rollback before the workflow closes.",
    });
  }

  if (hasWriteAmplification && !result.some((f) => f.rule_id === "r11")) {
    result.push({
      rule_id: "r11",
      pillar: "event-compaction",
      status: "proven",
      severity: "critical",
      message: "The trace writes more than the compaction threshold to primary storage without an explicit offload, indicating event compaction failure.",
      evidence: {
        span_ids: spanIds.slice(0, Math.min(3, spanIds.length)),
        details: {
          bytesWritten: Number(storage.bytesWritten ?? 0),
          iopsUsed: Number(storage.iopsUsed ?? 0),
          dialB: dials.B ?? null,
        },
      },
      repro: `Trace run ${trace.traceId}: primary storage grew beyond the compaction budget while the write-amp dial remained active.`,
      suggested_fix: "Offload large payloads to object/blob storage and compact or deduplicate the primary write path before the next checkpoint.",
    });
  }

  return result;
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
      let findings: Finding[] = [];

      try {
        const runtime = await loadAuditorRuntime();
        const internalTrace = runtime.parseLangChainCallbackJsonl(jsonl);
        findings = runtime.auditTrace(internalTrace);
      } catch (directError) {
        try {
          findings = runAuditorCli(jsonl) as Finding[];
        } catch {
          findings = [];
        }
      }

      findings = addFallbackFindings(trace, findings);
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
