// src/world-model/actor.ts
import type { Contract } from "./contract.ts";

export type ActorKind =
  | "agent"
  | "worker"
  | "database"
  | "payment_service"
  | "external_api"
  | "queue"
  | "storage"
  | "llm"
  | "human"
  | "process_supervisor"
  | "tool_gateway";

export type ActorState =
  | "idle"
  | "healthy"
  | "busy"
  | "crashed"
  | "failed"
  | "recovering"
  | "unknown";

export interface Actor {
  id: string; // unique within the world model
  name: string; // human-readable (e.g. "Stripe Payment Gateway")
  kind: ActorKind;
  state: ActorState;
  contract: Contract; // what this actor guarantees
}

