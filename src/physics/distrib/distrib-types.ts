// enterpriseee/enterprise-simulator/src/physics/distrib/distrib-types.ts

import type { CompiledAlphabetGraph, ConsonantKind } from "../alphabet/types.ts";
import type { SimEvent } from "../../kernel.ts";
import type { Finding } from "../search/search-types.ts";

export type DistribSearchStatus =
  | "BASELINE_FAILURE"
  | "FAILURE_FOUND"
  | "NO_FAILURE_WITHIN_BOUND"
  | "BUDGET_EXHAUSTED"
  | "INSUFFICIENT_PHYSICS";

export interface DistribConsonantFault {
  consonantKind: ConsonantKind;
  targetVowelId: string;
  params: Record<string, unknown>;
}

export interface InvariantResult {
  id: string;
  name: string;
  category:
    | "payment_safety"
    | "task_correctness"
    | "idempotency"
    | "lease_safety"
    | "resource_safety"
    | "cancellation"
    | "recovery"
    | "event_integrity"
    | "result_integrity"
    | "observability";
  passed: boolean;
  evidence: string;
  details?: Record<string, unknown>;
}

export interface DistribExecutionResult {
  events: SimEvent[];
  invariants: InvariantResult[];
  auditorFindings: Finding[];
  violatedInvariants: string[];
  worldState: Record<string, unknown>;
}

export interface DistribBfsOptions {
  maxDepth?: number;
  maxEvaluations?: number;
  timeoutMs?: number;
  recordTrace?: boolean;
}

export interface DistribBfsResult {
  status: DistribSearchStatus;
  scenarioId: string;
  minimalCounterexample?: DistribConsonantFault[];
  violatedInvariants: string[];
  depthReached: number;
  evaluations: number;
  statesExplored: number;
  durationMs: number;
  deterministicFingerprint: string;
  reproducedOnReplay?: boolean;
  traceSummary?: {
    totalEvents: number;
    auditorFindingsCount: number;
  };
  insufficientPhysicsReason?: string;
  isExhaustiveWithinBound?: boolean;
}

export interface DistribScenarioDefinition {
  id: string;
  name: string;
  description: string;
  buildGraph: (ablation?: string) => CompiledAlphabetGraph;
  candidateFaults: DistribConsonantFault[];
  expectedFailureInvariant?: string;
  isRepresentable: boolean;
  unrepresentableReason?: string;
}

export interface ScenarioExperimentReport {
  scenarioId: string;
  name: string;
  status: DistribSearchStatus;
  isRepresentable: boolean;
  baselinePassed: boolean;
  baselineViolations: string[];
  counterexampleFound?: DistribConsonantFault[];
  shortestDepth?: number;
  evaluations: number;
  statesExplored: number;
  reproducedOnReplay?: boolean;
  violatedInvariants: string[];
  auditorEvidence: string[];
  ablationComparison?: {
    ablationName: string;
    baselineStatus: DistribSearchStatus;
    faultStatus: DistribSearchStatus;
    difference: string;
  };
}

