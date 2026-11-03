import type { SimEvent } from "../../../../kernel.ts";
import type { Finding } from "../finding.ts";
import type { NativeRule } from "../types.ts";
import type { Vowel } from "../../types.ts";

const RULE_ID = "native-channel-cascade";

export function evaluateChannelCascade(events: SimEvent[], _vowels?: Map<string, Vowel>): Finding[] {
  return events.filter((event) => event.kind === "channel.cascade_failure").map((event) => ({
    rule_id: RULE_ID,
    pillar: "dependency-isolation",
    status: "proven",
    severity: "critical",
    message: `Channel send to actor ${String(event.data.targetActorId)} cascaded because target lease ${String(event.data.targetLeaseId)} was saturated.`,
    evidence: {
      span_ids: [event.id],
      resource: String(event.data.targetActorId ?? event.data.targetLeaseId ?? event.corr),
      details: { ...event.data },
    },
    repro: `Saturate target lease ${String(event.data.targetLeaseId)} and execute a send through channel ${String(event.data.channelId)}.`,
    suggested_fix: "Add backpressure or a circuit breaker on sends to saturated targets.",
  }));
}

export const channelCascadeRule: NativeRule = {
  rule_id: RULE_ID,
  evaluate: evaluateChannelCascade,
};