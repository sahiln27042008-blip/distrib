// enterpriseee/enterprise-simulator/src/mcp/tools/causal-verify.ts

import { searchFaults } from "../../physics/search/fault-search.ts";
import { resolveScenario, resolveWorkflow, workflowToGraph, type ToolContext, type ToolResult, type McpTool } from "./causal-audit.ts";
import { Cell } from "../../physics/alphabet/vowels/cell.ts";
import { Lease } from "../../physics/alphabet/vowels/lease.ts";
import { Channel } from "../../physics/alphabet/vowels/channel.ts";

export const causalVerifyTool: McpTool = {
  name: "verify_architecture_patch",
  description:
    "Re-runs the BFS engine with resilient ablations (e.g., idempotency keys, zero-hold leasing, channel transport dedup) to prove zero regressions after a proposed fix.",
  inputSchema: {
    type: "object",
    properties: {
      scenarioId: { type: "string" },
      seed: { type: "number", default: 42817 },
      ablation: {
        type: "string",
        enum: [
          "channel_idempotency",
          "enforce_idempotency",
          "fencing_token_enabled",
          "zero_hold_lease",
          "idempotency",
          "fencing",
          "lease",
          "release_before_llm",
          "outbound_transport_dedup",
          "channel_dedup",
          "shed_at_threshold",
          "shed_at_56",
          "admission_control",
          "load_shedding",
        ],
      },
      ablations: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["scenarioId"],
  },
  async handler(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const scenarioId = args.scenarioId as string | undefined;
    if (!scenarioId || typeof scenarioId !== "string" || scenarioId.trim() === "") {
      return {
        success: false,
        error: "scenarioId is required",
      };
    }

    const rawAblations: string[] = [];
    if (Array.isArray(args.ablations)) {
      for (const a of args.ablations) {
        if (typeof a === "string" && a.trim() !== "") {
          rawAblations.push(a.trim());
        }
      }
    }
    if (typeof args.ablation === "string" && args.ablation.trim() !== "") {
      rawAblations.push(args.ablation.trim());
    }

    if (rawAblations.length === 0) {
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
      outbound_transport_dedup: "channel_idempotency",
      channel_dedup: "channel_idempotency",
      shed_at_56: "shed_at_threshold",
      admission_control: "shed_at_threshold",
      load_shedding: "shed_at_threshold",
    };
    const supportedAblations = new Set([
      "channel_idempotency",
      "enforce_idempotency",
      "fencing_token_enabled",
      "zero_hold_lease",
      "shed_at_threshold",
    ]);

    const normalizedAblations: string[] = [];
    for (const ab of rawAblations) {
      const norm = ablationAliases[ab] ?? ab;
      if (!supportedAblations.has(norm)) {
        return {
          success: false,
          error: `Unsupported ablation: ${ab}. Supported: channel_idempotency, enforce_idempotency, fencing_token_enabled, zero_hold_lease, idempotency, fencing, lease, release_before_llm, outbound_transport_dedup`,
        };
      }
      if (!normalizedAblations.includes(norm)) {
        normalizedAblations.push(norm);
      }
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

    // Pass ablation arg(s) to scenario buildGraph
    let graphAblationArg: string | string[] = normalizedAblations.length === 1
      ? normalizedAblations[0]!
      : normalizedAblations;
    if (normalizedAblations.length === 1 && normalizedAblations[0] === "enforce_idempotency") {
      graphAblationArg = "idempotent_provider";
    }

    const graph = scenario ? scenario.buildGraph(graphAblationArg as any) : workflowToGraph(workflow!);

    // Apply ablation modifications to vowels and channels directly
    for (const vowel of graph.vowels) {
      if (vowel.kind === "CELL" && vowel instanceof Cell) {
        if (normalizedAblations.includes("enforce_idempotency")) {
          (vowel as any).idempotencyEnforced = true;
        }
        if (normalizedAblations.includes("fencing_token_enabled")) {
          (vowel as any).fencingTokenEnforced = true;
        }
        if (normalizedAblations.includes("shed_at_threshold")) {
          (vowel as any).shedAtThresholdEnabled = true;
          (vowel as any).shedThreshold = 0.56;
        }
      } else if (vowel.kind === "LEASE" && vowel instanceof Lease) {
        if (normalizedAblations.includes("zero_hold_lease")) {
          (vowel as any).heldDuringExternalChannel = false;
        }
        if (normalizedAblations.includes("shed_at_threshold")) {
          (vowel as any).shedAtThresholdEnabled = true;
          (vowel as any).shedThreshold = 0.56;
        }
      } else if (vowel.kind === "CHANNEL" && vowel instanceof Channel) {
        if (normalizedAblations.includes("channel_idempotency") || normalizedAblations.includes("enforce_idempotency")) {
          (vowel as any).idempotencyEnabled = true;
        }
      }
    }

    for (const ch of graph.channels) {
      if (normalizedAblations.includes("channel_idempotency") || normalizedAblations.includes("enforce_idempotency")) {
        (ch as any).idempotencyEnabled = true;
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

      const actorNames = new Map(graph.actors.map((actor) => [actor.id, actor.name]));
      const getBusinessTarget = (targetVowelId: string): string => {
        const target = graph.vowels.find((vowel) => vowel.id === targetVowelId);
        if (target?.kind === "CHANNEL") {
          const src = actorNames.get((target as Channel).sourceActorId) ?? (target as Channel).sourceActorId;
          const tgt = actorNames.get((target as Channel).targetActorId) ?? (target as Channel).targetActorId;
          return `${src} → ${tgt}`;
        }
        if (target) {
          return actorNames.get(target.actorId) ?? target.actorId;
        }
        return targetVowelId;
      };

      const enrichedCounterexample = (searchResult.minimalCounterexample ?? []).map((fault) => {
        const businessTarget = getBusinessTarget(fault.targetVowelId);
        return {
          ...fault,
          targetName: businessTarget,
          businessTarget,
          description: `${fault.consonantKind} affects ${businessTarget} [${fault.targetVowelId}]`,
        };
      });

      const failurePathStr = enrichedCounterexample.map((c) => c.businessTarget).join(", ");
      const verdictSummary = isApproved
        ? `APPROVED: ${scenario?.name ?? workflow?.name ?? scenarioId} - Invariant verified under ${normalizedAblations.join("+")}`
        : `BLOCKED: ${scenario?.name ?? workflow?.name ?? scenarioId} - Violated: ${searchResult.violatedInvariants.join(", ")} on ${failurePathStr || "fault trajectory"}`;

      return {
        success: true,
        verdict,
        verdictSummary,
        status: searchResult.status,
        scenarioId: scenario?.id ?? workflow?.id,
        ablation: normalizedAblations.length === 1 ? normalizedAblations[0] : normalizedAblations.join("+"),
        ablations: normalizedAblations,
        immuneUpToDepth,
        regressionCheck,
        shortestDepth: searchResult.minimalCounterexample
          ? searchResult.minimalCounterexample.length
          : isApproved
            ? null
            : searchResult.depthReached,
        minimalCounterexample: enrichedCounterexample,
        failurePath: failurePathStr,
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
