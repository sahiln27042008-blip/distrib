export const answerKey: Record<string, { expectedInvariant?: string; rationale: string }> = {
  "case-financial-mutation": {
    expectedInvariant: "r04-network-idempotency",
    rationale: "Legacy payment retries can repeat a committed side effect without idempotency protection.",
  },
  "case-lost-ack-restart": {
    expectedInvariant: "r04-network-idempotency",
    rationale: "A committed operation with a lost acknowledgement can be retried after worker restart.",
  },
  "case-budget-metric-conflict": {
    expectedInvariant: "r10-unit-economics",
    rationale: "The expected budget violation must be established by the auditor, not inferred from a positive cost metric alone.",
  },
  "case-recovery-after-restart": {
    expectedInvariant: "r05-distributed-sagas",
    rationale: "The combined restart, partial failure, and recovery configuration is intended to challenge compensation evidence.",
  },
  "case-negative-control": {
    rationale: "No invariant violation is expected from the clean resilient control configuration.",
  },
};
