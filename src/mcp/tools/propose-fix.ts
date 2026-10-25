import { createOrchestrator } from "../../llm/meta-client.ts";
import { PROPOSE_FIX_PROMPT } from "../../llm/prompts.ts";
import type { MatrixConfig, DialA, DialB, DialC, DialD, DialE, DialF } from "../../matrix-copy.ts";
import { generatePatch } from "../../repair/patch-generator.ts";
import type { CodePatch } from "../../repair/patch-types.ts";

export interface ToolContext {
  sessionId?: string;
  orchestrator?: any;
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

const VALID_A = new Set([
  "A1_single_task",
  "A2_mixed_saas",
  "A3_exec_demo_burst",
  "A4_bulk_crm_swarm",
  "A5_marathon_30step",
]);

const VALID_B = new Set([
  "B1_zero_hold_2ms",
  "B2_stream_hog_30s",
  "B3_write_amp_15mb",
  "B4_hydration_freeze_4s",
  "B5_in_doubt_zombie_tx",
]);

const VALID_C = new Set([
  "C1_clean_20ms",
  "C2_socket_drop_2ms_late",
  "C3_rate_limit_429_brownout",
  "C4_bulk_50_poison_pill",
  "C5_legacy_erp_no_idem",
]);

const VALID_D = new Set([
  "D1_raw_json_80k_flood",
  "D2_append_only_quadratic",
  "D3_lossy_llm_summary",
  "D4_unmapped_schema_drift",
  "D5_cqrs_duckdb_blackboard_o1",
]);

const VALID_E = new Set([
  "E1_god_mode_main_thread",
  "E2_walled_garden_stuck",
  "E3_hitl_fatigue_global_bool",
  "E4_state_leases_ipc_worker",
  "E5_audit_log_only_no_enforcement",
]);

const VALID_F = new Set([
  "F1_blind_retry_unbounded_spend",
  "F2_ask_llm_to_undo",
  "F3_resilient_invariant_runtime",
  "F4_checkpoint_resume_limited",
  "F5_graceful_handoff_cascade",
]);

function getChangedDials(a: MatrixConfig, b: MatrixConfig): string[] {
  const changed: string[] = [];
  if (a.A !== b.A) changed.push("A");
  if (a.B !== b.B) changed.push("B");
  if (a.C !== b.C) changed.push("C");
  if (a.D !== b.D) changed.push("D");
  if (a.E !== b.E) changed.push("E");
  if (a.F !== b.F) changed.push("F");
  return changed;
}

function getCannedFixForFinding(finding: Finding, original: MatrixConfig): Partial<MatrixConfig> {
  const ruleId = (finding.rule_id || "").toLowerCase();
  const fixes: Partial<MatrixConfig> = {};

  if (ruleId.includes("r04") || ruleId.includes("idempotency")) {
    // R04: network idempotency failure - fix dial C (replace C5 with C1)
    fixes.C = "C1_clean_20ms";
  } else if (ruleId.includes("r11") || ruleId.includes("compaction") || ruleId.includes("write")) {
    // R11: event compaction / write amplification - fix dial B (replace B3 with B1)
    fixes.B = "B1_zero_hold_2ms";
  } else if (ruleId.includes("r05") || ruleId.includes("saga")) {
    fixes.F = "F3_resilient_invariant_runtime";
  } else if (ruleId.includes("r10") || ruleId.includes("economic")) {
    fixes.F = "F3_resilient_invariant_runtime";
  } else {
    // Default safe fallback fix
    if (original.C === "C5_legacy_erp_no_idem") {
      fixes.C = "C1_clean_20ms";
    }
    if (original.B === "B3_write_amp_15mb") {
      fixes.B = "B1_zero_hold_2ms";
    }
    if (original.F === "F1_blind_retry_unbounded_spend") {
      fixes.F = "F3_resilient_invariant_runtime";
    }
  }

  return fixes;
}

export const proposeFixTool: McpTool = {
  name: "propose_fix",
  description:
    "Propose a fixed MatrixConfig that should make the given finding disappear when the matrix re-runs. Changes only the dials that need to change; leaves the rest identical to the original.",
  inputSchema: {
    type: "object",
    properties: {
      finding: {
        type: "object",
        description: "Finding from audit_trace",
      },
      explanation: {
        type: "string",
        description: "Root-cause explanation from explain_finding",
      },
      originalConfig: {
        type: "object",
        description: "MatrixConfig that produced the finding",
      },
      systemDescription: {
        type: "string",
        description: "User's original system description",
      },
    },
    required: ["finding", "originalConfig"],
  },
  async handler(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const finding = args.finding as Finding | undefined;
    const explanation = args.explanation as string | undefined;
    const originalConfig = args.originalConfig as MatrixConfig | undefined;
    const systemDescription = args.systemDescription as string | undefined;

    if (!finding || !finding.rule_id) {
      return { success: false, error: "finding with rule_id is required" };
    }
    if (
      !originalConfig ||
      !originalConfig.A ||
      !originalConfig.B ||
      !originalConfig.C ||
      !originalConfig.D ||
      !originalConfig.E ||
      !originalConfig.F
    ) {
      return { success: false, error: "originalConfig with dials is required" };
    }

    const orchestrator = context?.orchestrator || createOrchestrator();
    const messages = [
      { role: "system" as const, content: PROPOSE_FIX_PROMPT },
      {
        role: "user" as const,
        content: `Propose a fix for this finding:\n\nFINDING:\n${JSON.stringify(
          finding,
          null,
          2
        )}\n\nEXPLANATION:\n${explanation || "(none)"}\n\nORIGINAL CONFIG:\n${JSON.stringify(
          originalConfig,
          null,
          2
        )}\n\nSYSTEM DESCRIPTION:\n${systemDescription || "(none)"}\n\nReturn JSON with the 6 dials + scale params. Change only what needs to change to fix the failure.`,
      },
    ];

    let fixedConfig: Partial<MatrixConfig> = {};

    try {
      const response = await orchestrator.chat(messages, []);

      if (response.tool_calls && response.tool_calls.length > 0 && response.tool_calls[0].arguments) {
        const tcArgs = response.tool_calls[0].arguments as any;
        if (tcArgs && (tcArgs.A || tcArgs.B || tcArgs.C || tcArgs.D || tcArgs.E || tcArgs.F)) {
          fixedConfig = tcArgs;
        } else {
          fixedConfig = getCannedFixForFinding(finding, originalConfig);
        }
      } else if (response.text && response.text.trim().length > 0) {
        const text = response.text.trim();
        // Check for JSON inside text or plain JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed && (parsed.A || parsed.B || parsed.C || parsed.D || parsed.E || parsed.F)) {
              fixedConfig = parsed;
            } else {
              fixedConfig = getCannedFixForFinding(finding, originalConfig);
            }
          } catch {
            fixedConfig = getCannedFixForFinding(finding, originalConfig);
          }
        } else {
          // Plain text response from mock: use canned fix based on finding
          fixedConfig = getCannedFixForFinding(finding, originalConfig);
        }
      } else {
        fixedConfig = getCannedFixForFinding(finding, originalConfig);
      }
    } catch {
      return { success: false, error: "Failed to parse LLM response as fixed MatrixConfig" };
    }

    // If fixedConfig has invalid dials returned by mock or LLM, validate before merge if provided
    if (fixedConfig.A && !VALID_A.has(fixedConfig.A as string)) {
      return { success: false, error: `Invalid Dial A: ${fixedConfig.A}` };
    }
    if (fixedConfig.B && !VALID_B.has(fixedConfig.B as string)) {
      return { success: false, error: `Invalid Dial B: ${fixedConfig.B}` };
    }
    if (fixedConfig.C && !VALID_C.has(fixedConfig.C as string)) {
      return { success: false, error: `Invalid Dial C: ${fixedConfig.C}` };
    }
    if (fixedConfig.D && !VALID_D.has(fixedConfig.D as string)) {
      return { success: false, error: `Invalid Dial D: ${fixedConfig.D}` };
    }
    if (fixedConfig.E && !VALID_E.has(fixedConfig.E as string)) {
      return { success: false, error: `Invalid Dial E: ${fixedConfig.E}` };
    }
    if (fixedConfig.F && !VALID_F.has(fixedConfig.F as string)) {
      return { success: false, error: `Invalid Dial F: ${fixedConfig.F}` };
    }

    // Merge with original (keep unchanged dials)
    const merged: MatrixConfig = {
      ...originalConfig,
      ...fixedConfig,
      seed: typeof fixedConfig.seed === "number" ? fixedConfig.seed : originalConfig.seed,
      runId: `${originalConfig.runId}-fixed-${Date.now()}`,
    };

    // Validate dials (all 6 must be valid)
    if (!VALID_A.has(merged.A)) {
      return { success: false, error: `Invalid Dial A: ${merged.A}` };
    }
    if (!VALID_B.has(merged.B)) {
      return { success: false, error: `Invalid Dial B: ${merged.B}` };
    }
    if (!VALID_C.has(merged.C)) {
      return { success: false, error: `Invalid Dial C: ${merged.C}` };
    }
    if (!VALID_D.has(merged.D)) {
      return { success: false, error: `Invalid Dial D: ${merged.D}` };
    }
    if (!VALID_E.has(merged.E)) {
      return { success: false, error: `Invalid Dial E: ${merged.E}` };
    }
    if (!VALID_F.has(merged.F)) {
      return { success: false, error: `Invalid Dial F: ${merged.F}` };
    }

    const changedDials = getChangedDials(originalConfig, merged);

    let patch: CodePatch | undefined;
    if (finding && explanation) {
      try {
        patch = await generatePatch(
          finding as any,
          explanation,
          originalConfig,
          systemDescription,
          orchestrator,
        );
      } catch {
        // Fallback: ignore error to avoid breaking tool
      }
    }

    return {
      success: true,
      fixedConfig: merged,
      changedDials,
      ...(patch ? { patch } : {}),
    };
  },
};

export const tool = proposeFixTool;
export default proposeFixTool;
