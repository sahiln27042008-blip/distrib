// src/world-model/operation.ts

export type OperationKind =
  | "read"
  | "write"
  | "charge"
  | "refund"
  | "reserve"
  | "release"
  | "send"
  | "create"
  | "delete"
  | "approve"
  | "respond"
  | "retry"
  | "checkpoint"
  | "compensate";

export type OperationLifecycle =
  | "requested"
  | "accepted"
  | "executing"
  | "committed"
  | "acknowledged"
  | "failed"
  | "unknown";

export interface Operation {
  id: string;
  actorId: string; // which actor performs this
  kind: OperationKind;
  lifecycle: OperationLifecycle;
  input?: unknown; // operation parameters
  output?: unknown; // result if committed
  error?: string; // if failed
  timestamp: number; // virtual ms
  parentOperationId?: string; // causal parent
  sideEffect?: boolean; // does this mutate external state?
  idempotencyKey?: string | null; // if applicable
  bodyHash?: string; // for side-effect dedup
  retryOf?: string; // if this is a retry of another op
  retryCount?: number;
}

// The distinction between "committed" and "acknowledged" is
// CRITICAL. A payment can be committed by Stripe but the agent
// might not have received the acknowledgment (response lost).
// This is the core mechanism behind duplicate charges.

export function transitionOperation(
  op: Operation,
  nextLifecycle: OperationLifecycle,
  updates?: Partial<Omit<Operation, "lifecycle">>
): Operation {
  return {
    ...op,
    ...updates,
    lifecycle: nextLifecycle,
  };
}

