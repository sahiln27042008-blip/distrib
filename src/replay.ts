import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MatrixScenario, type MatrixConfig, type MatrixSnapshot } from "./matrix-copy.ts";
import { exportChaosLangChainJsonl } from "./chaos-auditor-adapter.ts";
import type { Trace } from "./trace.ts";

export interface ReplayHandle {
  seed: number;
  matrixConfig: MatrixConfig;
  runId: string;
  createdAt: string;
  version: "replay-v1";
}

export interface ReplayResult {
  handle: ReplayHandle;
  snapshot: MatrixSnapshot;
  trace: Trace;
  findings: Finding[];
}

export type Finding = {
  rule_id?: string;
  status?: string;
  severity?: string;
  [key: string]: unknown;
};

const VALID_DIALS = new Set([
  "A1_single_task",
  "A2_mixed_saas",
  "A3_exec_demo_burst",
  "A4_bulk_crm_swarm",
  "A5_marathon_30step",
  "B1_zero_hold_2ms",
  "B2_stream_hog_30s",
  "B3_write_amp_15mb",
  "B4_hydration_freeze_4s",
  "B5_in_doubt_zombie_tx",
  "C1_clean_20ms",
  "C2_socket_drop_2ms_late",
  "C3_rate_limit_429_brownout",
  "C4_bulk_50_poison_pill",
  "C5_legacy_erp_no_idem",
  "D1_raw_json_80k_flood",
  "D2_append_only_quadratic",
  "D3_lossy_llm_summary",
  "D4_unmapped_schema_drift",
  "D5_cqrs_duckdb_blackboard_o1",
  "E1_god_mode_main_thread",
  "E2_walled_garden_stuck",
  "E3_hitl_fatigue_global_bool",
  "E4_state_leases_ipc_worker",
  "E5_audit_log_only_no_enforcement",
  "F1_blind_retry_unbounded_spend",
  "F2_ask_llm_to_undo",
  "F3_resilient_invariant_runtime",
  "F4_checkpoint_resume_limited",
  "F5_graceful_handoff_cascade",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidSeed(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4294967295;
}

function isValidDial(value: unknown): value is string {
  return typeof value === "string" && VALID_DIALS.has(value);
}

function isValidMatrixConfig(value: unknown): value is MatrixConfig {
  if (!isRecord(value)) return false;
  const keys: Array<keyof MatrixConfig> = [
    "seed",
    "runId",
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "humanUsers",
    "concurrentAgents",
    "dbPoolSize",
    "workflowSteps",
    "saasPriceUsd",
    "ticketValueUsd",
  ];

  if (!keys.every((key) => key in value)) return false;
  if (!isValidSeed(value.seed)) return false;
  if (typeof value.runId !== "string" || value.runId.length === 0) return false;
  if (!isValidDial(value.A) || !isValidDial(value.B) || !isValidDial(value.C) || !isValidDial(value.D) || !isValidDial(value.E) || !isValidDial(value.F)) {
    return false;
  }
  if (!Number.isInteger(value.humanUsers) || value.humanUsers < 0) return false;
  if (!Number.isInteger(value.concurrentAgents) || value.concurrentAgents < 0) return false;
  if (!Number.isInteger(value.dbPoolSize) || value.dbPoolSize <= 0) return false;
  if (!Number.isInteger(value.workflowSteps) || value.workflowSteps <= 0) return false;
  if (!Number.isFinite(value.saasPriceUsd) || value.saasPriceUsd < 0) return false;
  if (!Number.isFinite(value.ticketValueUsd) || value.ticketValueUsd < 0) return false;
  return true;
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(value, (_key, current) => {
    if (typeof current === "object" && current !== null) {
      if (seen.has(current)) return undefined;
      seen.add(current);
      if (Array.isArray(current)) return current;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(current as Record<string, unknown>).sort()) {
        sorted[key] = (current as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return current;
  });
}

export function createReplayHandle(config: MatrixConfig): ReplayHandle {
  return {
    seed: config.seed,
    matrixConfig: config,
    runId: config.runId,
    createdAt: new Date().toISOString(),
    version: "replay-v1",
  };
}

export function serializeHandle(handle: ReplayHandle): string {
  return stableStringify(handle);
}

export function deserializeHandle(json: string): ReplayHandle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("ReplayHandle is not valid JSON");
  }

  if (!isRecord(parsed)) {
    throw new Error("ReplayHandle must be an object");
  }

  if (parsed.version !== "replay-v1") {
    throw new Error("ReplayHandle version is invalid");
  }

  if (!isValidSeed(parsed.seed)) {
    throw new Error("ReplayHandle seed must be an integer in [0, 4294967295]");
  }

  if (typeof parsed.runId !== "string" || parsed.runId.length === 0) {
    throw new Error("ReplayHandle runId must be a non-empty string");
  }

  if (typeof parsed.createdAt !== "string" || Number.isNaN(Date.parse(parsed.createdAt))) {
    throw new Error("ReplayHandle createdAt must be an ISO timestamp");
  }

  if (!isValidMatrixConfig(parsed.matrixConfig)) {
    throw new Error("ReplayHandle matrixConfig is invalid");
  }

  return {
    seed: parsed.seed,
    matrixConfig: parsed.matrixConfig,
    runId: parsed.runId,
    createdAt: parsed.createdAt,
    version: "replay-v1",
  };
}

function resolveAuditorRepo(): string | null {
  const envRepo = process.env.SIM_AUDITOR_REPO;
  const candidates = [
    envRepo,
    fileURLToPath(new URL("../../resilient-agent-invariants", import.meta.url)),
    fileURLToPath(new URL("../../../resilient-agent-invariants", import.meta.url)),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function loadOptionalAuditor(): { parseLangChainCallbackJsonl: (input: string) => unknown; auditTrace: (trace: unknown) => Finding[] } | null {
  const repo = resolveAuditorRepo();
  if (!repo) return null;

  const require = createRequire(import.meta.url);
  const distEntry = `${repo}/dist/src/index.js`;

  try {
    const mod = require(distEntry);
    return {
      parseLangChainCallbackJsonl: mod.parseLangChainCallbackJsonl,
      auditTrace: mod.auditTrace,
    };
  } catch {
    return null;
  }
}

export function replay(handle: ReplayHandle): ReplayResult {
  const scenario = new MatrixScenario(handle.matrixConfig);
  scenario.run();
  const snapshot = scenario.snapshot();
  const trace = scenario.exportTrace() as Trace;
  const jsonl = exportChaosLangChainJsonl(trace);

  let findings: Finding[] = [];
  const auditor = loadOptionalAuditor();
  if (auditor) {
    try {
      const parsed = auditor.parseLangChainCallbackJsonl(jsonl);
      findings = auditor.auditTrace(parsed);
    } catch {
      findings = [];
    }
  }

  return {
    handle,
    snapshot,
    trace,
    findings,
  };
}
