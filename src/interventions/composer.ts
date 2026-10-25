import { INTERVENTIONS, type Intervention } from "./primitives.ts";

export interface InterventionSequence {
  id: string;
  interventions: Intervention[];
  hypothesis: string;
  expectedInvariant?: string;
}

export function composeSequence(
  interventions: Intervention[],
  hypothesis: string,
  expectedInvariant?: string,
): InterventionSequence {
  return {
    id: `seq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    interventions,
    hypothesis,
    expectedInvariant,
  };
}

export const KNOWN_FAILURE_SEQUENCES: InterventionSequence[] = [
  {
    id: "double-charge-classic",
    interventions: [
      INTERVENTIONS.missing_idempotency_key,
      INTERVENTIONS.drop_response,
      INTERVENTIONS.kill_worker,
      INTERVENTIONS.duplicate_request,
    ],
    hypothesis: "Payment commits but its response is lost. The worker restarts and the agent retries without an idempotency key, causing a duplicate charge.",
    expectedInvariant: "r04-network-idempotency",
  },
  {
    id: "orphaned-resource",
    interventions: [
      INTERVENTIONS.partial_failure,
      INTERVENTIONS.lose_state,
    ],
    hypothesis: "A saga partially completes, then the worker loses state before compensation, leaving an orphaned resource.",
    expectedInvariant: "r05-distributed-sagas",
  },
  {
    id: "budget-burn",
    interventions: [
      INTERVENTIONS.context_bloat,
      INTERVENTIONS.missing_idempotency_key,
      INTERVENTIONS.rate_limit,
    ],
    hypothesis: "Context bloat degrades decisions, rate limits trigger retries, and missing idempotency burns budget on duplicate work.",
    expectedInvariant: "r10-unit-economics",
  },
];