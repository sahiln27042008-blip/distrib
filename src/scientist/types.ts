// src/scientist/types.ts

import type { MatrixConfig } from "../matrix-copy.ts";
import type { Finding } from "../../../../resilient-agent-invariants/src/types/finding.ts";
import type { Trace } from "../trace.ts";
import type { InterventionSequence } from "../interventions/composer.ts";
import type { Orchestrator } from "../llm/orchestrator.ts";

export interface ScientistConfig {
  baseConfig: MatrixConfig;        // the user's system
  maxExperiments: number;          // budget (default 20)
  maxSteps: number;                // max sim steps per experiment
  invariants: string[];            // which rules to check for (e.g. ["r04-network-idempotency", "r05-distributed-sagas", "r10-unit-economics"])
  orchestrator?: Orchestrator;
  onModelExchange?: (exchange: ScientistModelExchange) => void;
  systemDescription?: string;
  includeConfigurationInPrompt?: boolean;
}

export interface ScientistModelExchange {
  messages: Array<{ role: string; content: unknown }>;
  response: unknown;
  durationMs?: number;
}

export interface ScientistExperimentLog {
  hypothesis: FailureHypothesis;
  result: ExperimentResult;
  claimStatus: "auditor_not_proven" | "independent_proof_failed" | "confirmed";
  independentVerification?: DiscoveredFailure["independentVerification"];
}

export interface FailureHypothesis {
  id: string;
  description: string;             // "If payment response is lost and worker restarts, agent retries without idempotency key → duplicate charge"
  experimentRationale?: string;
  interventionSequence: InterventionSequence;
  expectedInvariant: string;       // "r04-network-idempotency"
  confidence: number;              // 0-1, how confident the AI is
}

export interface ExperimentResult {
  hypothesisId: string;
  config: MatrixConfig;            // the config that was run
  snapshot: unknown;               // matrix snapshot
  trace: Trace;                    // the full trace
  findings: Finding[];              // auditor findings
  provenFindings: Finding[];       // only proven ones
  matchedHypothesis: boolean;      // did the expected invariant fire as proven?
  duplicateDollars?: number;       // measured business impact
  orphanedResources?: number;
  costUsd?: number;
}

export interface DiscoveredFailure {
  id: string;
  hypothesis: FailureHypothesis;
  experiment: ExperimentResult;
  businessImpact: string;         // "$50,000 in duplicate charges"
  counterexample: string[];        // minimal event sequence (filled by minimizer later)
  independentVerification?: {
    replayMatched: boolean;
    auditorProven: boolean;
    minimizedStillViolates: boolean;
    minimizedEventCount: number;
  };
  replayHandle: {                  // for deterministic reproduction
    seed: number;
    config: MatrixConfig;
  };
}

export interface ScientistResult {
  status: "FAILURE_FOUND" | "NO_FAILURE_FOUND" | "INCONCLUSIVE";
  inconclusiveReasons: string[];
  config: ScientistConfig;
  experimentsRun: number;
  hypothesesGenerated: number;
  discoveredFailures: DiscoveredFailure[];
  provenFindingsTotal: number;
  budgetExhausted: boolean;
  modelExchanges: ScientistModelExchange[];
  experimentLog: ScientistExperimentLog[];
}

