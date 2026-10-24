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
    "Returns available simulation scenarios for diagnosing AI agent reliability failures (matrix, m7-chaos, m8-agent-lab).",
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
    };
  },
};

export const tool = listScenariosTool;
export default listScenariosTool;

