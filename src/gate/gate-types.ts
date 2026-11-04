import type { MatrixConfig } from "../matrix-copy.ts";

export type GateStatus = "COVERAGE_REPORT" | "APPROVED" | "BLOCKED" | "INSUFFICIENT_EVIDENCE";

export interface GateEvidence {
  discoveredFailures: Array<{
    id: string;
    hypothesis: string;
    invariant: string;
    businessImpact: string;
    counterexample: Array<{ description: string; timestamp: number }>;
    replayHandle: { seed: number; config: MatrixConfig };
  }>;
  patches: Array<{
    ruleId: string;
    description: string;
    diff: string;
    isVerified: boolean;
    beforeImpact: string;
    afterImpact: string;
    proof: string;
  }>;
  experimentsRun: number;
  scenariosTested: number;
  provenFindingsTotal: number;
  status: GateStatus;
  reason: string;
  generatedAt: string;
}

export interface GateRequest {
  config: MatrixConfig;
  systemDescription?: string;
  maxExperiments?: number;
  invariants?: string[];
}