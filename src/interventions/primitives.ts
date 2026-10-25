export type InterventionType =
  | "drop_response"
  | "delay_response"
  | "duplicate_request"
  | "reorder_event"
  | "kill_worker"
  | "lose_state"
  | "stale_read"
  | "expire_lease"
  | "deny_authority"
  | "change_external_state"
  | "rate_limit"
  | "timeout"
  | "partial_failure"
  | "missing_idempotency_key"
  | "context_bloat"
  | "write_amplification";

export interface Intervention {
  type: InterventionType;
  target: string;
  timing?: "before" | "during" | "after";
  parameters?: Record<string, unknown>;
  description: string;
}

export const INTERVENTIONS: Record<InterventionType, Intervention> = {
  drop_response: {
    type: "drop_response",
    target: "payment",
    timing: "after",
    description: "Payment commits but its response is lost, leaving the agent unsure whether the charge succeeded.",
  },
  delay_response: {
    type: "delay_response",
    target: "payment",
    timing: "after",
    parameters: { delayMs: 30000 },
    description: "The response is delayed beyond the timeout, so the agent may retry.",
  },
  duplicate_request: {
    type: "duplicate_request",
    target: "payment",
    timing: "after",
    description: "The agent sends the same request twice; without idempotency, both requests can cause a charge.",
  },
  reorder_event: {
    type: "reorder_event",
    target: "queue",
    timing: "during",
    description: "Events arrive out of order, potentially disrupting saga compensation order.",
  },
  kill_worker: {
    type: "kill_worker",
    target: "supervisor",
    timing: "during",
    description: "A worker crashes and loses in-memory state; the agent must restart and recover.",
  },
  lose_state: {
    type: "lose_state",
    target: "agent",
    timing: "after",
    description: "The agent loses in-memory state without a checkpoint, so recovery may replay operations.",
  },
  stale_read: {
    type: "stale_read",
    target: "database",
    timing: "during",
    description: "The database returns stale data and the agent acts on outdated information.",
  },
  expire_lease: {
    type: "expire_lease",
    target: "supervisor",
    timing: "during",
    description: "A tool authority lease expires mid-operation, potentially leaving a later call unauthorized.",
  },
  deny_authority: {
    type: "deny_authority",
    target: "supervisor",
    timing: "before",
    description: "A tool call is denied for lack of authority; the agent may retry or skip a safety check.",
  },
  change_external_state: {
    type: "change_external_state",
    target: "payment",
    timing: "before",
    description: "External state changes between the agent's check and action, creating a TOCTOU condition.",
  },
  rate_limit: {
    type: "rate_limit",
    target: "payment",
    timing: "during",
    description: "The external API returns 429 responses, potentially triggering repeated retries.",
  },
  timeout: {
    type: "timeout",
    target: "payment",
    timing: "during",
    parameters: { timeoutMs: 5000 },
    description: "The request times out, leaving the agent unsure whether the side effect committed.",
  },
  partial_failure: {
    type: "partial_failure",
    target: "tools",
    timing: "during",
    description: "A batch partially fails; some items succeed while others fail, challenging compensation logic.",
  },
  missing_idempotency_key: {
    type: "missing_idempotency_key",
    target: "payment",
    timing: "before",
    description: "A payment request has no idempotency key, so a retry can cause a duplicate charge.",
  },
  context_bloat: {
    type: "context_bloat",
    target: "llm",
    timing: "during",
    description: "The prompt grows to 80k tokens, reducing signal-to-noise and increasing hallucination risk.",
  },
  write_amplification: {
    type: "write_amplification",
    target: "storage",
    timing: "during",
    description: "Large state writes saturate storage IOPS and increase primary storage usage.",
  },
};