import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MatrixScenario, type MatrixConfig } from "../../matrix-copy.ts";
import { exportChaosLangChainJsonl } from "../../chaos-auditor-adapter.ts";
import type { Trace } from "../../trace.ts";
import { verifyPatch } from "../../verification/patch-verifier.ts";
import type { CodePatch } from "../../repair/patch-types.ts";

export interface ToolContext {
  sessionId?: string;
  auditor?: AuditorModule;
  [key: string]: unknown;
}

export interface ToolResult {
  success: boolean;
  [key: string]: unknown;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  handler: (args: Record<string, unknown>, context?: ToolContext) => Promise<ToolResult>;
}

export type Finding = {
  rule_id?: string;
  pillar?: string;
  status?: string;
  severity?: string;
  message?: string;
  evidence?: {
    span_ids?: string[];
    [key: string]: unknown;
  };
  repro?: string;
  suggested_fix?: string;
  [key: string]: unknown;
};

interface AuditorModule {
  parseLangChainCallbackJsonl: (jsonl: string) => any;
  auditTrace: (trace: any) => Finding[];
}

function resolveAuditor(): AuditorModule {
  const envRepo = process.env.SIM_AUDITOR_REPO;
  const candidates = [
    envRepo,
    fileURLToPath(new URL("../../../../../resilient-agent-invariants", import.meta.url)),
    fileURLToPath(new URL("../../../../resilient-agent-invariants", import.meta.url)),
    fileURLToPath(new URL("../../../resilient-agent-invariants", import.meta.url)),
    fileURLToPath(new URL("../../resilient-agent-invariants", import.meta.url)),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  const repo = candidates.find((c) => existsSync(c));
  if (!repo) {
    throw new Error("Could not resolve resilient-agent-invariants repository");
  }

  const require = createRequire(import.meta.url);
  const distEntry = `${repo}/dist/src/index.js`;

  if (existsSync(distEntry)) {
    const mod = require(distEntry);
    return {
      parseLangChainCallbackJsonl: mod.parseLangChainCallbackJsonl,
      auditTrace: mod.auditTrace,
    };
  }

  throw new Error(`Auditor dist entry not found at ${distEntry}`);
}

function matchesFinding(f: Finding, ruleId: string): boolean {
  if (f.status !== "proven") return false;
  const fId = (f.rule_id || "").toLowerCase();
  const target = (ruleId || "").toLowerCase();
  if (fId === target) return true;
  if (target.startsWith("r04") && fId.startsWith("r04")) return true;
  if (target.startsWith("r05") && fId.startsWith("r05")) return true;
  if (target.startsWith("r10") && fId.startsWith("r10")) return true;
  if (target.startsWith("r11") && fId.startsWith("r11")) return true;
  return false;
}

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

function isValidConfig(cfg: unknown): cfg is MatrixConfig {
  if (!cfg || typeof cfg !== "object") return false;
  const c = cfg as Record<string, unknown>;
  return (
    typeof c.A === "string" &&
    VALID_DIALS.has(c.A) &&
    typeof c.B === "string" &&
    VALID_DIALS.has(c.B) &&
    typeof c.C === "string" &&
    VALID_DIALS.has(c.C) &&
    typeof c.D === "string" &&
    VALID_DIALS.has(c.D) &&
    typeof c.E === "string" &&
    VALID_DIALS.has(c.E) &&
    typeof c.F === "string" &&
    VALID_DIALS.has(c.F)
  );
}

export const verifyFixTool: McpTool = {
  name: "verify_fix",
  description:
    "Verify that a proposed fix makes a specific finding disappear. Runs both the original and fixed configs through the matrix + auditor, asserts the finding is present in original and absent in fixed. Returns before/after proof.",
  inputSchema: {
    type: "object",
    properties: {
      originalConfig: {
        type: "object",
        description: "MatrixConfig that produced the finding",
      },
      fixedConfig: {
        type: "object",
        description: "Proposed fixed MatrixConfig",
      },
      findingRuleId: {
        type: "string",
        description: "The rule_id of the finding to verify (e.g., 'r04-network-idempotency')",
      },
      patch: {
        type: "object",
        description: "CodePatch to verify with dial-equivalent config and business impact proof",
      },
    },
    required: ["originalConfig", "fixedConfig", "findingRuleId"],
  },
  async handler(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const originalConfig = args.originalConfig as MatrixConfig;
    const patch = args.patch as CodePatch | undefined;

    if (patch) {
      if (!originalConfig || !isValidConfig(originalConfig)) {
        return { success: false, error: "originalConfig with valid dials A-F is required" };
      }
      try {
        const verification = await verifyPatch(patch, originalConfig);
        return {
          success: true,
          ...verification,
        };
      } catch (err: any) {
        return { success: false, error: `Execution error during verify_fix: ${err.message || String(err)}` };
      }
    }

    const fixedConfig = args.fixedConfig as MatrixConfig;
    const findingRuleId = args.findingRuleId as string;

    if (!originalConfig || !isValidConfig(originalConfig)) {
      return { success: false, error: "originalConfig with valid dials A-F is required" };
    }
    if (!fixedConfig || !isValidConfig(fixedConfig)) {
      return { success: false, error: "fixedConfig with valid dials A-F is required" };
    }
    if (!findingRuleId || typeof findingRuleId !== "string" || findingRuleId.trim().length === 0) {
      return { success: false, error: "findingRuleId is required" };
    }

    let auditor: AuditorModule;
    if (context?.auditor) {
      auditor = context.auditor;
    } else {
      try {
        auditor = resolveAuditor();
      } catch (err: any) {
        return { success: false, error: `Failed to load auditor: ${err.message}` };
      }
    }

    try {
      // Run original
      const originalScenario = new MatrixScenario(originalConfig);
      originalScenario.run();
      const originalTrace = originalScenario.exportTrace() as Trace;
      const originalJsonl = exportChaosLangChainJsonl(originalTrace);
      const originalInternalTrace = auditor.parseLangChainCallbackJsonl(originalJsonl);
      let originalFindings = auditor.auditTrace(originalInternalTrace);

      // Run fixed
      const fixedScenario = new MatrixScenario(fixedConfig);
      fixedScenario.run();
      const fixedTrace = fixedScenario.exportTrace() as Trace;
      const fixedJsonl = exportChaosLangChainJsonl(fixedTrace);
      const fixedInternalTrace = auditor.parseLangChainCallbackJsonl(fixedJsonl);
      let fixedFindings = auditor.auditTrace(fixedInternalTrace);

      // Real matching findings only (NO synthesis)
      const originalMatchingFindings = originalFindings.filter((f) => matchesFinding(f, findingRuleId));
      const fixedMatchingFindings = fixedFindings.filter((f) => matchesFinding(f, findingRuleId));

      if (originalMatchingFindings.length === 0 && fixedMatchingFindings.length === 0) {
        return {
          success: true,
          findingRuleId,
          isFixed: false,
          before: {
            config: originalConfig,
            matchingFindingsCount: 0,
            allFindingsCount: originalFindings.length,
          },
          after: {
            config: fixedConfig,
            matchingFindingsCount: 0,
            allFindingsCount: fixedFindings.length,
          },
          proof: "NO_REAL_FINDING: auditor produced no proven findings for either config",
        };
      }

      const isFixed = originalMatchingFindings.length > 0 && fixedMatchingFindings.length === 0;

      return {
        success: true,
        findingRuleId,
        isFixed,
        before: {
          config: originalConfig,
          matchingFindingsCount: originalMatchingFindings.length,
          allFindingsCount: originalFindings.length,
        },
        after: {
          config: fixedConfig,
          matchingFindingsCount: fixedMatchingFindings.length,
          allFindingsCount: fixedFindings.length,
        },
        proof: isFixed
          ? `Original had ${originalMatchingFindings.length} proven ${findingRuleId} finding(s); fixed config has 0. Fix verified.`
          : `Original had ${originalMatchingFindings.length}; fixed still has ${fixedMatchingFindings.length}. Fix did NOT resolve the finding.`,
      };
    } catch (err: any) {
      return { success: false, error: `Execution error during verify_fix: ${err.message || String(err)}` };
    }
  },
};

export const tool = verifyFixTool;
export default verifyFixTool;
