import type {
  PhysicsPrimitive,
  PhysicsConfig,
  PhysicsEffect,
  PhysicsRegistry,
} from "./registry-types.ts";
import type { Intervention } from "../interventions/primitives.ts";
import type { Sim, SimEvent } from "../kernel.ts";
import type { Span } from "../trace.ts";
import { MockPaymentGateway } from "./mock-payment-gateway.ts";
import { MockPgPool } from "./mock-pg-pool.ts";
import { MockProcessSupervisor } from "./mock-process-supervisor.ts";
import { MockToolGateway } from "./mock-tool-gateway.ts";
import { MockLLM } from "./mock-llm.ts";
import { MockStorage } from "./mock-storage.ts";

function defaultToSpans(events: SimEvent[]): Span[] {
  return events.map((e) => ({
    spanId: `s-${e.id}`,
    parentSpanId: e.parent ? `s-${e.parent}` : null,
    name: e.kind,
    startMs: e.t,
    endMs: e.t,
    status: "ok",
    attrs: { ...e.data, corr: e.corr },
    links: [],
    events: [],
  }));
}

export const paymentIdempotencyPrimitive: PhysicsPrimitive = {
  id: "payment.idempotency",
  category: "payment",
  description:
    "Payment gateway with idempotency key support. Can model clean dedup, legacy no-idem, socket drops, rate limits, and poison pills.",

  appliesTo(world) {
    return world.actors.some((a) => a.kind === "payment_service");
  },

  configure(world) {
    return {
      primitiveId: "payment.idempotency",
      dialOverrides: { C: "C5_legacy_erp_no_idem" },
    };
  },

  generateInterventions(world) {
    return [
      {
        type: "missing_idempotency_key",
        target: "payment",
        timing: "before",
        description:
          "A payment request has no idempotency key, so a retry can cause a duplicate charge.",
      },
      {
        type: "drop_response",
        target: "payment",
        timing: "after",
        description:
          "Payment commits but its response is lost, leaving the agent unsure whether the charge succeeded.",
      },
      {
        type: "duplicate_request",
        target: "payment",
        timing: "after",
        description:
          "The agent sends the same request twice; without idempotency, both requests can cause a charge.",
      },
      {
        type: "rate_limit",
        target: "payment",
        timing: "during",
        description:
          "The external API returns 429 responses, potentially triggering repeated retries.",
      },
    ];
  },

  execute(sim, intervention, state) {
    let policy:
      | "clean"
      | "socket_drop"
      | "rate_limit"
      | "poison_pill"
      | "legacy_no_idem" = "legacy_no_idem";
    if (intervention.type === "drop_response") policy = "socket_drop";
    else if (intervention.type === "rate_limit") policy = "rate_limit";
    else if (intervention.type === "missing_idempotency_key")
      policy = "legacy_no_idem";
    else if (intervention.type === "duplicate_request")
      policy = (state.policy as any) ?? "clean";

    const gateway = new MockPaymentGateway({
      idempotencyPolicy: policy,
      seed: (state.seed as number) ?? sim.rng.int(1, 10000),
    });

    const startLog = sim.log.length;
    const key =
      intervention.type === "missing_idempotency_key"
        ? null
        : ((state.key as string) ?? "idem-key-1");
    const amount = (state.amount as number) ?? 50;

    gateway.accept(key, amount, "receipt-1", {
      payload: { amountDollars: amount },
    });
    if (
      intervention.type === "duplicate_request" ||
      intervention.type === "drop_response"
    ) {
      gateway.accept(key, amount, "receipt-2", {
        payload: { amountDollars: amount },
      });
    }
    gateway.emitTraceSpans(sim);
    return sim.log.slice(startLog);
  },

  getEffects() {
    return [
      {
        type: "duplicate_charge",
        actor: "payment",
        severity: "critical",
        description: "Duplicate charge from retry without idempotency key",
      },
      {
        type: "rate_limit",
        actor: "payment",
        severity: "medium",
        description: "429 brownout from rate limiting",
      },
    ];
  },

  toSpans: defaultToSpans,
};

export const dbHoldAndWriteAmpPrimitive: PhysicsPrimitive = {
  id: "db.hold_and_write_amp",
  category: "database",
  description:
    "Database connection pool with connection holding, write amplification, hydration freezing, and in-doubt zombie transactions.",

  appliesTo(world) {
    return world.actors.some((a) => a.kind === "database");
  },

  configure(world) {
    return {
      primitiveId: "db.hold_and_write_amp",
      dialOverrides: { B: "B3_write_amp_15mb" },
    };
  },

  generateInterventions(world) {
    return [
      {
        type: "write_amplification",
        target: "database",
        timing: "during",
        description:
          "Large state writes saturate storage IOPS and increase primary storage usage.",
      },
      {
        type: "stale_read",
        target: "database",
        timing: "during",
        description:
          "The database returns stale data and the agent acts on outdated information.",
      },
    ];
  },

  execute(sim, intervention, state) {
    let holdMode: any = "write_amp_15mb";
    if (intervention.type === "stale_read") holdMode = "hydration_freeze_4s";
    else if (intervention.type === "write_amplification")
      holdMode = "write_amp_15mb";

    const pool = new MockPgPool(10, 100, {
      holdMode,
      writeAmpBytes: (state.writeAmpBytes as number) ?? 15_000_000,
    });
    const startLog = sim.log.length;
    const token = (state.token as string) ?? "token-1";
    pool.acquire(token);
    pool.release(token);
    pool.emitTraceSpans(sim);
    return sim.log.slice(startLog);
  },

  getEffects() {
    return [
      {
        type: "pool_exhaustion",
        actor: "database",
        severity: "high",
        description: "Database connection pool exhausted due to long holds",
      },
      {
        type: "write_amplification",
        actor: "database",
        severity: "medium",
        description: "Large state writes saturate storage IOPS",
      },
      {
        type: "stale_read",
        actor: "database",
        severity: "medium",
        description: "Outdated state read from database",
      },
    ];
  },

  toSpans: defaultToSpans,
};

export const processIsolationPrimitive: PhysicsPrimitive = {
  id: "process.isolation",
  category: "process_supervisor",
  description:
    "Process supervisor controlling tool isolation, prompt injection containment, and worker crash boundaries.",

  appliesTo(world) {
    return world.actors.some((a) => a.kind === "process_supervisor");
  },

  configure(world) {
    return {
      primitiveId: "process.isolation",
      dialOverrides: { E: "E1_god_mode_main_thread" },
    };
  },

  generateInterventions(world) {
    return [
      {
        type: "kill_worker",
        target: "supervisor",
        timing: "during",
        description:
          "A worker crashes and loses in-memory state; the agent must restart and recover.",
      },
      {
        type: "expire_lease",
        target: "supervisor",
        timing: "during",
        description:
          "A tool authority lease expires mid-operation, potentially leaving a later call unauthorized.",
      },
      {
        type: "deny_authority",
        target: "supervisor",
        timing: "before",
        description:
          "A tool call is denied for lack of authority; the agent may retry or skip a safety check.",
      },
    ];
  },

  execute(sim, intervention, state) {
    const startLog = sim.log.length;
    const isolationMode = (state.isolationMode as any) ?? "god_mode_main_thread";
    const supervisor = new MockProcessSupervisor({ isolationMode });

    if (intervention.type === "kill_worker") {
      supervisor.callTool({ sigsegv: true });
    } else if (
      intervention.type === "deny_authority" ||
      intervention.type === "expire_lease"
    ) {
      supervisor.callTool({ injection: true });
    } else {
      supervisor.callTool({});
    }
    supervisor.emitTraceSpans(sim);
    return sim.log.slice(startLog);
  },

  getEffects() {
    return [
      {
        type: "host_crash",
        actor: "supervisor",
        severity: "critical",
        description: "Main host process crashed without worker isolation",
      },
      {
        type: "unauthorized_execution",
        actor: "supervisor",
        severity: "high",
        description: "Tool executed without proper authority lease",
      },
    ];
  },

  toSpans: defaultToSpans,
};

export const toolBatchPrimitive: PhysicsPrimitive = {
  id: "tool.batch",
  category: "tool",
  description:
    "Batch tool execution gateway with poison pill injection, batch unrolling, and item-level error handling.",

  appliesTo(world) {
    return world.actors.some((a) => a.kind === "tool_gateway");
  },

  configure(world) {
    return {
      primitiveId: "tool.batch",
      dialOverrides: { C: "C4_bulk_50_poison_pill" },
    };
  },

  generateInterventions(world) {
    return [
      {
        type: "partial_failure",
        target: "tools",
        timing: "during",
        description:
          "A batch partially fails; some items succeed while others fail, challenging compensation logic.",
      },
    ];
  },

  execute(sim, intervention, state) {
    const startLog = sim.log.length;
    const gateway = new MockToolGateway({
      batchPolicy: "poison_pill",
      poisonIndex: (state.poisonIndex as number) ?? 27,
    });
    gateway.executeBatch(sim, "naive");
    gateway.emitTraceSpans(sim);
    return sim.log.slice(startLog);
  },

  getEffects() {
    return [
      {
        type: "batch_abort",
        actor: "tools",
        severity: "high",
        description:
          "Poison pill causes whole batch abortion, dropping innocent tasks",
      },
      {
        type: "partial_success",
        actor: "tools",
        severity: "medium",
        description: "Subset of batch items failed while others succeeded",
      },
    ];
  },

  toSpans: defaultToSpans,
};

export const llmContextPrimitive: PhysicsPrimitive = {
  id: "llm.context",
  category: "llm",
  description:
    "LLM context window and token dynamics, modeling context bloat, quadratic token growth, and hallucination under load.",

  appliesTo(world) {
    return world.actors.some((a) => a.kind === "llm");
  },

  configure(world) {
    return {
      primitiveId: "llm.context",
      dialOverrides: { D: "D1_raw_json_80k_flood" },
    };
  },

  generateInterventions(world) {
    return [
      {
        type: "context_bloat",
        target: "llm",
        timing: "during",
        description:
          "The prompt grows to 80k tokens, reducing signal-to-noise and increasing hallucination risk.",
      },
    ];
  },

  execute(sim, intervention, state) {
    const startLog = sim.log.length;
    const llm = new MockLLM({
      contextMode: (state.contextMode as any) ?? "raw_json_80k_flood",
    });
    llm.respond(
      (state.prompt as string) ??
        "Perform tasks with deep reasoning and large inputs",
      [],
    );
    llm.emitTraceSpans(sim);
    return sim.log.slice(startLog);
  },

  getEffects() {
    return [
      {
        type: "context_bloat",
        actor: "llm",
        severity: "medium",
        description:
          "Context explosion leading to high token cost and degraded reasoning",
      },
      {
        type: "hallucination",
        actor: "llm",
        severity: "high",
        description: "Hallucinated response or tool call due to context overflow",
      },
    ];
  },

  toSpans: defaultToSpans,
};

export const storageWritePrimitive: PhysicsPrimitive = {
  id: "storage.write",
  category: "storage",
  description:
    "Durable storage write subsystem modeling write amplification, checkpoint holds, and IOPS saturation.",

  appliesTo(world) {
    return world.actors.some((a) => a.kind === "storage");
  },

  configure(world) {
    return {
      primitiveId: "storage.write",
      dialOverrides: { B: "B3_write_amp_15mb" },
    };
  },

  generateInterventions(world) {
    return [
      {
        type: "write_amplification",
        target: "storage",
        timing: "during",
        description:
          "Large state writes saturate storage IOPS and increase primary storage usage.",
      },
    ];
  },

  execute(sim, intervention, state) {
    const startLog = sim.log.length;
    const storage = new MockStorage({
      writeAmpMode: (state.writeAmpMode as any) ?? "write_amp_15mb",
      seed: (state.seed as number) ?? 0,
    });
    storage.writeState(sim, "primary");
    storage.emitTraceSpans(sim);
    return sim.log.slice(startLog);
  },

  getEffects() {
    return [
      {
        type: "write_amplification",
        actor: "storage",
        severity: "medium",
        description:
          "Large state writes saturate IOPS and degrade storage performance",
      },
      {
        type: "storage_exhaustion",
        actor: "storage",
        severity: "high",
        description: "Unbounded state writes consume storage limits",
      },
    ];
  },

  toSpans: defaultToSpans,
};

export const ADAPTER_PRIMITIVES = [
  paymentIdempotencyPrimitive,
  dbHoldAndWriteAmpPrimitive,
  processIsolationPrimitive,
  toolBatchPrimitive,
  llmContextPrimitive,
  storageWritePrimitive,
];

export function registerAdapters(registry: PhysicsRegistry): void {
  for (const primitive of ADAPTER_PRIMITIVES) {
    registry.register(primitive);
  }
}

