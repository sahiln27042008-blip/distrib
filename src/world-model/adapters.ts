// src/world-model/adapters.ts

import type { Actor } from "./actor.ts";
import type { Contract } from "./contract.ts";
import {
  PAYMENT_SERVICE_CONTRACT,
  LEGACY_PAYMENT_CONTRACT,
  DATABASE_CONTRACT,
} from "./contract.ts";
import type { MatrixConfig } from "../matrix-copy.ts";
import { createWorldState, addActor, type WorldState } from "./world-state.ts";

// Build a world model from a MatrixConfig. This is the bridge
// between the dial-driven matrix and the actor-based world model.

export function buildWorldModel(config: MatrixConfig): {
  actors: Actor[];
  contracts: Contract[];
} {
  const actors: Actor[] = [];
  const contracts: Contract[] = [];

  // Agent actor
  actors.push({
    id: "agent",
    name: "AI Agent",
    kind: "agent",
    state: "idle",
    contract: {
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
    },
  });

  // Database actor (from Dial B)
  actors.push({
    id: "database",
    name: "Postgres Pool",
    kind: "database",
    state: "healthy",
    contract: DATABASE_CONTRACT,
  });

  // Payment service actor (from Dial C)
  const isLegacy = config.C === "C5_legacy_erp_no_idem";
  actors.push({
    id: "payment",
    name: isLegacy ? "Legacy Payment API" : "Stripe Payment API",
    kind: "payment_service",
    state: "healthy",
    contract: isLegacy ? LEGACY_PAYMENT_CONTRACT : PAYMENT_SERVICE_CONTRACT,
  });

  // Process supervisor (from Dial E)
  actors.push({
    id: "supervisor",
    name: "Process Supervisor",
    kind: "process_supervisor",
    state: "healthy",
    contract: {
      actorKind: "process_supervisor",
      guarantees:
        config.E === "E4_state_leases_ipc_worker"
          ? ["IPC isolation", "State leases with expiry"]
          : ["No isolation guarantees"],
      possibleBehaviors: [
        "Fork worker",
        "Worker crash",
        "Host crash",
        "Worker recovery",
      ],
      failureModes:
        config.E === "E1_god_mode_main_thread"
          ? ["Tool SIGSEGV crashes host"]
          : ["Tool SIGSEGV crashes worker (contained)"],
    },
  });

  // Tool gateway (from Dial C)
  actors.push({
    id: "tools",
    name: "Batch Tool Gateway",
    kind: "tool_gateway",
    state: "healthy",
    contract: {
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
    },
  });

  // LLM actor (from Dial D)
  actors.push({
    id: "llm",
    name: "LLM",
    kind: "llm",
    state: "healthy",
    contract: {
      actorKind: "llm",
      guarantees: ["Deterministic response for same seed+input"],
      possibleBehaviors: ["Respond to prompt", "Make tool calls"],
      failureModes: [
        "Context bloat",
        "Hallucination",
        "Schema drift",
      ],
    },
  });

  // Storage actor (from Dial B)
  actors.push({
    id: "storage",
    name: "Storage",
    kind: "storage",
    state: "healthy",
    contract: {
      actorKind: "storage",
      guarantees: [
        "Checkpoint persistence",
        "State write with payload tracking",
      ],
      possibleBehaviors: ["Write checkpoint", "Write state", "Compact"],
      failureModes: ["Write amplification", "Frozen queries"],
    },
  });

  contracts.push(...actors.map((a) => a.contract));

  return { actors, contracts };
}

export function buildWorldState(config: MatrixConfig): WorldState {
  const { actors } = buildWorldModel(config);
  const state = createWorldState();
  for (const actor of actors) {
    addActor(state, actor);
  }
  return state;
}

