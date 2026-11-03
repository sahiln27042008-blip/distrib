import { Channel } from "../../physics/alphabet/vowels/channel.ts";
import { Cell } from "../../physics/alphabet/vowels/cell.ts";
import { Lease } from "../../physics/alphabet/vowels/lease.ts";
import { Log } from "../../physics/alphabet/vowels/log.ts";
import type { CompiledAlphabetGraph } from "../../physics/alphabet/types.ts";
import { searchFaults } from "../../physics/search/fault-search.ts";
import { normalizeConsonantAlias } from "../../physics/alphabet/apply.ts";
import { getWorkflow, type Workflow } from "../../compiler/workflow-store.ts";

type StoredWorkflow = {
  workflowId: string;
  name: string;
  nodes: Map<string, {
    nodeId: string;
    name: string;
    vowels: Record<string, Record<string, unknown>>;
    consonants?: Record<string, number | string | boolean | Record<string, unknown>>;
    outboundEdges?: string[];
  }>;
  edges: Array<{ from: string; to: string }>;
};

function normalizeWorkflowNodes(workflow: StoredWorkflow | Workflow): {
  nodes: Map<string, {
    nodeId: string;
    name: string;
    vowels: Record<string, Record<string, unknown>>;
    consonants?: Record<string, number | string | boolean | Record<string, unknown>>;
    outboundEdges?: string[];
  }>;
  edges: Array<{ from: string; to: string }>;
} {
  if (workflow.nodes instanceof Map) {
    return {
      nodes: workflow.nodes as Map<string, StoredWorkflow["nodes"] extends Map<string, infer T> ? T : never>,
      edges: "edges" in workflow ? workflow.edges ?? [] : [],
    };
  }

  const nodeMap = new Map<string, {
    nodeId: string;
    name: string;
    vowels: Record<string, Record<string, unknown>>;
    consonants?: Record<string, number | string | boolean | Record<string, unknown>>;
    outboundEdges?: string[];
  }>();
  const byName = new Map<string, string>();
  const edges: Array<{ from: string; to: string }> = [];

  for (const node of workflow.nodes) {
    const nodeId = node.nodeId ?? `node-${node.index}`;
    const vowels: Record<string, Record<string, unknown>> = {};
    for (const substrate of node.substrates ?? []) {
      vowels[substrate.vowel] = (substrate.params ?? {}) as Record<string, unknown>;
    }
    const consonants: Record<string, number | string | boolean | Record<string, unknown>> = {};
    for (const consonant of node.consonants ?? []) {
      consonants[consonant.kind] = (consonant.params ?? {}) as Record<string, unknown>;
    }
    nodeMap.set(nodeId, {
      nodeId,
      name: node.nodeName,
      vowels,
      consonants,
      outboundEdges: node.outboundEdges ?? [],
    });
    byName.set(node.nodeName, nodeId);
  }

  for (const node of workflow.nodes) {
    const sourceNodeId = byName.get(node.nodeName);
    if (!sourceNodeId) continue;
    for (const targetName of node.outboundEdges ?? []) {
      const targetNodeId = byName.get(targetName);
      if (targetNodeId) {
        edges.push({ from: sourceNodeId, to: targetNodeId });
      }
    }
  }

  return { nodes: nodeMap, edges };
}

export async function auditWorkflowReliability(args: { workflowId: string; seed?: number; maxDepth?: number }): Promise<any> {
  const workflowId = args.workflowId;
  const seed = typeof args.seed === "number" && Number.isFinite(args.seed) ? Math.floor(args.seed) : 42817;
  const maxDepth = typeof args.maxDepth === "number" && Number.isFinite(args.maxDepth) ? Math.max(0, Math.floor(args.maxDepth)) : 2;
  const workflow = getWorkflow(workflowId);

  if (!workflow) {
    return {
      success: false,
      error: "UNKNOWN_WORKFLOW",
      seed,
      maxDepth,
    };
  }

  const normalized = normalizeWorkflowNodes(workflow as StoredWorkflow | Workflow);
  const adaptedWorkflow: StoredWorkflow = {
    workflowId,
    name: workflow.name,
    nodes: normalized.nodes,
    edges: normalized.edges,
  };

  const graph = workflowToCompiledGraph(adaptedWorkflow);
  const startedAt = performance.now();
  const searchResult = await searchFaults(graph, { maxDepth, maxEvaluations: 5000 }, seed);
  const bfsDurationMs = performance.now() - startedAt;

  const violatedSet = new Set<string>(searchResult.violatedInvariants ?? []);

  const insufficientPhysics: Array<{ id: string; missingPrimitive: string }> = [];
  for (const rule of ["R05_DistributedSagas", "R10_BoundedContextGrowth"]) {
    if (!["R05_DistributedSagas", "R10_BoundedContextGrowth"].some((entry) => entry === rule)) {
      // no-op, kept for rule registration clarity
    }
  }
  insufficientPhysics.push({ id: "R05_DistributedSagas", missingPrimitive: "saga_recovery_ledger" });
  insufficientPhysics.push({ id: "R10_BoundedContextGrowth", missingPrimitive: "bounded_context_window" });

  const violatedInvariants = Array.from(violatedSet).map((id) => ({
    id,
    status: "BREACHED",
    evidence: id === "R08_ZeroHoldLease"
      ? "Queue backlog and lease saturation exceeded the safe hold window."
      : id === "R04_NetworkIdempotency"
        ? "Channel retry or ACK loss created an in-doubt idempotency replay."
        : `searchFaults reported invariant ${id} as violated.`,
  }));

  const affectedNodes = [...adaptedWorkflow.nodes.keys()].filter((nodeId) => {
    const node = adaptedWorkflow.nodes.get(nodeId)!;
    return !!node.vowels.CHANNEL || !!node.vowels.LEASE || !!node.vowels.LOG;
  });
  const affectedEdges = adaptedWorkflow.edges.map((edge) => `${edge.from}->${edge.to}`);
  const counterexample = searchResult.minimalCounterexample && searchResult.minimalCounterexample.length > 0
    ? searchResult.minimalCounterexample.map((fault) => ({
        kind: fault.consonantKind,
        targetId: fault.targetVowelId,
        params: fault.params,
      }))
    : null;

  const gate = violatedInvariants.length > 0 || insufficientPhysics.length > 0 ? "BLOCKED" : "APPROVED";

  return {
    success: true,
    workflowId,
    seed,
    bfsDurationMs,
    baseline: {
      status: searchResult.status,
      violatedInvariants: searchResult.violatedInvariants,
    },
    counterexample,
    violatedInvariants,
    insufficientPhysics,
    affectedNodes,
    affectedEdges,
    gate,
  };
}

export const auditWorkflowReliabilityTool = {
  name: "audit_workflow_reliability",
  description: "Runs the deterministic fault search on a stored workflow and returns a reliability verdict.",
  inputSchema: {
    type: "object",
    properties: {
      workflowId: { type: "string", description: "Workflow ID to audit" },
      seed: { type: "number", description: "Deterministic seed" },
      maxDepth: { type: "number", description: "Maximum BFS depth" },
    },
    required: ["workflowId"],
  },
  async handler(args: Record<string, unknown>) {
    return auditWorkflowReliability({
      workflowId: typeof args.workflowId === "string" ? args.workflowId : "",
      seed: typeof args.seed === "number" ? args.seed : 42817,
      maxDepth: typeof args.maxDepth === "number" ? args.maxDepth : 2,
    });
  },
};

export const audit_workflow = auditWorkflowReliabilityTool;
export const auditWorkflowReliabilityCompatTool = auditWorkflowReliabilityTool;

export function workflowToCompiledGraph(input: StoredWorkflow | Workflow): CompiledAlphabetGraph {
  const normalized = normalizeWorkflowNodes(input);
  const workflow: StoredWorkflow = {
    workflowId: "workflowId" in input ? input.workflowId : input.id,
    name: input.name,
    nodes: normalized.nodes,
    edges: normalized.edges,
  };
  const actors = [...workflow.nodes.values()].map((node) => ({ id: node.nodeId, name: node.name }));
  const vowels: CompiledAlphabetGraph["vowels"] = [];
  const channels: CompiledAlphabetGraph["channels"] = [];
  const candidatePerturbations: CompiledAlphabetGraph["candidatePerturbations"] = [];

  for (const [nodeId, node] of workflow.nodes.entries()) {
    const actorId = nodeId;
    for (const [vowelType, params] of Object.entries(node.vowels ?? {})) {
      const normalizedParams = (params ?? {}) as Record<string, unknown>;
      if (vowelType === "REGISTER") {
        vowels.push(new Cell({
          id: `${nodeId}-register`,
          actorId,
          persistence: normalizedParams.durable === true ? "DURABLE" : "VOLATILE",
          idempotencyEnforced: true,
          fencingTokenEnforced: false,
        }));
      } else if (vowelType === "LOG") {
        vowels.push(new Log({
          id: `${nodeId}-log`,
          actorId,
          maxCapacity: Number(normalizedParams.maxTokens ?? 1000),
          compactionLagMs: Number(normalizedParams.retentionMs ?? 0),
          deduplicateOnCompact: true,
        }));
      } else if (vowelType === "LEASE") {
        vowels.push(new Lease({
          id: `${nodeId}-lease`,
          actorId,
          maxCapacity: Number(normalizedParams.poolCapacity ?? 4),
          ttlMs: Number(normalizedParams.timeoutMs ?? 5000),
          overflowPolicy: "WAIT_TIMEOUT",
          heldDuringExternalChannel: true,
        }));
      } else if (vowelType === "CHANNEL") {
        const targetNodeId = String(normalizedParams.targetNodeId ?? nodeId);
        const channel = new Channel({
          id: `${nodeId}-channel`,
          sourceActorId: actorId,
          targetActorId: targetNodeId,
          timeoutMs: Number(normalizedParams.timeoutMs ?? 5000),
          idempotencyEnabled: normalizedParams.idempotencyKey === false ? false : true,
        });
        channels.push(channel);
        vowels.push(channel);
      }
    }

    for (const [kind, value] of Object.entries(node.consonants ?? {})) {
      const consonant = normalizeConsonantAlias({ kind, params: value as Record<string, unknown> });
      if (!consonant) continue;

      const legalTargets = vowels.filter((vowel) => {
        if (vowel.actorId !== actorId) return false;
        if (consonant.kind === "DELAY") return vowel.kind === "CHANNEL" || vowel.kind === "LOG";
        if (consonant.kind === "SEVER") return vowel.kind === "CHANNEL";
        if (consonant.kind === "DUPLICATE") return vowel.kind === "CHANNEL" || vowel.kind === "LOG";
        if (consonant.kind === "SATURATE") return vowel.kind === "LEASE" || vowel.kind === "LOG";
        if (consonant.kind === "WIPE") return vowel.kind === "CELL" || vowel.kind === "LEASE";
        if (consonant.kind === "CORRUPT") return vowel.kind === "CHANNEL" || vowel.kind === "LOG";
        return false;
      });
      const target = legalTargets[0];
      if (!target) continue;

      candidatePerturbations.push({
        consonant,
        targetId: target.id,
        description: `pinned to ${node.name}`,
      });
    }
  }

  return {
    actors,
    vowels,
    channels,
    contracts: [],
    candidatePerturbations,
    epistemicStatus: ["OBSERVED"],
    unrepresentableSemantics: [],
  };
}

export default auditWorkflowReliabilityTool;
