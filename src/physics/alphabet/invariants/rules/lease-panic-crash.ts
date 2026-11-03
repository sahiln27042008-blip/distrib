import type { SimEvent } from "../../../../kernel.ts";
import type { Finding } from "../finding.ts";
import type { NativeRule } from "../types.ts";
import type { Vowel } from "../../types.ts";

const RULE_ID = "native-lease-capacity-overflow";

export function evaluateLeasePanicCrash(events: SimEvent[], _vowels?: Map<string, Vowel>): Finding[] {
  return events.filter((event) => event.kind === "lease.panic_crash").map((event) => ({
    rule_id: RULE_ID,
    pillar: "capacity",
    status: "proven",
    severity: "critical",
    message: `Lease ${String(event.data.leaseId)} on actor ${String(event.data.actorId)} panicked: load ${String(event.data.currentLoad)} exceeded capacity ${String(event.data.maxCapacity)} under policy ${String(event.data.policy)}.`,
    evidence: {
      span_ids: [event.id],
      resource: String(event.data.actorId ?? event.data.leaseId ?? event.corr),
      details: {
        leaseId: event.data.leaseId,
        currentLoad: event.data.currentLoad,
        maxCapacity: event.data.maxCapacity,
        policy: event.data.policy,
        requesterId: event.data.requesterId,
      },
    },
    repro: `Apply SATURATE with loadUnits greater than maxCapacity on lease ${String(event.data.leaseId)} (overflowPolicy: PANIC_CRASH).`,
    suggested_fix: "Increase lease capacity, shed load before the boundary, or switch overflowPolicy to REJECT_429 with backpressure.",
  }));
}

export const leasePanicCrashRule: NativeRule = {
  rule_id: RULE_ID,
  evaluate: evaluateLeasePanicCrash,
};