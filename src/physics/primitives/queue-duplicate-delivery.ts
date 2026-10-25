import type { PhysicsPrimitive, PhysicsConfig, PhysicsEffect } from "../registry-types.ts";
import type { Intervention } from "../../interventions/primitives.ts";
import type { Sim, SimEvent } from "../../kernel.ts";
import type { Span } from "../../trace.ts";

export const queueDuplicateDeliveryPrimitive: PhysicsPrimitive = {
  id: "queue.duplicate_delivery",
  category: "queue",
  description:
    "Models a message queue that can deliver the same message twice (at-least-once delivery). Without idempotent consumers, duplicate delivery causes duplicate side effects.",

  appliesTo(world) {
    return world.actors.some((a) => a.kind === "queue");
  },

  configure(world) {
    return {
      primitiveId: "queue.duplicate_delivery",
      dialOverrides: {},
      customParams: { redeliveryDelayMs: 25 },
    };
  },

  generateInterventions(world) {
    return [
      {
        type: "duplicate_request",
        target: "queue",
        timing: "after",
        description:
          "Queue delivers duplicate message due to timeout or network drop.",
        parameters: { duplicateDelivery: true },
      },
      {
        type: "reorder_event",
        target: "queue",
        timing: "during",
        description: "Queue delivers messages out of order.",
        parameters: { outOfOrder: true },
      },
    ];
  },

  execute(sim, intervention, state) {
    const startLog = sim.log.length;
    const corr = (state.corr as string) ?? `queue-${sim.rng.int(1000, 9999)}`;
    const messageId =
      (state.messageId as string) ?? `msg-${sim.rng.int(100, 999)}`;

    const deliverId = sim.emit("queue.deliver", corr, {
      actor: "queue",
      messageId,
      deliveryAttempt: 1,
    });

    sim.at(10, "consumer_process_1", () => {
      sim.emit(
        "consumer.process",
        corr,
        {
          actor: "consumer",
          messageId,
          attempt: 1,
          sideEffectProduced: true,
        },
        deliverId,
      );
    });

    sim.at(25, "queue_redeliver", () => {
      const redeliverId = sim.emit(
        "queue.redeliver",
        corr,
        {
          actor: "queue",
          messageId,
          deliveryAttempt: 2,
          reason: "ack_timeout",
        },
        deliverId,
      );

      sim.at(10, "consumer_process_2", () => {
        sim.emit(
          "consumer.process",
          corr,
          {
            actor: "consumer",
            messageId,
            attempt: 2,
            duplicateSideEffectRisk: true,
          },
          redeliverId,
        );
      });
    });

    while (sim.step()) {}
    return sim.log.slice(startLog);
  },

  getEffects() {
    return [
      {
        type: "duplicate_delivery",
        actor: "queue",
        severity: "medium",
        description: "Same message delivered multiple times by queue",
      },
      {
        type: "duplicate_side_effect",
        actor: "consumer",
        severity: "critical",
        description:
          "Consumer processes duplicate message without idempotency guard",
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

