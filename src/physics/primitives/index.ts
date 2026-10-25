import type { PhysicsRegistry } from "../registry-types.ts";
import { partialCommitPrimitive } from "./partial-commit.ts";
import { eventualConsistencyPrimitive } from "./eventual-consistency.ts";
import { queueDuplicateDeliveryPrimitive } from "./queue-duplicate-delivery.ts";
import { toolPartialSuccessPrimitive } from "./tool-partial-success.ts";
import { workerStateLossPrimitive } from "./worker-state-loss.ts";

export { partialCommitPrimitive } from "./partial-commit.ts";
export { eventualConsistencyPrimitive } from "./eventual-consistency.ts";
export { queueDuplicateDeliveryPrimitive } from "./queue-duplicate-delivery.ts";
export { toolPartialSuccessPrimitive } from "./tool-partial-success.ts";
export { workerStateLossPrimitive } from "./worker-state-loss.ts";

export const NEW_PRIMITIVES = [
  partialCommitPrimitive,
  eventualConsistencyPrimitive,
  queueDuplicateDeliveryPrimitive,
  toolPartialSuccessPrimitive,
  workerStateLossPrimitive,
];

export function registerPrimitives(registry: PhysicsRegistry): void {
  for (const primitive of NEW_PRIMITIVES) {
    registry.register(primitive);
  }
}

