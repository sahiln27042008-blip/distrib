import type { PhysicsPrimitive, PhysicsConfig, PhysicsEffect } from "../registry-types.ts";
import type { Intervention } from "../../interventions/primitives.ts";
import type { Sim, SimEvent } from "../../kernel.ts";
import type { Span } from "../../trace.ts";

export const eventualConsistencyPrimitive: PhysicsPrimitive = {
  id: "consistency.eventual",
  category: "consistency",
  description:
    "Models eventual consistency where reads may return stale data until replication catches up. Useful for distributed database scenarios where stale reads cause downstream failures.",

  appliesTo(world) {
    return world.actors.some(
      (a) =>
        a.kind === "database" &&
        (!a.contract?.guarantees ||
          a.contract.guarantees.length === 0 ||
          a.contract.guarantees.some(
            (g) =>
              g.toLowerCase().includes("eventual consistency") ||
              g.toLowerCase().includes("eventual") ||
              g.toLowerCase().includes("replication"),
          )),
    );
  },

  configure(world) {
    return {
      primitiveId: "consistency.eventual",
      dialOverrides: {
        B: "B5_in_doubt_zombie_tx",
      },
      customParams: { replicationLagMs: 50 },
    };
  },

  generateInterventions(world) {
    return [
      {
        type: "stale_read",
        target: "database",
        timing: "during",
        description: "The database returns stale data before replication catches up.",
        parameters: { replicationLagMs: 50 },
      },
    ];
  },

  execute(sim, intervention, state) {
    const startLog = sim.log.length;
    const corr = (state.corr as string) ?? `ec-${sim.rng.int(1000, 9999)}`;
    const lagMs = (state.lagMs as number) ?? 50;

    const staleId = sim.emit("stale_read", corr, {
      actor: "database",
      version: 1,
      latestVersion: 2,
      stalenessMs: lagMs,
      entityId: (state.entityId as string) ?? "record-1",
    });

    sim.at(Math.floor(lagMs / 2), "replication_lag", () => {
      sim.emit(
        "replication_lag",
        corr,
        {
          actor: "database_replica",
          lagMs,
          parentStaleRead: staleId,
        },
        staleId,
      );
    });

    sim.at(lagMs, "eventual_converge", () => {
      sim.emit(
        "eventual_converge",
        corr,
        {
          actor: "database",
          convergedVersion: 2,
          consistent: true,
        },
        staleId,
      );
    });

    while (sim.step()) {}
    return sim.log.slice(startLog);
  },

  getEffects() {
    return [
      {
        type: "stale_read",
        actor: "database",
        severity: "high",
        description: "Database read returns stale data due to replication lag",
      },
      {
        type: "downstream_inconsistency",
        actor: "database",
        severity: "medium",
        description: "Downstream state transitions based on outdated reads",
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

