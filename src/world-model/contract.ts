// src/world-model/contract.ts

import type { ActorKind } from "./actor.ts";

export interface Contract {
  actorKind: ActorKind;
  guarantees: string[]; // human-readable guarantees
  possibleBehaviors: string[]; // what this actor CAN do
  failureModes: string[]; // how this actor CAN fail
}

// Predefined contracts for known actor types
export const PAYMENT_SERVICE_CONTRACT: Contract = {
  actorKind: "payment_service",
  guarantees: [
    "Accepts idempotency key for deduplication",
    "Exposes transaction status",
    "Charges are atomic (commit or fail, no partial)",
  ],
  possibleBehaviors: [
    "Request accepted",
    "Request committed",
    "Response delayed",
    "Response lost",
    "Timeout",
    "Retry arrives later",
    "Duplicate request without key → duplicate side effect",
  ],
  failureModes: [
    "Network drop after commit",
    "Timeout with ambiguous state",
    "Duplicate charge without idempotency key",
  ],
};

export const LEGACY_PAYMENT_CONTRACT: Contract = {
  actorKind: "payment_service",
  guarantees: [
    "No idempotency guarantees",
    "No transaction status endpoint",
  ],
  possibleBehaviors: [
    "Request accepted",
    "Request committed",
    "Response delayed",
    "Response lost",
    "Timeout",
    "Duplicate request → duplicate side effect (always)",
  ],
  failureModes: [
    "Network drop after commit",
    "Timeout with ambiguous state",
    "Duplicate charge on retry (always, no dedup)",
  ],
};

export const DATABASE_CONTRACT: Contract = {
  actorKind: "database",
  guarantees: [
    "Bounded connection pool",
    "ACID transactions (within pool)",
    "Connection hold time is measurable",
  ],
  possibleBehaviors: [
    "Connection acquired",
    "Connection held (streaming)",
    "Connection released",
    "Pool exhausted → wait queue",
    "Wait queue full → timeout",
  ],
  failureModes: [
    "Pool starvation under streaming holds",
    "Wait queue overflow",
    "Connection leak (never released)",
  ],
};

export const PROCESS_SUPERVISOR_CONTRACT: Contract = {
  actorKind: "process_supervisor",
  guarantees: ["Process lifecycle supervision"],
  possibleBehaviors: [
    "Fork worker",
    "Worker crash",
    "Host crash",
    "Worker recovery",
  ],
  failureModes: [
    "Tool SIGSEGV crashes host",
    "Tool SIGSEGV crashes worker (contained)",
  ],
};

export const TOOL_GATEWAY_CONTRACT: Contract = {
  actorKind: "tool_gateway",
  guarantees: ["Batch execution with item-level results"],
  possibleBehaviors: [
    "Execute item",
    "Execute batch",
    "Poison item N",
    "Abort batch",
  ],
  failureModes: [
    "Poison pill",
    "Batch abort",
    "Innocent task abort",
  ],
};

export const LLM_CONTRACT: Contract = {
  actorKind: "llm",
  guarantees: ["Deterministic response for same seed+input"],
  possibleBehaviors: [
    "Respond to prompt",
    "Make tool calls",
  ],
  failureModes: [
    "Context bloat",
    "Hallucination",
    "Schema drift",
  ],
};

export const STORAGE_CONTRACT: Contract = {
  actorKind: "storage",
  guarantees: [
    "Checkpoint persistence",
    "State write with payload tracking",
  ],
  possibleBehaviors: [
    "Write checkpoint",
    "Write state",
    "Compact",
  ],
  failureModes: [
    "Write amplification",
    "Frozen queries",
  ],
};

export const AGENT_CONTRACT: Contract = {
  actorKind: "agent",
  guarantees: ["Follows workflow steps", "Calls tools via MCP"],
  possibleBehaviors: [
    "Execute step",
    "Retry on failure",
    "Recover after restart",
  ],
  failureModes: [
    "Loses in-memory state on restart",
    "Retries without idempotency key",
    "Hallucinates operation success",
  ],
};

export const WORKER_CONTRACT: Contract = {
  actorKind: "worker",
  guarantees: ["Executes designated tasks", "Reports execution status"],
  possibleBehaviors: [
    "Execute subtask",
    "Crash on unhandled exception",
    "Report failure to supervisor",
  ],
  failureModes: [
    "Unhandled exception / SIGSEGV",
    "Process crash losing volatile memory",
    "Zombie execution",
  ],
};

