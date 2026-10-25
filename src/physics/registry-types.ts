import type { MatrixConfig } from "../matrix-copy.ts";
import type { Intervention } from "../interventions/primitives.ts";
import type { Trace, Span } from "../trace.ts";
import type { Sim, SimEvent } from "../kernel.ts";

// A PhysicsPrimitive is a composable physical mechanism that can
// be selected by the AI scientist based on the customer's
// architecture. Each primitive knows:
// - Which architectures it applies to
// - How to configure the simulator
// - What interventions it can generate
// - How to execute through the existing kernel
// - What trace spans it emits
// - What effects it produces

export interface PhysicsPrimitive {
  id: string; // "transaction.partial_commit"
  category: string; // "transaction", "consistency", "queue", "tool", "worker", "payment", "database", "supervisor", "llm", "storage"
  description: string;

  // Does this primitive apply to the given world model?
  appliesTo(world: {
    actors: Array<{
      kind: string;
      name: string;
      contract?: { guarantees: string[] };
    }>;
  }): boolean;

  // Configure the simulator for this primitive
  configure(world: { actors: Array<{ kind: string }> }): PhysicsConfig;

  // Generate interventions that this primitive can inject
  generateInterventions(world: {
    actors: Array<{ kind: string }>;
  }): Intervention[];

  // Execute through the existing kernel (returns events for trace)
  execute(
    sim: Sim,
    intervention: Intervention,
    state: Record<string, unknown>,
  ): SimEvent[];

  // What effects does this primitive produce?
  getEffects(): PhysicsEffect[];

  // What trace spans it emits from events
  toSpans?(events: SimEvent[]): Span[];
}

export interface PhysicsConfig {
  primitiveId: string;
  dialOverrides?: Partial<MatrixConfig>; // which dials to change
  customParams?: Record<string, unknown>;
}

export interface PhysicsEffect {
  type: string; // "duplicate_charge", "stale_read", "state_loss", etc.
  actor: string; // which actor is affected
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}

export interface PhysicsRegistry {
  register(primitive: PhysicsPrimitive): void;
  get(id: string): PhysicsPrimitive | undefined;
  list(): PhysicsPrimitive[];
  findApplicable(world: {
    actors: Array<{
      kind: string;
      name: string;
      contract?: { guarantees: string[] };
    }>;
  }): PhysicsPrimitive[];
}

