export const fixture = {
  id: "aws-dynamodb-us-east-1-overload",
  title: "AWS DynamoDB us-east-1 metadata overload",
  source: {
    url: "https://aws.amazon.com/message/41926/",
    kind: "postmortem",
    retrievedDate: "2026-11-03",
  },
  observed: {
    degradedDurationHours: 5,
    rootCauseSummary: "Metadata service overload under high request rate cascaded into dependent services and required a throttling response.",
    violatedInvariant: "cascading dependency isolation",
  },
  reconstruction: {
    nodes: [
      {
        name: "metadata-service",
        substrates: [{ vowel: "LEASE", params: { maxCapacity: 50, ttlMs: 300000, overflowPolicy: "REJECT_429" } }],
        consonants: [{ kind: "SATURATE", params: { loadUnits: 200 } }],
      },
      {
        name: "downstream-a",
        substrates: [{ vowel: "CHANNEL", params: { targetNodeId: "metadata-service", timeoutMs: 1000 } }],
      },
      {
        name: "downstream-b",
        substrates: [{ vowel: "CHANNEL", params: { targetNodeId: "metadata-service", timeoutMs: 1000 } }],
      },
    ],
    declaredInvariants: ["dependency isolation", "throttling safety"],
    seed: 42,
  },
  expected: {
    findingRuleId: "r05-distributed-sagas",
    expectedDepth: 2,
    expectedConsonants: ["SATURATE"],
  },
};

export default fixture;
