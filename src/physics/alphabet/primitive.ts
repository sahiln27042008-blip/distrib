// enterpriseee/enterprise-simulator/src/physics/alphabet/primitive.ts

import type { PhysicsPrimitive, PhysicsConfig, PhysicsEffect, PhysicsRegistry } from "../registry-types.ts";
import type { Intervention } from "../../interventions/primitives.ts";
import type { Sim, SimEvent } from "../../kernel.ts";
import type { Span } from "../../trace.ts";
import { applyConsonant } from "./apply.ts";
import type { CompiledAlphabetGraph, CandidatePerturbation } from "./types.ts";

export function registerAlphabetPrimitive(reg: PhysicsRegistry): void {
  reg.register(universalCausalAlphabetPrimitive);
}

export const universalCausalAlphabetPrimitive: PhysicsPrimitive = {
  id: "universal.causal_alphabet",
  category: "universal",
  description:
    "Universal causal alphabet primitive executing 4 vowels (CELL, LOG, LEASE, CHANNEL) and 6 consonants (DELAY, SEVER, DUPLICATE, SATURATE, WIPE, CORRUPT) over kernel virtual time",

  appliesTo(_world: {
    actors: Array<{
      kind: string;
      name: string;
      contract?: { guarantees: string[] };
    }>;
  }): boolean {
    return true; // Universal: applies to any architecture
  },

  configure(_world: { actors: Array<{ kind: string }> }): PhysicsConfig {
    return {
      primitiveId: "universal.causal_alphabet",
    };
  },

  generateInterventions(_world: {
    actors: Array<{ kind: string }>;
  }): Intervention[] {
    return [
      {
        type: "delay_response",
        target: "all",
        timing: "during",
        parameters: { durationMs: 5000 },
        description: "Delay channel response beyond timeout",
      },
      {
        type: "drop_response",
        target: "all",
        timing: "after",
        parameters: { phase: "POST_COMMIT" },
        description: "Sever channel response ACK after commit",
      },
      {
        type: "duplicate_request",
        target: "all",
        timing: "after",
        parameters: { count: 2 },
        description: "Duplicate channel envelope to test idempotency",
      },
      {
        type: "rate_limit",
        target: "all",
        timing: "before",
        parameters: { loadUnits: 100 },
        description: "Saturate bounded resource lease past capacity",
      },
      {
        type: "lose_state",
        target: "all",
        timing: "before",
        parameters: { scope: "VOLATILE_CELLS" },
        description: "Wipe volatile state while preserving durable state",
      },
      {
        type: "partial_failure",
        target: "all",
        timing: "during",
        parameters: { mode: "LOSSY_DROP" },
        description: "Corrupt state via deterministic lossy drop or schema drift",
      },
    ];
  },

  execute(
    sim: Sim,
    intervention: Intervention,
    state: Record<string, unknown>,
  ): SimEvent[] {
    const startIdx = sim.log.length;

    // Check if state contains a CompiledAlphabetGraph
    const graph = state.alphabetGraph as CompiledAlphabetGraph | undefined;

    if (graph && graph.candidatePerturbations.length > 0) {
      for (const perturbation of graph.candidatePerturbations) {
        const targetVowel = graph.vowels.find((v) => v.id === perturbation.targetId);
        if (targetVowel) {
          applyConsonant(sim, targetVowel, perturbation.consonant, undefined, sim.rng);
        }
      }
    } else {
      // Default execution based on intervention type
      sim.emit("alphabet.execute", intervention.target, {
        interventionType: intervention.type,
        target: intervention.target,
        description: intervention.description,
        appliedAt: sim.now,
      });
    }

    return sim.log.slice(startIdx);
  },

  getEffects(): PhysicsEffect[] {
    return [
      {
        type: "state_divergence",
        actor: "channel_caller",
        severity: "critical",
        description: "Sever or delayed ack creates agent observation / world state divergence",
      },
      {
        type: "duplicate_mutation",
        actor: "unprotected_cell",
        severity: "high",
        description: "Retries or duplicates against cell without idempotency land duplicate mutations",
      },
      {
        type: "resource_panic",
        actor: "bounded_lease",
        severity: "critical",
        description: "Saturating bounded lease with panic overflow crashes host",
      },
      {
        type: "stale_write_rejection",
        actor: "fenced_cell",
        severity: "medium",
        description: "Wiped lease epoch rejects subsequent stale write attempts",
      },
    ];
  },

  toSpans(events: SimEvent[]): Span[] {
    const spans: Span[] = [];
    for (const e of events) {
      if (e.kind.startsWith("channel.") || e.kind.startsWith("consonant.") || e.kind.startsWith("lease.") || e.kind.startsWith("cell.") || e.kind.startsWith("log.")) {
        spans.push({
          spanId: `s-${e.id}`,
          parentSpanId: e.parent ? `s-${e.parent}` : null,
          name: e.kind,
          startMs: e.t,
          endMs: e.t,
          status: e.kind.includes("divergence") || e.kind.includes("panic") || e.kind.includes("timeout") ? "error" : "ok",
          attrs: { ...e.data },
          links: [],
          events: [],
        });
      }
    }
    return spans;
  },
};
