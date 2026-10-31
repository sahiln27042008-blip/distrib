// enterpriseee/enterprise-simulator/src/mcp/tools/causal-verify.ts

import { searchFaults } from "../../physics/search/fault-search.ts";
import { resolveScenario, resolveWorkflow, workflowToGraph, type ToolContext, type ToolResult, type McpTool } from "./causal-audit.ts";
import { Cell } from "../../physics/alphabet/vowels/cell.ts";
import { Lease } from "../../physics/alphabet/vowels/lease.ts";

export const causalVerifyTool: McpTool = {
  name: "verify_architecture_patch",
  description:
    "Re-runs the BFS engine with resilient ablations (e.g., idempotency keys, zero-hold leasing) to prove zero regressions after a proposed fix.",
  inputSchema: {
    type: "object",
    properties: {
      scenarioId: { type: "string" },
      seed: { type: "number", default: 42817 },
      ablation: {
        type: "string",
        enum: ["enforce_idempotency", "fencing_token_enabled", "zero_hold_lease", "idempotency", "fencing", "lease", "release_before_llm"],
      },
    },
    required: ["scenarioId", "ablation"],
  },
  async handler(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const scenarioId = args.scenarioId as string | undefined;
    if (!scenarioId || typeof scenarioId !== "string" || scenarioId.trim() === "") {
      return {
        success: false,
        error: "scenarioId is required",
      };
    }

    const ablation = args.ablation as string | undefined;
    if (!ablation || typeof ablation !== "string" || ablation.trim() === "") {
      return {
        success: false,
        error: "ablation is required",
      };
    }

    const ablationAliases: Record<string, string> = {
      idempotency: "enforce_idempotency",
      fencing: "fencing_token_enabled",
      lease: "zero_hold_lease",
      release_before_llm: "zero_hold_lease",
    };
    const normalizedAblation = ablationAliases[ablation] ?? ablation;
    if (!["enforce_idempotency", "fencing_token_enabled", "zero_hold_lease"].includes(normalizedAblation)) {
      return {
        success: false,
        error: `Unsupported ablation: ${ablation}. Supported: enforce_idempotency, fencing_token_enabled, zero_hold_lease, idempotency, fencing, lease, release_before_llm`,
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

    const seed =
      typeof args.seed === "number" && Number.isFinite(args.seed)
        ? Math.floor(args.seed)
        : 42817;

    const startedAt = performance.now();

    // Map ablation name to graph builder parameter
    let graphAblationArg: string | undefined = normalizedAblation;
    if (normalizedAblation === "enforce_idempotency") {
      graphAblationArg = "idempotent_provider";
    }

    const graph = scenario ? scenario.buildGraph(graphAblationArg) : workflowToGraph(workflow!);

    // Apply ablation modifications to vowels directly
    if (normalizedAblation === "enforce_idempotency") {
      for (const vowel of graph.vowels) {
        if (vowel.kind === "CELL" && vowel instanceof Cell) {
          (vowel as any).idempotencyEnforced = true;
        }
      }
    } else if (normalizedAblation === "fencing_token_enabled") {
      for (const vowel of graph.vowels) {
        if (vowel.kind === "CELL" && vowel instanceof Cell) {
          (vowel as any).fencingTokenEnforced = true;
        }
      }
    } else if (normalizedAblation === "zero_hold_lease") {
      for (const vowel of graph.vowels) {
        if (vowel.kind === "LEASE" && vowel instanceof Lease) {
          (vowel as any).heldDuringExternalChannel = false;
        }
      }
    }

    if (scenario?.candidateFaults && scenario.candidateFaults.length > 0) {
      graph.candidatePerturbations = scenario.candidateFaults.map((f) => ({
        consonant: { kind: f.consonantKind, ...f.params } as any,
        targetId: f.targetVowelId,
      }));
    }

    try {
      const searchResult = await searchFaults(
        graph,
        {
          maxDepth: 2,
          maxEvaluations: 5000,
        },
        seed,
      );

      const isApproved = searchResult.status === "NO_FAILURE_WITHIN_BOUND";
      const verdict = isApproved ? "APPROVED" : "BLOCKED";
      const regressionCheck = isApproved ? "PASSED" : "FAILED";
      const immuneUpToDepth = isApproved ? searchResult.depthReached : 0;

      return {
        success: true,
        verdict,
        status: searchResult.status,
        scenarioId: scenario?.id ?? workflow?.id,
        ablation: normalizedAblation,
        immuneUpToDepth,
        regressionCheck,
        shortestDepth: searchResult.minimalCounterexample
          ? searchResult.minimalCounterexample.length
          : isApproved
            ? null
            : searchResult.depthReached,
        minimalCounterexample: searchResult.minimalCounterexample ?? [],
        violatedInvariants: searchResult.violatedInvariants ?? [],
        evaluationsCount: searchResult.evaluations,
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

export const tool = causalVerifyTool;
export default causalVerifyTool;

