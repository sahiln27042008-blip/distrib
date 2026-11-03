export interface ToolContext {
  sessionId?: string;
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

export const listScenariosTool: McpTool = {
  name: "list_scenarios",
  description:
    "Returns available simulation scenarios for diagnosing AI agent reliability failures (matrix, m7-chaos, m8-agent-lab, and enterprise workflows).",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  async handler(_args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    return {
      success: true,
      scenarios: [
        {
          name: "matrix",
          description:
            "Combinatorial matrix with 6 dials (5^6 = 15,625 configs). Best for diagnosing AI agent reliability failures via dial-driven failure injection.",
          configType: "MatrixConfig",
        },
        {
          name: "m7-chaos",
          description:
            "10-tenant enterprise chaos lab with fixed incidents (pool starvation, payment ECONNRESET, child-process SIGSEGV, saga failure, Eastgate batch poison). Best for demonstrating specific failure modes.",
          configType: "ChaosConfig",
        },
        {
          name: "m8-agent-lab",
          description:
            "Agent context lab — 10-turn support workflow with prompt growth + DB hold + tool registry. Best for context-bloat and token-waste diagnosis.",
          configType: "AgentContextConfig",
        },
      ],
      enterpriseScenarios: [
        {
          name: "wf-multitenant-saga-reversal",
          description:
            "50 tenants, Little's Law queue saturation on V3: LEASE, shipping failure, un-idempotent retry.",
          configType: "DistribScenarioDefinition",
        },
        {
          name: "wf-speculative-batch-unrolling",
          description:
            "Malformed schema on Agent 4, burst unroll triggering HTTP 429 and quadratic context bloat on V2: LOG.",
          configType: "DistribScenarioDefinition",
        },
        {
          name: "wf-zombie-checkpoint-desync",
          description:
            "Container SIGKILL at t=16ms, un-flushed write-ahead log, duplicate vector embeddings on restart.",
          configType: "DistribScenarioDefinition",
        },
        {
          name: "wf-epistemic-context-tax",
          description:
            "Raw 80k JSON flood, TTFT latency cliff, missing SHA-256 claim-check tickets.",
          configType: "DistribScenarioDefinition",
        },
      ],
    };
  },
};

export const tool = listScenariosTool;
export default listScenariosTool;
