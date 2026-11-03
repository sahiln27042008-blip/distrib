export const fixture = {
  id: "knight-capital-retry-storm",
  title: "Knight Capital unbounded retry storm",
  source: {
    url: "https://www.sec.gov/litigation/admin/2013/34-70073.pdf",
    kind: "SEC administrative proceeding",
    retrievedDate: "2026-11-03",
  },
  observed: {
    retryWindowMinutes: 45,
    lossUsd: 440000000,
    serverCount: 8,
    rootCauseSummary: "A dead trading algorithm was deployed across eight servers and retried without a budget envelope.",
    violatedInvariant: "unit economics / spend envelope",
  },
  reconstruction: {
    nodes: [
      {
        name: "trade-engine",
        substrates: [{ vowel: "CHANNEL", params: { targetNodeId: "retry-broker", timeoutMs: 1000, idempotencyEnabled: false, budgetUsd: 999 } }],
        consonants: [{ kind: "DUPLICATION", params: { count: 1000 } }],
      },
      {
        name: "retry-broker",
        substrates: [{ vowel: "LEASE", params: { maxCapacity: 1000000, ttlMs: 2700000, overflowPolicy: "WAIT_TIMEOUT" } }],
      },
    ],
    declaredInvariants: ["unit economics", "spend envelope"],
    seed: 42,
  },
  expected: {
    findingRuleId: "native-cost-burn",
    expectedDepth: 1,
    expectedConsonants: ["DUPLICATION"],
  },
};

export default fixture;
