// enterpriseee/enterprise-simulator/src/mcp/tools/causal-cliff.ts

import { findCollapseCliff } from "../../physics/search/cliff-finder.ts";
import { resolveScenario, resolveWorkflow, workflowToGraph, type ToolContext, type ToolResult, type McpTool } from "./causal-audit.ts";

export const causalCliffTool: McpTool = {
  name: "sweep_latency_cliff",
  description:
    "Uses binary search to pinpoint the exact millisecond collapse cliff for a channel parameter (e.g., safe at 29,950ms, collapses at 30,050ms).",
  inputSchema: {
    type: "object",
    properties: {
      scenarioId: { type: "string" },
      targetChannel: { type: "string", description: "Channel ID to sweep" },
      minMs: { type: "number", default: 0 },
      maxMs: { type: "number", default: 60000 },
      tolerance: { type: "number", default: 50 },
      seed: { type: "number", default: 42817 },
    },
    required: ["scenarioId", "targetChannel"],
  },
  async handler(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const scenarioId = args.scenarioId as string | undefined;
    if (!scenarioId || typeof scenarioId !== "string" || scenarioId.trim() === "") {
      return {
        success: false,
        error: "scenarioId is required",
      };
    }

    const targetChannel = args.targetChannel as string | undefined;
    if (!targetChannel || typeof targetChannel !== "string" || targetChannel.trim() === "") {
      return {
        success: false,
        error: "targetChannel is required",
      };
    }

    const normalizedScenarioId = scenarioId.trim().replace(/\./g, "-").toLowerCase();
    const scenario = resolveScenario(normalizedScenarioId);
    const workflow = scenario ? undefined : resolveWorkflow(scenarioId, context?.sessionId);
    if (!scenario && !workflow) {
      return {
        success: false,
        error: `Unknown scenario: ${scenarioId}`,
      };
    }

    const minMs =
      typeof args.minMs === "number" && Number.isFinite(args.minMs) ? args.minMs : 0;
    const maxMs =
      typeof args.maxMs === "number" && Number.isFinite(args.maxMs) ? args.maxMs : 60000;
    const tolerance =
      typeof args.tolerance === "number" && Number.isFinite(args.tolerance)
        ? args.tolerance
        : 50;
    const seed =
      typeof args.seed === "number" && Number.isFinite(args.seed)
        ? Math.floor(args.seed)
        : 42817;

    const startedAt = performance.now();
    const graph = scenario ? scenario.buildGraph() : workflowToGraph(workflow!);

    const channelExists =
      graph.channels.some((c) => c.id === targetChannel) ||
      graph.vowels.some((v) => v.id === targetChannel && v.kind === "CHANNEL");

    if (!channelExists) {
      return {
        success: false,
        error: `Target channel '${targetChannel}' not found in workflow or scenario '${scenarioId}'`,
      };
    }

    try {
      const cliff = await findCollapseCliff(
        graph,
        {
          name: "durationMs",
          targetVowelId: targetChannel,
          consonantKind: "DELAY",
          paramKey: "durationMs",
        },
        {
          low: minMs,
          high: maxMs,
          tolerance,
          maxIterations: 30,
        },
        seed,
      );

      const cliffMs =
        cliff.estimatedThreshold ??
        (cliff.lowerSafeBound !== undefined && cliff.upperFailureBound !== undefined
          ? (cliff.lowerSafeBound + cliff.upperFailureBound) / 2
          : undefined);

      return {
        success: true,
        status: cliff.status,
        scenarioId: scenario?.id ?? workflow?.id,
        targetChannel,
        testedRange: cliff.testedRange,
        cliffMs,
        safeMs: cliff.lowerSafeBound,
        collapseMs: cliff.upperFailureBound,
        evaluationsCount: cliff.evaluations,
        iterations: cliff.iterations,
        tolerance: cliff.tolerance,
        durationMs: performance.now() - startedAt,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || String(err),
      };
    }
  },
};

export const tool = causalCliffTool;
export default causalCliffTool;

