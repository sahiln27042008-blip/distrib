// enterpriseee/enterprise-simulator/src/mcp/tools/causal-audit.ts

import { searchFaults } from "../../physics/search/fault-search.ts";
import { SCENARIO_DEFINITIONS } from "../../physics/distrib/distrib-scenarios.ts";
import { buildAdversarialAgentWorld } from "../../physics/distrib/distrib-world.ts";
import { Channel } from "../../physics/alphabet/vowels/channel.ts";
import { Cell } from "../../physics/alphabet/vowels/cell.ts";
import type { CompiledAlphabetGraph } from "../../physics/alphabet/types.ts";

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

export interface ResolvedScenario {
  id: string;
  name: string;
  description: string;
  isRepresentable: boolean;
  unrepresentableReason?: string;
  buildGraph: (ablation?: string) => CompiledAlphabetGraph;
  candidateFaults: Array<{
    consonantKind: "DELAY" | "SEVER" | "DUPLICATE" | "SATURATE" | "WIPE" | "CORRUPT";
    targetVowelId: string;
    params: Record<string, unknown>;
  }>;
}

export function resolveScenario(scenarioId: string): ResolvedScenario | undefined {
  const norm = scenarioId.trim().toLowerCase();

  // Special scenario: timeout-cliff
  if (norm === "timeout-cliff" || norm === "scenario-cliff" || norm === "cliff") {
    return {
      id: "timeout-cliff",
      name: "Channel Timeout Collapse Cliff",
      description: "Channel with 30,000ms timeout collapsing into duplicate mutation on timeout",
      isRepresentable: true,
      buildGraph: () => {
        const cell = new Cell({
          id: "cell-target-unidem",
          actorId: "actor-server",
          persistence: "DURABLE",
          idempotencyEnforced: false,
          fencingTokenEnforced: false,
        });
        const channel = new Channel({
          id: "chan-timeout-cliff",
          sourceActorId: "actor-client",
          targetActorId: "actor-server",
          timeoutMs: 30000,
        });
        return {
          actors: [
            { id: "actor-client", name: "Client" },
            { id: "actor-server", name: "Server" },
          ],
          vowels: [cell, channel],
          channels: [channel],
          contracts: [],
          candidatePerturbations: [
            { consonant: { kind: "DELAY", durationMs: 35000 }, targetId: channel.id },
          ],
          epistemicStatus: ["OBSERVED"],
          unrepresentableSemantics: [],
        };
      },
      candidateFaults: [
        { consonantKind: "DELAY", targetVowelId: "chan-timeout-cliff", params: { durationMs: 35000 } },
      ],
    };
  }

  // Alias for known safe scenario
  if (norm === "scenario-safe" || norm === "safe-scenario" || norm === "safe") {
    const sB = SCENARIO_DEFINITIONS.find((s) => s.id === "scenario-B");
    if (sB) {
      return {
        id: "scenario-safe",
        name: sB.name,
        description: sB.description,
        isRepresentable: true,
        buildGraph: () => sB.buildGraph(),
        candidateFaults: sB.candidateFaults as any,
      };
    }
  }

  // Alias for known failing scenario
  if (norm === "scenario-failing" || norm === "failing-scenario" || norm === "failing") {
    const sA = SCENARIO_DEFINITIONS.find((s) => s.id === "scenario-A");
    if (sA) {
      return {
        id: "scenario-failing",
        name: sA.name,
        description: sA.description,
        isRepresentable: true,
        buildGraph: (ab) => sA.buildGraph(ab),
        candidateFaults: sA.candidateFaults as any,
      };
    }
  }

  // Lookup in SCENARIO_DEFINITIONS by id or normalized id
  const def = SCENARIO_DEFINITIONS.find(
    (s) =>
      s.id.toLowerCase() === norm ||
      s.id.toLowerCase() === `scenario-${norm}` ||
      s.id.toLowerCase().replace(/^scenario-/, "") === norm,
  );

  if (def) {
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      isRepresentable: def.isRepresentable,
      unrepresentableReason: def.unrepresentableReason,
      buildGraph: (ab) => def.buildGraph(ab),
      candidateFaults: def.candidateFaults as any,
    };
  }

  return undefined;
}

export const causalAuditTool: McpTool = {
  name: "audit_workflow_reliability",
  description:
    "Runs Iterative Deepening BFS across the 10-letter causal alphabet to find minimal compound failures. Returns APPROVED/BLOCKED verdict with the shortest failure sequence.",
  inputSchema: {
    type: "object",
    properties: {
      scenarioId: {
        type: "string",
        description: "Scenario ID to evaluate",
      },
      maxDepth: {
        type: "number",
        description: "Max fault interaction depth (default 2)",
        default: 2,
      },
      seed: {
        type: "number",
        description: "Deterministic seed (default 42817)",
        default: 42817,
      },
    },
    required: ["scenarioId"],
  },
  async handler(args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const scenarioId = args.scenarioId as string | undefined;

    if (!scenarioId || typeof scenarioId !== "string" || scenarioId.trim() === "") {
      return {
        success: false,
        error: "scenarioId is required",
      };
    }

    const scenario = resolveScenario(scenarioId);
    if (!scenario) {
      return {
        success: false,
        error: `Unknown scenario: ${scenarioId}`,
      };
    }

    if (!scenario.isRepresentable) {
      return {
        success: true,
        verdict: "BLOCKED",
        status: "INSUFFICIENT_PHYSICS",
        scenarioId: scenario.id,
        shortestDepth: null,
        minimalCounterexample: [],
        violatedInvariants: [],
        evaluationsCount: 0,
        durationMs: 0,
        unrepresentableReason: scenario.unrepresentableReason ?? "INSUFFICIENT_PHYSICS",
      };
    }

    const maxDepth =
      typeof args.maxDepth === "number" && Number.isFinite(args.maxDepth)
        ? Math.max(0, Math.floor(args.maxDepth))
        : 2;
    const seed =
      typeof args.seed === "number" && Number.isFinite(args.seed)
        ? Math.floor(args.seed)
        : 42817;

    const startedAt = performance.now();
    const graph = scenario.buildGraph();

    if (scenario.candidateFaults && scenario.candidateFaults.length > 0) {
      graph.candidatePerturbations = scenario.candidateFaults.map((f) => ({
        consonant: { kind: f.consonantKind, ...f.params } as any,
        targetId: f.targetVowelId,
      }));
    }

    try {
      const searchResult = await searchFaults(
        graph,
        {
          maxDepth,
          maxEvaluations: 5000,
        },
        seed,
      );

      const isApproved = searchResult.status === "NO_FAILURE_WITHIN_BOUND";
      const verdict = isApproved ? "APPROVED" : "BLOCKED";

      return {
        success: true,
        verdict,
        status: searchResult.status,
        scenarioId: scenario.id,
        shortestDepth: searchResult.minimalCounterexample
          ? searchResult.minimalCounterexample.length
          : isApproved
            ? null
            : searchResult.depthReached,
        minimalCounterexample: searchResult.minimalCounterexample ?? [],
        violatedInvariants: searchResult.violatedInvariants ?? [],
        evaluationsCount: searchResult.evaluations,
        durationMs: searchResult.durationMs ?? performance.now() - startedAt,
        fingerprint: searchResult.deterministicFingerprint,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || String(err),
      };
    }
  },
};

export const tool = causalAuditTool;
export default causalAuditTool;

