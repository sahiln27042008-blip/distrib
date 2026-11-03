export const fixture = {
  id: "gitlab-database-deletion",
  title: "GitLab database deletion by operator error",
  source: {
    url: "https://about.gitlab.com/2017/02/01/gitlab-dot-com-database-incident/",
    kind: "postmortem",
    retrievedDate: "2026-11-03",
  },
  observed: {
    rootCauseSummary: "An engineer deleted the wrong production directory; backup validation and restore coverage were not sufficient.",
    violatedInvariant: "human-initiated destructive command coverage",
  },
  reconstruction: {
    nodes: [
      {
        name: "operator-shell",
        substrates: [{ vowel: "CHANNEL", params: { targetNodeId: "backup-store", timeoutMs: 5000 } }],
        nodeDescription: "rm -rf /var/opt/gitlab/postgresql and no backup guard exists",
      },
      {
        name: "backup-store",
        substrates: [{ vowel: "REGISTER", params: { idempotencyEnforced: false } }],
      },
    ],
    declaredInvariants: ["backup safety"],
    seed: 42,
  },
  expected: {
    findingRuleId: "MODEL_GAP",
    expectedDepth: 0,
    expectedConsonants: [],
  },
  modelGapReason: "human-initiated destructive command with absent backup coverage is not representable by the 10-character causal alphabet (no consonant models operator-initiated state destruction outside the system's execution path).",
};

export default fixture;
