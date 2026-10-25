import type { PhysicsPrimitive, PhysicsConfig, PhysicsEffect } from "../registry-types.ts";
import type { Intervention } from "../../interventions/primitives.ts";
import type { Sim, SimEvent } from "../../kernel.ts";
import type { Span } from "../../trace.ts";

export const workerStateLossPrimitive: PhysicsPrimitive = {
  id: "worker.state_loss",
  category: "worker",
  description:
    "Models a worker process that loses in-memory state on restart. Without durable checkpoints, the agent must reconstruct state, which may lead to replaying side effects.",

  appliesTo(world) {
    return world.actors.some(
      (a) => a.kind === "worker" || a.kind === "agent",
    );
  },

  configure(world) {
    return {
      primitiveId: "worker.state_loss",
      dialOverrides: {
        E: "E1_god_mode_main_thread",
        F: "F1_blind_retry_unbounded_spend",
      },
    };
  },

  generateInterventions(world) {
    return [
      {
        type: "kill_worker",
        target: "supervisor",
        timing: "during",
        description:
          "Worker process crashes and loses volatile memory state.",
      },
      {
        type: "lose_state",
        target: "agent",
        timing: "after",
        description: "Agent loses in-memory state without checkpoint.",
      },
    ];
  },

  execute(sim, intervention, state) {
    const startLog = sim.log.length;
    const corr = (state.corr as string) ?? `worker-${sim.rng.int(1000, 9999)}`;
    const workerId = (state.workerId as string) ?? `w-${sim.rng.int(1, 10)}`;

    const crashId = sim.emit("worker.crash", corr, {
      actor: "worker",
      workerId,
      reason: "uncaught_exception_sigsegv",
      inMemoryStateLost: true,
    });

    sim.at(20, "worker_restart", () => {
      const restartId = sim.emit(
        "worker.restart",
        corr,
        {
          actor: "worker",
          workerId,
          memoryCleared: true,
        },
        crashId,
      );

      sim.at(10, "state_reconstruct", () => {
        sim.emit(
          "state.reconstruct",
          corr,
          {
            actor: "agent",
            workerId,
            checkpointMissing: true,
            replayingSideEffectsRisk: true,
          },
          restartId,
        );
      });
    });

    while (sim.step()) {}
    return sim.log.slice(startLog);
  },

  getEffects() {
    return [
      {
        type: "state_loss",
        actor: "worker",
        severity: "high",
        description: "In-memory state destroyed during worker crash and restart",
      },
      {
        type: "side_effect_replay",
        actor: "agent",
        severity: "critical",
        description:
          "Replaying side effects due to missing durable checkpoints",
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

