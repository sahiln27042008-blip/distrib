import { createOrchestrator } from "../../llm/meta-client.ts";
import { DESCRIBE_SYSTEM_PROMPT } from "../../llm/prompts.ts";
import type {
  MatrixConfig,
  DialA,
  DialB,
  DialC,
  DialD,
  DialE,
  DialF,
} from "../../matrix-copy.ts";

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

const VALID_DIAL_A = new Set([
  "A1_single_task",
  "A2_mixed_saas",
  "A3_exec_demo_burst",
  "A4_bulk_crm_swarm",
  "A5_marathon_30step",
]);

const VALID_DIAL_B = new Set([
  "B1_zero_hold_2ms",
  "B2_stream_hog_30s",
  "B3_write_amp_15mb",
  "B4_hydration_freeze_4s",
  "B5_in_doubt_zombie_tx",
]);

const VALID_DIAL_C = new Set([
  "C1_clean_20ms",
  "C2_socket_drop_2ms_late",
  "C3_rate_limit_429_brownout",
  "C4_bulk_50_poison_pill",
  "C5_legacy_erp_no_idem",
]);

const VALID_DIAL_D = new Set([
  "D1_raw_json_80k_flood",
  "D2_append_only_quadratic",
  "D3_lossy_llm_summary",
  "D4_unmapped_schema_drift",
  "D5_cqrs_duckdb_blackboard_o1",
]);

const VALID_DIAL_E = new Set([
  "E1_god_mode_main_thread",
  "E2_walled_garden_stuck",
  "E3_hitl_fatigue_global_bool",
  "E4_state_leases_ipc_worker",
  "E5_audit_log_only_no_enforcement",
]);

const VALID_DIAL_F = new Set([
  "F1_blind_retry_unbounded_spend",
  "F2_ask_llm_to_undo",
  "F3_resilient_invariant_runtime",
  "F4_checkpoint_resume_limited",
  "F5_graceful_handoff_cascade",
]);

export function mapKeywordsToDials(description: string): Partial<MatrixConfig> {
  const lower = description.toLowerCase();

  // Baseline default resilient config: A2, B1, C1, D5, E4, F3
  let A: DialA = "A2_mixed_saas";
  let B: DialB = "B1_zero_hold_2ms";
  let C: DialC = "C1_clean_20ms";
  let D: DialD = "D5_cqrs_duckdb_blackboard_o1";
  let E: DialE = "E4_state_leases_ipc_worker";
  let F: DialF = "F3_resilient_invariant_runtime";

  // Dial A mapping
  if (lower.includes("single task") || lower.includes("single_task") || lower.includes("single agent")) {
    A = "A1_single_task";
  } else if (lower.includes("demo burst") || lower.includes("burst")) {
    A = "A3_exec_demo_burst";
  } else if (lower.includes("crm swarm") || lower.includes("bulk crm") || lower.includes("swarm")) {
    A = "A4_bulk_crm_swarm";
  } else if (lower.includes("marathon") || lower.includes("30 step") || lower.includes("long running")) {
    A = "A5_marathon_30step";
  }

  // Dial B mapping
  if (lower.includes("streaming") || lower.includes("stream hog") || lower.includes("stream_hog")) {
    B = "B2_stream_hog_30s";
  } else if (lower.includes("write amp") || lower.includes("write_amp") || lower.includes("storage")) {
    B = "B3_write_amp_15mb";
  } else if (lower.includes("hydration") || lower.includes("freeze")) {
    B = "B4_hydration_freeze_4s";
  } else if (lower.includes("zombie") || lower.includes("in doubt")) {
    B = "B5_in_doubt_zombie_tx";
  }

  // Dial C mapping
  if (lower.includes("socket drop") || lower.includes("socket_drop") || lower.includes("drop 2ms")) {
    C = "C2_socket_drop_2ms_late";
  } else if (lower.includes("rate limit") || lower.includes("429") || lower.includes("brownout")) {
    C = "C3_rate_limit_429_brownout";
  } else if (lower.includes("poison pill") || lower.includes("poison")) {
    C = "C4_bulk_50_poison_pill";
  } else if (lower.includes("idempotency") || lower.includes("legacy erp") || lower.includes("no idem") || /\berp\b/i.test(lower)) {
    C = "C5_legacy_erp_no_idem";
  }

  // Dial D mapping
  if (lower.includes("raw json") || lower.includes("80k flood") || lower.includes("flood")) {
    D = "D1_raw_json_80k_flood";
  } else if (lower.includes("append only") || lower.includes("quadratic")) {
    D = "D2_append_only_quadratic";
  } else if (lower.includes("lossy") || lower.includes("summary")) {
    D = "D3_lossy_llm_summary";
  } else if (lower.includes("schema drift") || lower.includes("unmapped")) {
    D = "D4_unmapped_schema_drift";
  }

  // Dial E mapping
  if (lower.includes("god mode") || lower.includes("main thread") || lower.includes("injection")) {
    E = "E1_god_mode_main_thread";
  } else if (lower.includes("walled garden") || lower.includes("stuck")) {
    E = "E2_walled_garden_stuck";
  } else if (lower.includes("fatigue") || lower.includes("hitl")) {
    E = "E3_hitl_fatigue_global_bool";
  } else if (lower.includes("audit log only") || lower.includes("no enforcement")) {
    E = "E5_audit_log_only_no_enforcement";
  }

  // Dial F mapping
  if (lower.includes("retry") || lower.includes("unbounded spend") || lower.includes("blind retry")) {
    F = "F1_blind_retry_unbounded_spend";
  } else if (lower.includes("ask llm to undo") || lower.includes("undo") || lower.includes("orphan")) {
    F = "F2_ask_llm_to_undo";
  } else if (lower.includes("checkpoint") || lower.includes("resume")) {
    F = "F4_checkpoint_resume_limited";
  } else if (lower.includes("handoff") || lower.includes("cascade")) {
    F = "F5_graceful_handoff_cascade";
  }

  // Refund workflow keyword specialization
  if (lower.includes("refund")) {
    C = "C5_legacy_erp_no_idem";
    F = "F1_blind_retry_unbounded_spend";
  }

  return { A, B, C, D, E, F };
}

export const describeSystemTool: McpTool = {
  name: "describe_system",
  description:
    "Maps a natural-language description of an AI agent system to a 6-dial MatrixConfig (Dials A-F plus scale parameters).",
  inputSchema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "Natural-language description of the user's AI agent system",
      },
    },
    required: ["description"],
  },
  async handler(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const description = args.description;
    if (!description || typeof description !== "string" || description.trim().length === 0) {
      return { success: false, error: "description is required" };
    }

    const orchestrator = context?.orchestrator || createOrchestrator();

    const messages = [
      { role: "system" as const, content: DESCRIBE_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: `Map this system description to a MatrixConfig:\n\n${description}`,
      },
    ];

    let config: Partial<MatrixConfig> | undefined;

    try {
      const response = await orchestrator.chat(messages, []);

      // If response has tool_calls with dials
      if (
        response.tool_calls &&
        response.tool_calls.length > 0 &&
        response.tool_calls[0] &&
        (response.tool_calls[0].arguments as any)?.A
      ) {
        config = response.tool_calls[0].arguments as any;
      } else if (response.text && response.text.trim().startsWith("{")) {
        config = JSON.parse(response.text);
      } else {
        // Fallback for mock orchestrator or non-JSON text: keyword mapping
        config = mapKeywordsToDials(description);
      }
    } catch {
      config = mapKeywordsToDials(description);
    }

    if (!config || typeof config !== "object") {
      config = mapKeywordsToDials(description);
    }

    // Validate dials against valid enum definitions
    if (!config.A || !VALID_DIAL_A.has(config.A as string)) {
      return { success: false, error: `Invalid Dial A: ${config.A}` };
    }
    if (!config.B || !VALID_DIAL_B.has(config.B as string)) {
      return { success: false, error: `Invalid Dial B: ${config.B}` };
    }
    if (!config.C || !VALID_DIAL_C.has(config.C as string)) {
      return { success: false, error: `Invalid Dial C: ${config.C}` };
    }
    if (!config.D || !VALID_DIAL_D.has(config.D as string)) {
      return { success: false, error: `Invalid Dial D: ${config.D}` };
    }
    if (!config.E || !VALID_DIAL_E.has(config.E as string)) {
      return { success: false, error: `Invalid Dial E: ${config.E}` };
    }
    if (!config.F || !VALID_DIAL_F.has(config.F as string)) {
      return { success: false, error: `Invalid Dial F: ${config.F}` };
    }

    const fullConfig: MatrixConfig = {
      seed: typeof config.seed === "number" ? config.seed : 42,
      runId: typeof config.runId === "string" ? config.runId : `describe-${Date.now()}`,
      A: config.A as DialA,
      B: config.B as DialB,
      C: config.C as DialC,
      D: config.D as DialD,
      E: config.E as DialE,
      F: config.F as DialF,
      humanUsers: typeof config.humanUsers === "number" ? config.humanUsers : 50,
      concurrentAgents: typeof config.concurrentAgents === "number" ? config.concurrentAgents : 10,
      dbPoolSize: typeof config.dbPoolSize === "number" ? config.dbPoolSize : 20,
      workflowSteps: typeof config.workflowSteps === "number" ? config.workflowSteps : 10,
      saasPriceUsd: typeof config.saasPriceUsd === "number" ? config.saasPriceUsd : 20,
      ticketValueUsd: typeof config.ticketValueUsd === "number" ? config.ticketValueUsd : 5,
    };

    return { success: true, config: fullConfig };
  },
};

export const tool = describeSystemTool;
export default describeSystemTool;
