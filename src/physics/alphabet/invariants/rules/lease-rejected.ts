import type { SimEvent } from "../../../../kernel.ts";
import type { Finding } from "../finding.ts";
import type { NativeRule } from "../types.ts";
import type { Vowel } from "../../types.ts";

const RULE_ID = "native-lease-rejected";

export function evaluateLeaseRejected(events: SimEvent[], _vowels?: Map<string, Vowel>): Finding[] {
  return events.filter((event) => event.kind === "lease.rejected").map((event) => ({
    rule_id: RULE_ID,
    pillar: "capacity",
    status: "proven",
    severity: "warning",
    message: `Lease ${String(event.data.leaseId)} safely rejected request under ${String(event.data.policy)} policy (load ${String(event.data.currentLoad)}/${String(event.data.maxCapacity)}).`,
    evidence: {
      span_ids: [event.id],
      resource: String(event.data.actorId ?? event.data.leaseId ?? event.corr),
      details: { ...event.data },
    },
    repro: `Reach the configured lease capacity under REJECT_429 and observe the request rejection.`,
    suggested_fix: "Keep the rejection behavior and add caller backoff or load shedding to reduce repeated pressure.",
  }));
}

export const leaseRejectedRule: NativeRule = {
  rule_id: RULE_ID,
  evaluate: evaluateLeaseRejected,
};