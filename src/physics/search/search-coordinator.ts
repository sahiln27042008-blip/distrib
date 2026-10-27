import type { CompiledAlphabetGraph } from "../alphabet/types.ts";
import type {
  FaultSearchOptions,
  WorkflowReliabilityResult,
} from "./search-types.ts";
import { findCollapseCliff, type CliffParameter } from "./cliff-finder.ts";
import { searchFaults } from "./fault-search.ts";

export interface WorkflowReliabilityOptions extends FaultSearchOptions {
  findCliffs?: boolean;
  cliffParameters?: Array<CliffParameter & {
    low: number;
    high: number;
    tolerance: number;
  }>;
}

export async function auditWorkflowReliability(
  graph: CompiledAlphabetGraph,
  options: WorkflowReliabilityOptions = {},
  seed = 1,
): Promise<WorkflowReliabilityResult> {
  const faultSearch = await searchFaults(graph, options, seed);
  const cliffs = options.findCliffs
    ? await Promise.all(
        (options.cliffParameters ?? []).map(({ low, high, tolerance, ...parameter }) =>
          findCollapseCliff(graph, parameter, { low, high, tolerance }, seed),
        ),
      )
    : [];
  return { faultSearch, cliffs };
}