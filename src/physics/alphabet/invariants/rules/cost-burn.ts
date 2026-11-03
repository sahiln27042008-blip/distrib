import type { SimEvent } from "../../../../kernel.ts";
import type { Finding } from "../finding.ts";
import type { NativeRule } from "../types.ts";
import type { Vowel } from "../../types.ts";

const RULE_ID = "native-cost-burn";

export function evaluateCostBurn(events: SimEvent[], _vowels?: Map<string, Vowel>): Finding[] {
  return events.filter((event) => event.kind === "cost.burn_exceeded").map((event) => ({
    rule_id: RULE_ID,
    pillar: "unit-economics",
    status: "proven",
    severity: "critical",
    message: `Unbounded retry burned ${String(event.data.totalCost)} (threshold ${String(event.data.threshold)}) on channel ${String(event.data.channelId)}.`,
    evidence: {
      span_ids: [event.id],
      resource: String(event.data.channelId ?? event.corr),
      details: { ...event.data },
    },
    repro: `Repeat sends on channel ${String(event.data.channelId)} until cumulative cost exceeds its declared budget.`,
    suggested_fix: "Add a budget envelope; halt execution when inFlightCost exceeds the cap.",
  }));
}

export const costBurnRule: NativeRule = {
  rule_id: RULE_ID,
  evaluate: evaluateCostBurn,
};