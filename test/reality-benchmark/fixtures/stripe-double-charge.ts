export const fixture = {
  id: "stripe-double-charge",
  title: "Stripe-class double charge via POST_COMMIT omission and retry",
  source: {
    url: "https://stripe.com/docs/payments/checkout/usage#idempotency",
    kind: "idempotency docs",
    retrievedDate: "2026-11-03",
  },
  observed: {
    rootCauseSummary: "A POST_COMMIT omission on a non-idempotent payment register causes the caller to retry and charge twice.",
    violatedInvariant: "network idempotency",
  },
  reconstruction: {
    nodes: [
      {
        name: "AI",
        substrates: [{ vowel: "CHANNEL", params: { targetNodeId: "Stripe", timeoutMs: 3000 } }],
        consonants: [{ kind: "OMISSION", params: { phase: "ACK" } }],
        outboundEdges: ["Stripe"],
      },
      {
        name: "Stripe",
        substrates: [{ vowel: "REGISTER", params: { idempotencyEnforced: false } }],
      },
    ],
    declaredInvariants: ["idempotency"],
    seed: 11,
  },
  expected: {
    findingRuleId: "r04-network-idempotency",
    expectedDepth: 2,
    expectedConsonants: ["OMISSION"],
  },
};

export default fixture;
