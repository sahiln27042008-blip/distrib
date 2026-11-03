import type { SimEvent } from "../../../../kernel.ts";
import type { Finding } from "../finding.ts";
import type { NativeRule } from "../types.ts";
import type { Vowel } from "../../types.ts";

const RULE_ID = "native-lease-epoch-expiry";

export function evaluateLeaseEpochExpired(events: SimEvent[], _vowels?: Map<string, Vowel>): Finding[] {
  return events.filter((event) => event.kind === "lease.epoch_expired").map((event) => ({
    rule_id: RULE_ID,
    pillar: "lease-fencing",
    status: "proven",
    severity: "critical",
    message: `Lease ${String(event.data.leaseId)} expired for holder ${String(event.data.holderActorId)}; its fencing epoch advanced and the holder's write window lapsed.`,
    evidence: {
      span_ids: [event.id],
      resource: String(event.data.actorId ?? event.data.leaseId ?? event.corr),
      details: { ...event.data },
    },
    repro: `Hold lease ${String(event.data.leaseId)} beyond its TTL and observe the epoch advance.`,
    suggested_fix: "Release the lease before its TTL or use fencing tokens to reject stale writes.",
  }));
}

export const leaseEpochExpiredRule: NativeRule = {
  rule_id: RULE_ID,
  evaluate: evaluateLeaseEpochExpired,
};