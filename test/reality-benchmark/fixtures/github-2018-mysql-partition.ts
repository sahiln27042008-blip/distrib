import { UNKNOWN } from "./common.ts";

export const fixture = {
  id: "github-2018-mysql-partition",
  title: "GitHub MySQL 43s network partition",
  source: {
    url: "https://github.blog/2018-10-30-oct21-post-incident-analysis/",
    kind: "postmortem",
    retrievedDate: "2026-11-03",
  },
  observed: {
    partitionDurationMs: 43000,
    failoverDecisionWindowMs: UNKNOWN,
    degradedDurationHours: 24,
    rootCauseSummary: "A 43-second partition between US East and West MySQL primaries triggered failover and caused a 24-hour degraded period.",
    violatedInvariant: "replication continuity / failover safety",
  },
  reconstruction: {
    nodes: [
      {
        name: "primary-east",
        substrates: [{ vowel: "CHANNEL", params: { targetNodeId: "primary-west", timeoutMs: 43000 } }],
        consonants: [{ kind: "OMISSION", params: { phase: "ACK" } }],
        outboundEdges: ["primary-west"],
      },
      {
        name: "primary-west",
        substrates: [
          { vowel: "REGISTER", params: { idempotencyEnforced: false } },
          { vowel: "LEASE", params: { maxCapacity: 1, ttlMs: 30000, heldDuringExternalChannel: true } },
        ],
        outboundEdges: ["orchestrator"],
      },
      {
        name: "orchestrator",
        substrates: [{ vowel: "CHANNEL", params: { targetNodeId: "primary-west", timeoutMs: 30000 } }],
      },
    ],
    declaredInvariants: ["replication continuity", "failover safety"],
    seed: 42,
    cliffTargetChannel: "vowel-1-1",
  },
  expected: {
    findingRuleId: "native-lease-epoch-expiry",
    expectedCliffMs: 43000,
    expectedDepth: 2,
    expectedConsonants: ["OMISSION"],
    partialAcceptedRules: ["r04-network-idempotency"],
  },
};

export default fixture;
