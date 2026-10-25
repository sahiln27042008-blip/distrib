// src/world-model/belief-state.ts

import type { Operation } from "./operation.ts";

// The agent's BELIEF about what happened. This may differ from
// the WorldState when responses are lost, retries happen, or
// state is reconstructed from partial information.

export interface BeliefState {
  // What the agent THINKS happened
  believedOperations: Map<string, Operation>;
  // Operations the agent is UNSURE about (response lost,
  // timeout, ambiguous state)
  uncertainOperations: Set<string>;
  // Operations the agent believes succeeded but actually
  // didn't (or vice versa)
  hallucinatedOperations: Operation[];
}

export function createBeliefState(): BeliefState {
  return {
    believedOperations: new Map(),
    uncertainOperations: new Set(),
    hallucinatedOperations: [],
  };
}

export function recordBelievedOperation(belief: BeliefState, op: Operation): void {
  belief.believedOperations.set(op.id, op);
}

export function recordUncertainOperation(belief: BeliefState, opId: string): void {
  belief.uncertainOperations.add(opId);
}

export function recordHallucinatedOperation(belief: BeliefState, op: Operation): void {
  belief.hallucinatedOperations.push(op);
}

// The key insight: when the world says "committed" but the
// agent's belief says "unknown", the agent may retry — causing
// a duplicate side effect. This divergence is the root cause
// of most reliability failures.
export function getDivergence(world: { committedOperations: Operation[] }, belief: BeliefState): Operation[] {
  // Returns operations that are committed in the world but
  // not believed by the agent (response was lost)
  return world.committedOperations.filter(
    (op) =>
      !belief.believedOperations.has(op.id) &&
      !belief.uncertainOperations.has(op.id)
  );
}

