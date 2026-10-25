import type { PhysicsPrimitive, PhysicsConfig, PhysicsEffect } from "../registry-types.ts";
import type { Intervention } from "../../interventions/primitives.ts";
import type { Sim, SimEvent } from "../../kernel.ts";
import type { Span } from "../../trace.ts";

export const partialCommitPrimitive: PhysicsPrimitive = {
  id: "transaction.partial_commit",
  category: "transaction",
  description:
    "Models a transaction that commits a side effect but whose acknowledgment can be lost. The world state shows committed=true but the agent's belief state shows unknown. This is the core mechanism behind duplicate charges after network drops.",

  appliesTo(world) {
    return world.actors.some(
      (a) => a.kind === "payment_service" || a.kind === "external_api",
    );
  },

  configure(world) {
    return {
      primitiveId: "transaction.partial_commit",
      dialOverrides: {
        C: "C5_legacy_erp_no_idem",
        F: "F1_blind_retry_unbounded_spend",
      },
      customParams: { ackLossRate: 1.0 },
    };
  },

  generateInterventions(world) {
    return [
      {
        type: "drop_response",
        target: "payment",
        timing: "after",
        description: "Transaction commits but response/acknowledgment is dropped.",
        parameters: { partialCommit: true },
      },
      {
        type: "duplicate_request",
        target: "payment",
        timing: "after",
        description: "Agent retries transaction after lost acknowledgment.",
        parameters: { partialCommit: true },
      },
    ];
  },

  execute(sim, intervention, state) {
    const startLog = sim.log.length;
    const corr = (state.corr as string) ?? `tx-${sim.rng.int(1000, 9999)}`;
    const amount = (state.amount as number) ?? 50;

    const commitId = sim.emit("transaction.commit", corr, {
      actor: "payment",
      committed: true,
      amount,
      txId: `tx_${sim.rng.int(10000, 99999)}`,
    });

    sim.at(10, "ack_drop", () => {
      const ackId = sim.emit(
        "transaction.ack_lost",
        corr,
        {
          actor: "network",
          parentCommit: commitId,
          agentBelief: "unknown",
          reason: "connection_reset_by_peer",
        },
        commitId,
      );

      sim.at(20, "retry", () => {
        sim.emit(
          "transaction.retry",
          corr,
          {
            actor: "agent",
            parentAckLost: ackId,
            retryAttempt: 1,
            duplicateChargeRisk: true,
          },
          ackId,
        );
      });
    });

    while (sim.step()) {}
    return sim.log.slice(startLog);
  },

  getEffects() {
    return [
      {
        type: "duplicate_charge",
        actor: "payment",
        severity: "critical",
        description:
          "Duplicate charge caused by lost acknowledgment and subsequent retry",
      },
      {
        type: "belief_reality_divergence",
        actor: "agent",
        severity: "high",
        description:
          "Agent belief is unknown while side effect is committed in world",
      },
    ];
  },

  toSpans(events: SimEvent[]): Span[] {
    return events.map((e) => ({
      spanId: `s-${e.id}`,
      parentSpanId: e.parent ? `s-${e.parent}` : null,
      name: e.kind,
      startMs: e.t,
      endMs: e.t,
      status: "ok",
      attrs: { ...e.data, corr: e.corr },
      links: [],
      events: [],
    }));
  },
};

