// enterpriseee/enterprise-simulator/src/physics/search/search-types.ts

export type ConsonantFault = {
  consonantKind: "DELAY" | "SEVER" | "DUPLICATE" | "SATURATE" | "WIPE" | "CORRUPT";
  targetVowelId: string;
  params: Record<string, unknown>;
};

export interface Finding {
  rule_id: string;
  pillar: string;
  status: "proven" | "unknown" | "not_evaluated";
  severity: "critical" | "warning" | "info";
  message: string;
  evidence: {
    span_ids: string[];
    resource?: string;
    hashes?: string[];
    gap_ms?: number;
    details?: Record<string, unknown>;
  };
  repro: string;
  suggested_fix: string;
}

export interface SearchNode {
  faultSequence: ConsonantFault[];
  depth: number;
}

export interface FaultSearchOptions {
  maxDepth?: number;        // default 3
  maxEvaluations?: number;  // default 5000
  timeoutMs?: number;       // default 2000 — advisory only, do not make correctness depend on wall-clock
}

export type FaultSearchStatus =
  | "BASELINE_FAILURE"
  | "FAILURE_FOUND"
  | "NO_FAILURE_WITHIN_BOUND"
  | "BUDGET_EXHAUSTED";

export interface FaultSearchResult {
  status: FaultSearchStatus;
  minimalCounterexample?: ConsonantFault[];
  violatedInvariants: string[];
  depthReached: number;
  evaluations: number;
  durationMs: number;
  deterministicFingerprint?: string;
}

export interface CliffSearchOptions {
  low: number;
  high: number;
  tolerance: number;
  maxIterations?: number;  // default 30
}

export type CollapseCliffStatus =
  | "CLIFF_FOUND"
  | "NO_CLIFF_IN_RANGE"
  | "NON_MONOTONIC"
  | "BUDGET_EXHAUSTED";

export interface CollapseCliffResult {
  status: CollapseCliffStatus;
  parameter: string;
  testedRange: { low: number; high: number };
  lowerSafeBound?: number;
  upperFailureBound?: number;
  estimatedThreshold?: number;
  tolerance: number;
  iterations: number;
  evaluations: number;
}

export interface WorkflowReliabilityResult {
  faultSearch: FaultSearchResult;
  cliffs: CollapseCliffResult[];
}

