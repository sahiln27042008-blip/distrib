import { UNKNOWN } from "./common.ts";

export const fixture = {
  id: "cloudflare-edge-proxy-overflow",
  title: "Cloudflare edge proxy overflow from unmerged ClickHouse rows",
  source: {
    url: "https://blog.cloudflare.com/",
    kind: "postmortem",
    retrievedDate: "2026-11-03",
  },
  observed: {
    unmergedFeatureRows: 70,
    edgeProxyCapacity: 50,
    compactionLagMs: UNKNOWN,
    rootCauseSummary: "Unmerged ClickHouse rows saturated the bounded edge-proxy feature store and caused a crash.",
    violatedInvariant: "bounded consumer payload / process isolation",
  },
  reconstruction: {
    nodes: [
      {
        name: "clickhouse",
        substrates: [{ vowel: "LOG", params: { maxCapacity: 500, compactionLagMs: 10000, deduplicateOnCompact: true } }],
        consonants: [{ kind: "DELAY", params: { durationMs: 5000 } }],
      },
      {
        name: "edge-proxy",
        substrates: [
          { vowel: "LEASE", params: { maxCapacity: 50, ttlMs: 60000, overflowPolicy: "PANIC_CRASH" } },
          { vowel: "CHANNEL", params: { targetNodeId: "clickhouse", timeoutMs: 5000 } },
        ],
        consonants: [{ kind: "SATURATE", params: { loadUnits: 70 } }],
        outboundEdges: ["clickhouse"],
      },
    ],
    declaredInvariants: ["bounded consumer payload", "process isolation"],
    seed: 42,
  },
  expected: {
    findingRuleId: "r05-distributed-sagas",
    expectedDepth: 2,
    expectedConsonants: ["SATURATE"],
  },
};

export default fixture;
