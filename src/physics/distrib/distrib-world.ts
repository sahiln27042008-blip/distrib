// enterpriseee/enterprise-simulator/src/physics/distrib/distrib-world.ts

import { Cell } from "../alphabet/vowels/cell.ts";
import { Lease } from "../alphabet/vowels/lease.ts";
import { Log } from "../alphabet/vowels/log.ts";
import { Channel } from "../alphabet/vowels/channel.ts";
import type {
  Actor,
  CompiledAlphabetGraph,
  Vowel,
} from "../alphabet/types.ts";

export interface DistribWorldOptions {
  // Ablations or configuration toggles
  paymentIdempotencyEnforced?: boolean;
  fencingTokenEnforced?: boolean;
  pgPoolCapacity?: number;
  workerPoolCapacity?: number;
  lockTtlMs?: number;
  enableVolatileCacheWipe?: boolean;
  cancellationDelayMs?: number;
}

export function buildAdversarialAgentWorld(
  options: DistribWorldOptions = {},
): CompiledAlphabetGraph {
  const {
    paymentIdempotencyEnforced = false, // default: legacy/un-enforced payment to detect duplicate charge vulnerabilities
    fencingTokenEnforced = true,
    pgPoolCapacity = 3,
    workerPoolCapacity = 2,
    lockTtlMs = 30000,
  } = options;

  // 15 Interconnected Actors
  const actors: Actor[] = [
    { id: "actor-ingress", name: "User / API Ingress Gateway" },
    { id: "actor-orchestrator", name: "Agent Orchestrator & Task Scheduler" },
    { id: "actor-llm-gateway", name: "LLM Provider Gateway" },
    { id: "actor-tool-router", name: "MCP Tool Router" },
    { id: "actor-tool-worker", name: "Tool Execution Worker Pool" },
    { id: "actor-postgres", name: "PostgreSQL State & Idempotency Store" },
    { id: "actor-event-bus", name: "Event Log & Async Queue" },
    { id: "actor-redis", name: "Redis Lease, Lock & Cache Layer" },
    { id: "actor-payment-gateway", name: "External Payment & Transaction Gateway" },
    { id: "actor-kyc-service", name: "External KYC / Validation Service" },
    { id: "actor-artifact-store", name: "Artifact & Checkpoint Store" },
    { id: "actor-notifier", name: "Result Delivery & Notification Service" },
    { id: "actor-recovery-worker", name: "Retry & Recovery Worker" },
    { id: "actor-supervisor", name: "Cancellation & Process Supervisor" },
    { id: "actor-observability", name: "Observability & Audit Event Hub" },
  ];

  // 1. Ingress Substrate
  const admissionLease = new Lease({
    id: "lease-admission",
    actorId: "actor-ingress",
    maxCapacity: 10,
    ttlMs: 5000,
    overflowPolicy: "REJECT_429",
  });
  const ingressChannel = new Channel({
    id: "chan-ingress",
    sourceActorId: "actor-ingress",
    targetActorId: "actor-orchestrator",
    timeoutMs: 5000,
  });

  // 2. Orchestrator Task Queue
  const taskQueueLog = new Log({
    id: "log-task-queue",
    actorId: "actor-orchestrator",
    maxCapacity: 50,
    compactionLagMs: 200,
    deduplicateOnCompact: true,
  });

  // 3. LLM Gateway
  const llmChannel = new Channel({
    id: "chan-llm-gateway",
    sourceActorId: "actor-orchestrator",
    targetActorId: "actor-llm-gateway",
    timeoutMs: 3000,
  });
  const llmRateLimitLease = new Lease({
    id: "lease-llm-rate-limit",
    actorId: "actor-llm-gateway",
    maxCapacity: 5,
    ttlMs: 1000,
    overflowPolicy: "REJECT_429",
  });

  // 4. Tool Router
  const toolRouterChannel = new Channel({
    id: "chan-tool-router",
    sourceActorId: "actor-orchestrator",
    targetActorId: "actor-tool-router",
    timeoutMs: 4000,
  });

  // 5. Tool Workers (bounded concurrency, holds DB connection)
  const workerPoolLease = new Lease({
    id: "lease-worker-pool",
    actorId: "actor-tool-worker",
    maxCapacity: workerPoolCapacity,
    ttlMs: 4000,
    heldDuringExternalChannel: true,
    overflowPolicy: "WAIT_TIMEOUT",
  });

  // 6. PostgreSQL Storage (shared pool, task state, idempotency table)
  const pgPoolLease = new Lease({
    id: "lease-pg-pool",
    actorId: "actor-postgres",
    maxCapacity: pgPoolCapacity,
    ttlMs: 5000,
    heldDuringExternalChannel: true,
    overflowPolicy: "WAIT_TIMEOUT",
  });
  const taskStateCell = new Cell({
    id: "cell-task-state",
    actorId: "actor-postgres",
    persistence: "DURABLE",
    idempotencyEnforced: true,
    fencingTokenEnforced: fencingTokenEnforced,
    initialState: { status: "pending", version: 0, stepsCompleted: 0 },
  });
  const pgIdempotencyCell = new Cell({
    id: "cell-pg-idempotency",
    actorId: "actor-postgres",
    persistence: "DURABLE",
    idempotencyEnforced: true,
    fencingTokenEnforced: false,
    initialState: { records: {} },
  });

  // 7. Event Log & Async Queue
  const asyncEventLog = new Log({
    id: "log-async-events",
    actorId: "actor-event-bus",
    maxCapacity: 200,
    compactionLagMs: 500,
    deduplicateOnCompact: true,
  });

  // 8. Redis Distributed Lock & Cache Layer
  const distributedLockLease = new Lease({
    id: "lease-redis-lock",
    actorId: "actor-redis",
    maxCapacity: 1,
    ttlMs: lockTtlMs,
    overflowPolicy: "REJECT_429",
  });
  const redisCacheCell = new Cell({
    id: "cell-redis-cache",
    actorId: "actor-redis",
    persistence: "VOLATILE", // volatile! subject to WIPE
    idempotencyEnforced: true,
    fencingTokenEnforced: false,
    initialState: { cachedKeys: {} },
  });

  // 9. Payment Gateway
  const paymentChannel = new Channel({
    id: "chan-payment",
    sourceActorId: "actor-orchestrator",
    targetActorId: "actor-payment-gateway",
    timeoutMs: 8000,
  });
  const paymentLedgerCell = new Cell({
    id: "cell-payment-ledger",
    actorId: "actor-payment-gateway",
    persistence: "DURABLE",
    idempotencyEnforced: paymentIdempotencyEnforced,
    fencingTokenEnforced: false,
    initialState: { totalCharged: 0, transactions: [] },
  });

  // 10. External KYC Service
  const kycChannel = new Channel({
    id: "chan-kyc",
    sourceActorId: "actor-orchestrator",
    targetActorId: "actor-kyc-service",
    timeoutMs: 5000,
  });

  // 11. Artifact & Checkpoint Storage
  const checkpointCell = new Cell({
    id: "cell-checkpoint",
    actorId: "actor-artifact-store",
    persistence: "DURABLE",
    idempotencyEnforced: true,
    fencingTokenEnforced: fencingTokenEnforced,
    initialState: { checkpointId: "cp-0", committedStep: "none", snapshotEpoch: 0 },
  });
  const artifactStorageCell = new Cell({
    id: "cell-artifacts",
    actorId: "actor-artifact-store",
    persistence: "DURABLE",
    idempotencyEnforced: true,
    fencingTokenEnforced: false,
    initialState: { artifacts: [] },
  });

  // 12. Delivery & Notification
  const deliveryChannel = new Channel({
    id: "chan-delivery",
    sourceActorId: "actor-orchestrator",
    targetActorId: "actor-notifier",
    timeoutMs: 5000,
  });
  const deliveredResultCell = new Cell({
    id: "cell-delivered-result",
    actorId: "actor-notifier",
    persistence: "DURABLE",
    idempotencyEnforced: true,
    fencingTokenEnforced: false,
    initialState: { deliveries: [] },
  });

  // 13. Retry / Recovery Worker
  const recoveryChannel = new Channel({
    id: "chan-recovery",
    sourceActorId: "actor-recovery-worker",
    targetActorId: "actor-orchestrator",
    timeoutMs: 5000,
  });

  // 14. Process Supervision & Cancellation
  const cancellationCell = new Cell({
    id: "cell-cancellation",
    actorId: "actor-supervisor",
    persistence: "VOLATILE",
    idempotencyEnforced: true,
    fencingTokenEnforced: false,
    initialState: { cancelled: false, cancelledAt: null },
  });
  const supervisorLease = new Lease({
    id: "lease-supervisor",
    actorId: "actor-supervisor",
    maxCapacity: 1,
    ttlMs: 10000,
    overflowPolicy: "PANIC_CRASH",
  });

  // 15. Observability
  const auditTraceLog = new Log({
    id: "log-audit-trace",
    actorId: "actor-observability",
    maxCapacity: 1000,
    compactionLagMs: 0,
    deduplicateOnCompact: false,
  });

  const vowels: Vowel[] = [
    admissionLease,
    ingressChannel,
    taskQueueLog,
    llmChannel,
    llmRateLimitLease,
    toolRouterChannel,
    workerPoolLease,
    pgPoolLease,
    taskStateCell,
    pgIdempotencyCell,
    asyncEventLog,
    distributedLockLease,
    redisCacheCell,
    paymentChannel,
    paymentLedgerCell,
    kycChannel,
    checkpointCell,
    artifactStorageCell,
    deliveryChannel,
    deliveredResultCell,
    recoveryChannel,
    cancellationCell,
    supervisorLease,
    auditTraceLog,
  ];

  const channels: Channel[] = [
    ingressChannel,
    llmChannel,
    toolRouterChannel,
    paymentChannel,
    kycChannel,
    deliveryChannel,
    recoveryChannel,
  ];

  return {
    actors,
    vowels,
    channels,
    contracts: [],
    candidatePerturbations: [],
    epistemicStatus: ["OBSERVED"],
    unrepresentableSemantics: [],
  };
}
