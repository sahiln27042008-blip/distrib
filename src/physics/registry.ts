import type { PhysicsPrimitive, PhysicsRegistry } from "./registry-types.ts";
import { registerAdapters } from "./registry-adapters.ts";
import { registerPrimitives } from "./primitives/index.ts";

export function createPhysicsRegistry(): PhysicsRegistry {
  const primitives = new Map<string, PhysicsPrimitive>();

  return {
    register(primitive: PhysicsPrimitive): void {
      if (primitives.has(primitive.id)) {
        throw new Error(
          `Physics primitive ${primitive.id} already registered`,
        );
      }
      primitives.set(primitive.id, primitive);
    },

    get(id: string): PhysicsPrimitive | undefined {
      return primitives.get(id);
    },

    list(): PhysicsPrimitive[] {
      return Array.from(primitives.values());
    },

    findApplicable(world: {
      actors: Array<{
        kind: string;
        name: string;
        contract?: { guarantees: string[] };
      }>;
    }): PhysicsPrimitive[] {
      return Array.from(primitives.values()).filter((p) => p.appliesTo(world));
    },
  };
}

// Singleton registry for global access
let globalRegistry: PhysicsRegistry | null = null;

export function getGlobalRegistry(): PhysicsRegistry {
  if (!globalRegistry) {
    globalRegistry = createPhysicsRegistry();
    registerDefaults(globalRegistry);
  }
  return globalRegistry;
}

export function registerDefaults(reg: PhysicsRegistry): void {
  // Register 6 adapters for existing physics
  registerAdapters(reg);
  // Register 5 new primitives
  registerPrimitives(reg);
}

