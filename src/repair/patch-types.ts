// src/repair/patch-types.ts

export interface CodePatch {
  id: string;
  ruleId: string;            // which finding this fixes
  findingId: string;         // specific finding
  description: string;       // "Add idempotency key from refund operation ID"
  diff: string;              // unified diff format
  affectedFile: string;      // hypothetical file path (e.g. "src/refund.ts")
  changedLines: number;
  explanation: string;       // why this fixes the failure
  dialEquivalent: {          // the dial change that represents this fix in the simulator
    dial: string;            // "C"
    from: string;            // "C5_legacy_erp_no_idem"
    to: string;              // "C1_clean_20ms"
  };
}

export interface PatchVerificationResult {
  patchId: string;
  originalConfig: unknown;    // MatrixConfig that produced the failure
  fixedConfig: unknown;       // MatrixConfig with the fix applied
  findingRuleId: string;
  beforeFindings: number;     // proven findings count
  afterFindings: number;      // proven findings count after fix
  beforeBusinessImpact: string;
  afterBusinessImpact: string;
  isFixed: boolean;
  proof: string;              // human-readable proof string
  replayHandle: {
    seed: number;
    config: unknown;
  };
}

