import type { PhysicsPrimitive, PhysicsConfig, PhysicsEffect } from "../registry-types.ts";
import type { Intervention } from "../../interventions/primitives.ts";
import type { Sim, SimEvent } from "../../kernel.ts";
import type { Span } from "../../trace.ts";

export const toolPartialSuccessPrimitive: PhysicsPrimitive = {
  id: "tool.partial_success",
  category: "tool",
  description:
    "Models a tool call that partially succeeds — some items succeed, some fail. The agent may not handle partial success correctly, leading to inconsistent state.",

  appliesTo(world) {
    return world.actors.some(
      (a) => a.kind === "tool_gateway" || a.kind === "external_api",
    );
  },

  configure(world) {
    return {
      primitiveId: "tool.partial_success",
      dialOverrides: {
        C: "C4_bulk_50_poison_pill",
      },
      customParams: { totalItems: 5, succeededItems: 3, failedItems: 2 },
    };
  },

  generateInterventions(world) {
    return [
      {
        type: "partial_failure",
        target: "tools",
        timing: "during",
        description:
          "Batch tool call partially succeeds with subset of items failing.",
        parameters: { partialSuccess: true },
      },
    ];
  },

  execute(sim, intervention, state) {
    const startLog = sim.log.length;
    const corr = (state.corr as string) ?? `tool-${sim.rng.int(1000, 9999)}`;
    const total = (state.totalItems as number) ?? 5;
    const succeeded = (state.succeededItems as number) ?? 3;
    const failed = total - succeeded;

    const psId = sim.emit("tool.partial_success", corr, {
      actor: "tool_gateway",
      totalItems: total,
      succeededItems: succeeded,
      failedItems: failed,
      failedIndices: [3, 4],
    });

    sim.at(15, "inconsistent_state", () => {
      sim.emit(
        "tool.inconsistent_state",
        corr,
        {
          actor: "agent",
          parentEvent: psId,
          unknownItems: [3, 4],
          status: "partial_recovery_needed",
        },
        psId,
      );
    });

    while (sim.step()) {}
    return sim.log.slice(startLog);
  },

  getEffects() {
    return [
      {
        type: "partial_success",
        actor: "tool_gateway",
        severity: "medium",
        description: "Tool call returned partial success with unhandled errors",
      },
      {
        type: "inconsistent_state",
        actor: "agent",
        severity: "high",
        description: "Agent unable to reconcile partial tool execution result",
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

