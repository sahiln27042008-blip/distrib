// src/world-model/world-state.ts

import type { Actor } from "./actor.ts";
import type { Operation } from "./operation.ts";

export interface WorldState {
  actors: Map<string, Actor>;
  operations: Operation[];
  virtualTimeMs: number;
  // The "ground truth" — what actually happened
  committedOperations: Operation[];
  // Operations that were committed but whose acknowledgment
  // was lost (agent doesn't know they happened)
  lostAcknowledgments: Operation[];
}

export function createWorldState(): WorldState {
  return {
    actors: new Map(),
    operations: [],
    virtualTimeMs: 0,
    committedOperations: [],
    lostAcknowledgments: [],
  };
}

export function addActor(state: WorldState, actor: Actor): void {
  state.actors.set(actor.id, actor);
}

export function getActor(state: WorldState, actorId: string): Actor | undefined {
  return state.actors.get(actorId);
}

export function recordOperation(state: WorldState, op: Operation): void {
  state.operations.push(op);
  if (op.lifecycle === "committed") {
    state.committedOperations.push(op);
  }
}

export function recordLostAcknowledgment(state: WorldState, op: Operation): void {
  state.lostAcknowledgments.push(op);
}

