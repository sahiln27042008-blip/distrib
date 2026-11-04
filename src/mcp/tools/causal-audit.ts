// enterpriseee/enterprise-simulator/src/mcp/tools/causal-audit.ts

import { searchFaults } from "../../physics/search/fault-search.ts";
import { SCENARIO_DEFINITIONS } from "../../physics/distrib/distrib-scenarios.ts";
import { buildAdversarialAgentWorld } from "../../physics/distrib/distrib-world.ts";
import { Channel } from "../../physics/alphabet/vowels/channel.ts";
import { Cell } from "../../physics/alphabet/vowels/cell.ts";
import { Log } from "../../physics/alphabet/vowels/log.ts";
import { Lease } from "../../physics/alphabet/vowels/lease.ts";
import type { CompiledAlphabetGraph } from "../../physics/alphabet/types.ts";
import { getWorkflow, type Workflow } from "../../compiler/workflow-store.ts";
import { normalizeConsonantAlias } from "../../physics/alphabet/apply.ts";

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

export function workflowToGraph(workflow: Workflow): CompiledAlphabetGraph {
  const actors = workflow.nodes.map((node) => ({
    id: `actor-${node.index}`,
    name: node.nodeName,
  }));
  const vowels: CompiledAlphabetGraph["vowels"] = [];
  const channels: Channel[] = [];
  const nodeIndexByName = new Map(workflow.nodes.map((node) => [node.nodeName, node.index]));
  const nodeIdempotencyByActor = new Map<string, boolean>();

  for (const node of workflow.nodes) {
    const actorId = `actor-${node.index}`;
    for (const substrate of node.substrates) {
      const params = substrate.params ?? {};
      if ((substrate.vowel === "REGISTER" || substrate.vowel === "CELL") && params.idempotencyEnforced === true) {
        nodeIdempotencyByActor.set(actorId, true);
      }
    }
  }

  for (const node of workflow.nodes) {
    const actorId = `actor-${node.index}`;
    for (const [substrateIndex, substrate] of node.substrates.entries()) {
      const id = `vowel-${node.index}-${substrateIndex + 1}`;
      const params = substrate.params ?? {};
      if (substrate.vowel === "REGISTER" || substrate.vowel === "CELL") {
        vowels.push(new Cell({
          id,
          actorId,
          persistence: params.persistence === "DURABLE" ? "DURABLE" : "VOLATILE",
          idempotencyEnforced: params.idempotencyEnforced === true,
          fencingTokenEnforced: params.fencingTokenEnforced === true,
        }));
      } else if (substrate.vowel === "LOG") {
        vowels.push(new Log({
          id,
          actorId,
          maxCapacity: typeof params.maxCapacity === "number" ? params.maxCapacity : 1000,
          compactionLagMs: typeof params.compactionLagMs === "number" ? params.compactionLagMs : 0,
          deduplicateOnCompact: params.deduplicateOnCompact === true,
        }));
      } else if (substrate.vowel === "LEASE") {
        const overflowPolicy = params.overflowPolicy === "REJECT_429" || params.overflowPolicy === "PANIC_CRASH"
          ? params.overflowPolicy
          : "WAIT_TIMEOUT";
        vowels.push(new Lease({
          id,
          actorId,
          maxCapacity: typeof params.maxCapacity === "number" ? params.maxCapacity : 1,
          ttlMs: typeof params.ttlMs === "number" ? params.ttlMs : 30_000,
          overflowPolicy,
          heldDuringExternalChannel: params.heldDuringExternalChannel === true,
        }));
      } else if (substrate.vowel === "CHANNEL") {
        const targetNodeIndex = typeof params.targetNodeId === "string"
          ? nodeIndexByName.get(params.targetNodeId)
          : undefined;
        const targetActorId = typeof targetNodeIndex === "number"
          ? `actor-${targetNodeIndex}`
          : actorId;
        const channel = new Channel({
          id,
          sourceActorId: actorId,
          targetActorId,
          timeoutMs: typeof params.timeoutMs === "number" ? params.timeoutMs : 10_000,
          idempotencyEnabled: nodeIdempotencyByActor.get(targetActorId) === true,
          ...(typeof params.budgetUsd === "number" ? { budgetUsd: params.budgetUsd } : {}),
        });
        vowels.push(channel);
        channels.push(channel);
      }
    }
  }

  const hasExplicitEdges = workflow.nodes.some((n) => Array.isArray(n.outboundEdges) && n.outboundEdges.length > 0);
  const candidatePerturbations: CompiledAlphabetGraph["candidatePerturbations"] = [];
  const nodeIndexByTarget = new Map<string, number>();
  for (const node of workflow.nodes) {
    nodeIndexByTarget.set(`actor-${node.index}`, node.index);
    for (const [substrateIndex, substrate] of node.substrates.entries()) {
      nodeIndexByTarget.set(`vowel-${node.index}-${substrateIndex + 1}`, node.index);
    }
  }

  for (const node of workflow.nodes) {
    if (!Array.isArray(node.consonants)) continue;
    const nodeVowels = vowels.filter((vowel) => vowel.actorId === `actor-${node.index}`);
    for (const consonantAssignment of node.consonants) {
      const canonical = normalizeConsonantAlias(consonantAssignment);
      if (!canonical) continue;
      const legalTargetIds = nodeVowels
        .filter((vowel) => {
          if (canonical.kind === "DELAY") return vowel.kind === "CHANNEL" || vowel.kind === "LOG";
          if (canonical.kind === "SEVER") return vowel.kind === "CHANNEL";
          if (canonical.kind === "DUPLICATE") return vowel.kind === "CHANNEL" || vowel.kind === "LOG";
          if (canonical.kind === "SATURATE") return vowel.kind === "LEASE" || vowel.kind === "LOG";
          if (canonical.kind === "WIPE") return vowel.kind === "CELL" || vowel.kind === "LEASE";
          if (canonical.kind === "CORRUPT") return vowel.kind === "CHANNEL" || vowel.kind === "LOG";
          return false;
        })
        .map((vowel) => vowel.id);
      candidatePerturbations.push({
        consonant: canonical,
        targetId: legalTargetIds[0] ?? `actor-${node.index}`,
        description: legalTargetIds[0] ? `pinned to ${node.nodeName}` : `no legal target on ${node.nodeName}; pinned to actor`,
      });
    }
  }

  let edges: { source: Workflow["nodes"][number]; target: Workflow["nodes"][number] }[] = [];
  const unresolvedEdges: Array<{ source: string; target: string }> = [];

  if (hasExplicitEdges) {
    const byName = new Map(workflow.nodes.map((node) => [node.nodeName, node]));
    for (const source of workflow.nodes) {
      if (!Array.isArray(source.outboundEdges)) continue;
      for (const targetName of source.outboundEdges) {
        const target = byName.get(targetName);
        if (!target) {
          // Do NOT throw on forward references or missing targets:
          // Skip the edge, record as unresolved, and continue audit on partial graph.
          unresolvedEdges.push({ source: source.nodeName, target: targetName });
          continue;
        }
        edges.push({ source, target });
      }
    }
  } else {
    for (let index = 0; index < workflow.nodes.length - 1; index++) {
      const source = workflow.nodes[index];
      const target = workflow.nodes[index + 1];
      if (!source || !target) continue;
      edges.push({ source, target });
    }
  }

  for (const { source, target } of edges) {
    const channel = new Channel({
      id: `channel-${source.index}-${target.index}`,
      sourceActorId: `actor-${source.index}`,
      targetActorId: `actor-${target.index}`,
      timeoutMs: 10_000,
      idempotencyEnabled: nodeIdempotencyByActor.get(`actor-${target.index}`) === true,
    });
    channels.push(channel);
    vowels.push(channel);
  }

  candidatePerturbations.sort((left, right) => {
    const leftIndex = nodeIndexByTarget.get(left.targetId) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = nodeIndexByTarget.get(right.targetId) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.consonant.kind.localeCompare(right.consonant.kind);
  });

  return {
    actors,
    vowels,
    channels,
    contracts: [],
    candidatePerturbations,
    epistemicStatus: (hasExplicitEdges && unresolvedEdges.length === 0) ? ["OBSERVED"] : ["INFERRED"],
    unrepresentableSemantics: [
      ...(!hasExplicitEdges ? ["Workflow dependencies are approximated as a sequential chain because the workflow store has no edge model."] : []),
      ...(unresolvedEdges.length > 0 ? [`Workflow has unresolved outbound edges: ${unresolvedEdges.map(e => `${e.source} -> ${e.target}`).join(", ")}. Graph is partial.`] : []),
    ],
    unresolvedEdges,
  };
}

export function resolveWorkflow(scenarioId: string, sessionId?: string): Workflow | undefined {
  return getWorkflow(scenarioId.trim(), sessionId);
}

export function resolveScenario(scenarioId: string): ResolvedScenario | undefined {
  const norm = scenarioId.trim().replace(/\./g, "-").toLowerCase();

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
      workflowId: {
        type: "string",
        description: "Workflow ID to evaluate (alias for scenarioId)",
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
    required: [],
  },
  async handler(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const rawId = typeof args.scenarioId === 'string' && args.scenarioId.trim()
      ? args.scenarioId.trim()
      : typeof args.workflowId === 'string' && args.workflowId.trim()
        ? args.workflowId.trim()
        : '';

    if (!rawId) {
      return {
        success: false,
        error: 'scenarioId is required (or workflowId for stored workflows)',
      };
    }
    const scenarioId = rawId;

    const normalizedScenarioId = scenarioId.trim().replace(/\./g, "-").toLowerCase();
    const scenario = resolveScenario(normalizedScenarioId);
    const workflow = scenario ? undefined : resolveWorkflow(scenarioId, context?.sessionId);
    if (!scenario && !workflow) {
      return {
        success: false,
        error: `Unknown scenario: ${scenarioId}`,
      };
    }

    if (scenario && !scenario.isRepresentable) {
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
    const graph = scenario ? scenario.buildGraph() : workflowToGraph(workflow!);

    const unresolvedEdges = Array.isArray((graph as any).unresolvedEdges)
      ? (graph as any).unresolvedEdges as Array<{ source: string; target: string }>
      : [];
    if (!scenario && unresolvedEdges.length > 0) {
      const edgeList = unresolvedEdges.map((edge) => `${edge.source} -> ${edge.target}`).join(", ");
      return {
        success: true,
        verdict: "BLOCKED",
        status: "GRAPH_INCOMPLETE",
        scenarioId: workflow?.id,
        shortestDepth: null,
        minimalCounterexample: [],
        violatedInvariants: [],
        evaluationsCount: 0,
        durationMs: performance.now() - startedAt,
        executiveSummary: `BLOCKED: workflow graph is incomplete; unresolved edge(s): ${edgeList}.`,
        graphCompleteness: {
          complete: false,
          unresolvedEdges,
        },
      };
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
          maxDepth,
          maxEvaluations: 5000,
        },
        seed,
      );

      const isApproved = searchResult.status === "NO_FAILURE_WITHIN_BOUND";
      const verdict = isApproved ? "APPROVED" : "BLOCKED";
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
      const counterexampleSummary = enrichedCounterexample;
      const failurePathStr = enrichedCounterexample.map((c) => c.businessTarget).join(", ");
      const executiveSummary = isApproved
        ? `APPROVED: ${scenario?.name ?? workflow?.name ?? scenarioId}; No invariant violations found.`
        : `BLOCKED: ${scenario?.name ?? workflow?.name ?? scenarioId}; ${searchResult.violatedInvariants.join(", ")} violated on ${failurePathStr || "fault trajectory"}.`;
      const verdictSummary = isApproved
        ? `APPROVED: ${scenario?.name ?? workflow?.name ?? scenarioId}`
        : `BLOCKED: ${scenario?.name ?? workflow?.name ?? scenarioId} [${enrichedCounterexample.map((c) => `${c.consonantKind} on ${c.businessTarget}`).join(" + ") || "violation"}]`;

      return {
        success: true,
        verdict,
        status: searchResult.status,
        scenarioId: scenario?.id ?? workflow?.id,
        shortestDepth: searchResult.minimalCounterexample
          ? searchResult.minimalCounterexample.length
          : isApproved
            ? null
            : searchResult.depthReached,
        minimalCounterexample: enrichedCounterexample,
        failurePath: failurePathStr,
        verdictSummary,
        violatedInvariants: searchResult.violatedInvariants ?? [],
        evaluationsCount: searchResult.evaluations,
        durationMs: searchResult.durationMs ?? performance.now() - startedAt,
        fingerprint: searchResult.deterministicFingerprint,
        executiveSummary,
        graphCompleteness: { complete: true, unresolvedEdges: [] },
        counterexampleSummary,
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
export const auditWorkflowReliabilityTool = causalAuditTool;
export default causalAuditTool;

