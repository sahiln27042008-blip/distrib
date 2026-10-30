// enterpriseee/enterprise-simulator/src/physics/distrib/bfs-search.ts

import { createHash } from "node:crypto";
import type { CompiledAlphabetGraph } from "../alphabet/types.ts";
import type {
  DistribBfsOptions,
  DistribBfsResult,
  DistribConsonantFault,
} from "./distrib-types.ts";
import { executeDistribWorkflow } from "./distrib-simulator.ts";

export interface BfsQueueNode {
  sequence: DistribConsonantFault[];
  depth: number;
}

export function faultCanonicalKey(fault: DistribConsonantFault): string {
  const sortedParams = Object.keys(fault.params)
    .sort()
    .map((k) => `${k}:${JSON.stringify(fault.params[k])}`)
    .join(",");
  return `${fault.consonantKind}@${fault.targetVowelId}(${sortedParams})`;
}

export function sequenceCanonicalKey(sequence: DistribConsonantFault[]): string {
  return sequence.map(faultCanonicalKey).join(" -> ");
}

export function computeBfsFingerprint(
  scenarioId: string,
  seed: number,
  result: Pick<DistribBfsResult, "status" | "minimalCounterexample" | "violatedInvariants" | "evaluations" | "depthReached">,
): string {
  const payload = {
    scenarioId,
    seed,
    status: result.status,
    counterexample: result.minimalCounterexample?.map(faultCanonicalKey),
    violatedInvariants: result.violatedInvariants,
    evaluations: result.evaluations,
    depthReached: result.depthReached,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function searchDistribBfs(
  scenarioId: string,
  graph: CompiledAlphabetGraph,
  candidateFaults: DistribConsonantFault[],
  options: DistribBfsOptions = {},
  seed = 42,
): Promise<DistribBfsResult> {
  const startedAt = performance.now();
  const maxDepth = Math.max(0, Math.floor(options.maxDepth ?? 3));
  const maxEvaluations = Math.max(1, Math.floor(options.maxEvaluations ?? 1000));
  const timeoutMs = options.timeoutMs ?? 30000;

  let evaluations = 0;
  let statesExplored = 0;
  let currentMaxDepthObserved = 0;

  // 1. Evaluate baseline (depth 0)
  const baseline = await executeDistribWorkflow(graph, [], seed);
  evaluations++;
  statesExplored++;

  if (baseline.violatedInvariants.length > 0) {
    const baseResult: DistribBfsResult = {
      status: "BASELINE_FAILURE",
      scenarioId,
      violatedInvariants: baseline.violatedInvariants,
      depthReached: 0,
      evaluations,
      statesExplored,
      durationMs: performance.now() - startedAt,
      deterministicFingerprint: "",
      isExhaustiveWithinBound: false,
    };
    baseResult.deterministicFingerprint = computeBfsFingerprint(scenarioId, seed, baseResult);
    return baseResult;
  }

  if (maxDepth === 0 || evaluations >= maxEvaluations) {
    const baseResult: DistribBfsResult = {
      status: "NO_FAILURE_WITHIN_BOUND",
      scenarioId,
      violatedInvariants: [],
      depthReached: 0,
      evaluations,
      statesExplored,
      durationMs: performance.now() - startedAt,
      deterministicFingerprint: "",
      isExhaustiveWithinBound: maxDepth === 0,
    };
    baseResult.deterministicFingerprint = computeBfsFingerprint(scenarioId, seed, baseResult);
    return baseResult;
  }

  // 2. Queue-based Breadth-First Search (FIFO queue guarantees nondecreasing depth exploration)
  const queue: BfsQueueNode[] = [];
  const visitedSequences = new Set<string>();

  // Enqueue initial single faults (depth 1)
  for (const candidate of candidateFaults) {
    const seq = [candidate];
    const key = sequenceCanonicalKey(seq);
    if (!visitedSequences.has(key)) {
      visitedSequences.add(key);
      queue.push({ sequence: seq, depth: 1 });
    }
  }

  let budgetExhausted = false;

  while (queue.length > 0) {
    // Check execution budget and timeout
    if (evaluations >= maxEvaluations || performance.now() - startedAt > timeoutMs) {
      budgetExhausted = true;
      break;
    }

    const current = queue.shift()!;
    statesExplored++;

    // Track that BFS only progresses forward or stays at current depth
    if (current.depth > currentMaxDepthObserved) {
      currentMaxDepthObserved = current.depth;
    }

    // Execute candidate sequence on deterministic physics
    const execution = await executeDistribWorkflow(graph, current.sequence, seed);
    evaluations++;

    // Auditor checks: Did any system invariants fail?
    if (execution.violatedInvariants.length > 0) {
      // Shortest counterexample discovered!
      const result: DistribBfsResult = {
        status: "FAILURE_FOUND",
        scenarioId,
        minimalCounterexample: current.sequence,
        violatedInvariants: execution.violatedInvariants,
        depthReached: current.depth,
        evaluations,
        statesExplored,
        durationMs: performance.now() - startedAt,
        deterministicFingerprint: "",
        traceSummary: {
          totalEvents: execution.events.length,
          auditorFindingsCount: execution.auditorFindings.length,
        },
      };
      result.deterministicFingerprint = computeBfsFingerprint(scenarioId, seed, result);
      return result;
    }

    // If depth allows, expand next layer
    if (current.depth < maxDepth) {
      for (const nextFault of candidateFaults) {
        const nextSeq = [...current.sequence, nextFault];
        const nextKey = sequenceCanonicalKey(nextSeq);

        if (!visitedSequences.has(nextKey)) {
          visitedSequences.add(nextKey);
          queue.push({ sequence: nextSeq, depth: current.depth + 1 });
        }
      }
    }
  }

  const finalStatus: DistribBfsResult["status"] = budgetExhausted
    ? "BUDGET_EXHAUSTED"
    : "NO_FAILURE_WITHIN_BOUND";

  const result: DistribBfsResult = {
    status: finalStatus,
    scenarioId,
    violatedInvariants: [],
    depthReached: currentMaxDepthObserved,
    evaluations,
    statesExplored,
    durationMs: performance.now() - startedAt,
    deterministicFingerprint: "",
    isExhaustiveWithinBound: !budgetExhausted,
  };
  result.deterministicFingerprint = computeBfsFingerprint(scenarioId, seed, result);
  return result;
}

