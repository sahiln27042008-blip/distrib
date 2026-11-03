import type { CompiledAlphabetGraph } from "../alphabet/types.ts";
import type {
  CliffSearchOptions,
  CollapseCliffResult,
  ConsonantFault,
} from "./search-types.ts";
import { executeFaultSequence } from "./execute-faults.ts";

export interface CliffParameter {
  name: string;
  targetVowelId: string;
  consonantKind: "DELAY" | "SATURATE";
  paramKey: string;
}

export async function findCollapseCliff(
  graph: CompiledAlphabetGraph,
  parameter: CliffParameter,
  options: CliffSearchOptions,
  seed: number,
): Promise<CollapseCliffResult> {
  const { low, high, tolerance } = options;
  const requestedMaxIterations = options.maxIterations ?? 30;
  if (
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    !Number.isInteger(low) ||
    !Number.isInteger(high) ||
    low < 0 ||
    low >= high ||
    !Number.isFinite(tolerance) ||
    tolerance <= 0
  ) {
    throw new RangeError("Cliff search requires integer 0 <= low < high and positive finite tolerance");
  }
  if (!Number.isFinite(requestedMaxIterations) || !Number.isInteger(requestedMaxIterations)) {
    throw new RangeError("maxIterations must be a finite integer");
  }
  if (requestedMaxIterations < 0 || requestedMaxIterations > 64) {
    throw new RangeError("maxIterations must be between 0 and 64");
  }
  const maxIterations = requestedMaxIterations;
  const result = (
    status: CollapseCliffResult["status"],
    iterations: number,
    evaluations: number,
    lowerSafeBound?: number,
    upperFailureBound?: number,
  ): CollapseCliffResult => ({
    status,
    parameter: parameter.name,
    testedRange: { low, high },
    ...(lowerSafeBound === undefined ? {} : { lowerSafeBound }),
    ...(upperFailureBound === undefined ? {} : { upperFailureBound }),
    ...(lowerSafeBound === undefined || upperFailureBound === undefined
      ? {}
      : { estimatedThreshold: (lowerSafeBound + upperFailureBound) / 2 }),
    tolerance,
    iterations,
    evaluations,
  });

  let evaluations = 0;
  const predicate = async (value: number): Promise<boolean> => {
    const fault: ConsonantFault = {
      consonantKind: parameter.consonantKind,
      targetVowelId: parameter.targetVowelId,
      params: { [parameter.paramKey]: value },
    };
    const execution = await executeFaultSequence(graph, [fault], seed);
    evaluations++;
    return execution.violatedInvariants.length > 0;
  };

  const samples: Array<{ value: number; fails: boolean }> = [];
  for (let index = 0; index < 5; index++) {
    const value = Math.round(low + ((high - low) * index) / 4);
    samples.push({ value, fails: await predicate(value) });
  }

  let hasFailed = false;
  let hasSafeAfterFailure = false;
  for (const sample of samples) {
    if (sample.fails) hasFailed = true;
    else if (hasFailed) hasSafeAfterFailure = true;
  }
  if (hasSafeAfterFailure) return result("NON_MONOTONIC", 0, evaluations);

  const lowerSample = samples[0];
  const upperSample = samples[samples.length - 1];
  if (!lowerSample || !upperSample) return result("NO_CLIFF_IN_RANGE", 0, evaluations);
  if (lowerSample.fails) return result("NO_CLIFF_IN_RANGE", 0, evaluations);
  if (!upperSample.fails) return result("NO_CLIFF_IN_RANGE", 0, evaluations);

  let safe = lowerSample.value;
  let failure = upperSample.value;
  let iterations = 0;
  while (failure - safe >= tolerance && iterations < maxIterations) {
    const midpoint = Math.round((safe + failure) / 2);
    if (midpoint === safe || midpoint === failure) break;
    if (await predicate(midpoint)) failure = midpoint;
    else safe = midpoint;
    iterations++;
  }

  if (failure - safe >= tolerance) {
    return result("BUDGET_EXHAUSTED", iterations, evaluations, safe, failure);
  }
  return result("CLIFF_FOUND", iterations, evaluations, safe, failure);
}