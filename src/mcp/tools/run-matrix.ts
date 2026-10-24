import { MatrixScenario, type MatrixConfig } from "../../matrix-copy.ts";

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

export const runMatrixTool: McpTool = {
  name: "run_matrix",
  description:
    "Runs the combinatorial enterprise matrix simulator with a given 6-dial MatrixConfig and returns execution snapshot and trace.",
  inputSchema: {
    type: "object",
    properties: {
      config: {
        type: "object",
        description: "MatrixConfig with all 6 dials + scale params",
      },
    },
    required: ["config"],
  },
  async handler(args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const rawConfig = args.config as Partial<MatrixConfig> | undefined;

    if (
      !rawConfig ||
      typeof rawConfig !== "object" ||
      !rawConfig.A ||
      !rawConfig.B ||
      !rawConfig.C ||
      !rawConfig.D ||
      !rawConfig.E ||
      !rawConfig.F
    ) {
      return {
        success: false,
        error: "config with all 6 dials is required",
      };
    }

    const fullConfig: MatrixConfig = {
      seed: typeof rawConfig.seed === "number" ? rawConfig.seed : 42,
      runId: typeof rawConfig.runId === "string" ? rawConfig.runId : `matrix-${Date.now()}`,
      A: rawConfig.A,
      B: rawConfig.B,
      C: rawConfig.C,
      D: rawConfig.D,
      E: rawConfig.E,
      F: rawConfig.F,
      humanUsers: typeof rawConfig.humanUsers === "number" ? rawConfig.humanUsers : 50,
      concurrentAgents: typeof rawConfig.concurrentAgents === "number" ? rawConfig.concurrentAgents : 10,
      dbPoolSize: typeof rawConfig.dbPoolSize === "number" ? rawConfig.dbPoolSize : 20,
      workflowSteps: typeof rawConfig.workflowSteps === "number" ? rawConfig.workflowSteps : 10,
      saasPriceUsd: typeof rawConfig.saasPriceUsd === "number" ? rawConfig.saasPriceUsd : 20,
      ticketValueUsd: typeof rawConfig.ticketValueUsd === "number" ? rawConfig.ticketValueUsd : 5,
    };

    try {
      const scenario = new MatrixScenario(fullConfig);
      scenario.run();
      const snapshot = scenario.snapshot();
      const trace = scenario.exportTrace();

      return {
        success: true,
        config: fullConfig,
        snapshot,
        trace,
        traceId: trace.traceId,
        virtualTimeMs: snapshot.virtualTimeMs,
        life: snapshot.totals ? "finished" : "error",
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || String(err),
        config: rawConfig,
      };
    }
  },
};

export const tool = runMatrixTool;
export default runMatrixTool;

