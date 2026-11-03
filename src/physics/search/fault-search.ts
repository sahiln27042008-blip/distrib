import { createHash } from "node:crypto";
import type { CompiledAlphabetGraph, Consonant } from "../alphabet/types.ts";
import type {
  ConsonantFault,
  FaultSearchOptions,
  FaultSearchResult,
} from "./search-types.ts";
import { executeFaultSequence } from "./execute-faults.ts";

const DEFAULT_SEED = 1;
const MAX_SEARCH_DEPTH = 64;

function faultFromCandidate(candidate: {
  consonant: Consonant;
  targetId: string;
}): ConsonantFault {
  const { kind, ...params } = candidate.consonant;
  return {
    consonantKind: kind,
    targetVowelId: candidate.targetId,
    params: params as Record<string, unknown>,
  };
}

export function enumerateFaults(graph: CompiledAlphabetGraph): ConsonantFault[] {
  const explicitCandidates = graph.candidatePerturbations.map(faultFromCandidate);
  const defaultCandidates: ConsonantFault[] = [];

  for (const vowel of graph.vowels) {
    switch (vowel.kind) {
      case "CHANNEL":
        defaultCandidates.push(
          { consonantKind: "DELAY", targetVowelId: vowel.id, params: { durationMs: 1 } },
          { consonantKind: "SEVER", targetVowelId: vowel.id, params: { phase: "PRE_COMMIT" } },
          { consonantKind: "SEVER", targetVowelId: vowel.id, params: { phase: "POST_COMMIT" } },
          { consonantKind: "DUPLICATE", targetVowelId: vowel.id, params: { count: 2 } },
          { consonantKind: "CORRUPT", targetVowelId: vowel.id, params: { mode: "SCHEMA_DRIFT" } },
        );
        break;
      case "LEASE": {
        const capacity = "maxCapacity" in vowel && typeof vowel.maxCapacity === "number"
          ? vowel.maxCapacity
          : 1;
        defaultCandidates.push({
          consonantKind: "SATURATE",
          targetVowelId: vowel.id,
          params: { loadUnits: capacity },
        });
        break;
      }
      case "LOG":
        defaultCandidates.push(
          { consonantKind: "DELAY", targetVowelId: vowel.id, params: { durationMs: 1 } },
          { consonantKind: "CORRUPT", targetVowelId: vowel.id, params: { mode: "LOSSY_DROP" } },
        );
        break;
      case "CELL":
        if ("persistence" in vowel && vowel.persistence === "VOLATILE") {
          defaultCandidates.push({
            consonantKind: "WIPE",
            targetVowelId: vowel.id,
            params: { scope: "VOLATILE_CELLS", cellIds: [vowel.id] },
          });
        }
        break;
    }
  }

  const seen = new Map<string, { fault: ConsonantFault; priority: number }>();
  for (const [priority, candidates] of [[0, explicitCandidates], [1, defaultCandidates]] as const) {
    for (const fault of candidates) {
      const key = faultSortKey(fault);
      if (!seen.has(key)) seen.set(key, { fault, priority });
    }
  }

  return [...seen.values()]
    .sort((left, right) => left.priority - right.priority || faultSortKey(left.fault).localeCompare(faultSortKey(right.fault)))
    .map(({ fault }) => fault);
}

function faultSortKey(fault: ConsonantFault): string {
  return `${fault.consonantKind}\u0000${fault.targetVowelId}\u0000${JSON.stringify(fault.params)}`;
}

function graphFingerprintInput(graph: CompiledAlphabetGraph): string {
  return JSON.stringify({
    actors: graph.actors.map(({ id, kind }) => ({ id, kind })),
    vowels: graph.vowels.map((vowel) => ({ id: vowel.id, kind: vowel.kind, state: vowel.snapshot() })),
    channels: graph.channels.map((channel) => channel.id),
    candidates: graph.candidatePerturbations,
  });
}

function fingerprint(
  graph: CompiledAlphabetGraph,
  seed: number,
  result: Pick<FaultSearchResult, "status" | "minimalCounterexample" | "violatedInvariants" | "evaluations">,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ graph: graphFingerprintInput(graph), seed, ...result }))
    .digest("hex");
}

export async function searchFaults(
  graph: CompiledAlphabetGraph,
  options: FaultSearchOptions = {},
  seed = DEFAULT_SEED,
): Promise<FaultSearchResult> {
  const startedAt = performance.now();
  const requestedMaxDepth = options.maxDepth ?? 3;
  const requestedMaxEvaluations = options.maxEvaluations ?? 5000;
  if (!Number.isFinite(requestedMaxDepth)) {
    throw new RangeError("maxDepth must be finite");
  }
  if (!Number.isFinite(requestedMaxEvaluations)) {
    throw new RangeError("maxEvaluations must be finite");
  }
  const maxDepth = Math.max(0, Math.floor(requestedMaxDepth));
  if (maxDepth > MAX_SEARCH_DEPTH) {
    throw new RangeError(`maxDepth cannot exceed ${MAX_SEARCH_DEPTH}`);
  }
  const maxEvaluations = Math.max(1, Math.floor(requestedMaxEvaluations));
  const candidates = enumerateFaults(graph);
  let evaluations = 0;

  const makeResult = (
    status: FaultSearchResult["status"],
    depthReached: number,
    violatedInvariants: string[],
    minimalCounterexample?: ConsonantFault[],
  ): FaultSearchResult => {
    const resultBase = {
      status,
      ...(minimalCounterexample ? { minimalCounterexample } : {}),
      violatedInvariants,
      depthReached,
      evaluations,
    };
    return {
      ...resultBase,
      durationMs: performance.now() - startedAt,
      deterministicFingerprint: fingerprint(graph, seed, resultBase),
    };
  };

  const baseline = await executeFaultSequence(graph, [], seed);
  evaluations++;
  if (baseline.violatedInvariants.length > 0) {
    return makeResult("BASELINE_FAILURE", 0, baseline.violatedInvariants);
  }

  if (maxEvaluations <= evaluations) {
    return makeResult("BUDGET_EXHAUSTED", 0, []);
  }

  for (let depth = 1; depth <= maxDepth; depth++) {
    const visited = new Set<string>();
    let budgetExhausted = false;

    const visit = async (
      sequence: ConsonantFault[],
    ): Promise<FaultSearchResult | undefined> => {
      if (sequence.length === depth) {
        const sequenceKey = JSON.stringify(sequence);
        if (visited.has(sequenceKey)) return undefined;
        visited.add(sequenceKey);

        if (evaluations >= maxEvaluations) {
          budgetExhausted = true;
          return undefined;
        }

        const execution = await executeFaultSequence(graph, sequence, seed);
        evaluations++;
        if (execution.violatedInvariants.length > 0) {
          return makeResult(
            "FAILURE_FOUND",
            depth,
            execution.violatedInvariants,
            sequence,
          );
        }
        return undefined;
      }

      for (const candidate of candidates) {
        if (budgetExhausted) break;
        const result = await visit([...sequence, candidate]);
        if (result) return result;
      }
      return undefined;
    };

    const result = await visit([]);
    if (result) return result;
    if (budgetExhausted) return makeResult("BUDGET_EXHAUSTED", depth, []);
  }

  return makeResult("NO_FAILURE_WITHIN_BOUND", maxDepth, []);
}