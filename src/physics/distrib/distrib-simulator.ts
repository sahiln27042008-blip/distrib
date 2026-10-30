// enterpriseee/enterprise-simulator/src/physics/distrib/distrib-simulator.ts

import { Sim } from "../../kernel.ts";
import { Cell } from "../alphabet/vowels/cell.ts";
import { Lease } from "../alphabet/vowels/lease.ts";
import { Log } from "../alphabet/vowels/log.ts";
import { Channel } from "../alphabet/vowels/channel.ts";
import type { Consonant, CompiledAlphabetGraph, Vowel } from "../alphabet/types.ts";
import { applyConsonant } from "../alphabet/apply.ts";
import type {
  DistribConsonantFault,
  DistribExecutionResult,
} from "./distrib-types.ts";
import { evaluateDistribInvariants } from "./distrib-invariants.ts";
import { convertAlphabetEventsToLangChainJsonl, resolveAuditor } from "../search/execute-faults.ts";

export async function executeDistribWorkflow(
  graph: CompiledAlphabetGraph,
  faults: DistribConsonantFault[],
  seed = 42,
): Promise<DistribExecutionResult> {
  const sim = new Sim(seed);

  const cellMap = new Map<string, Cell>();
  const leaseMap = new Map<string, Lease>();
  const logMap = new Map<string, Log>();
  const channelMap = new Map<string, Channel>();
  const vowelMap = new Map<string, Vowel>();

  // 1. Re-instantiate fresh vowels on this simulation clock
  for (const v of graph.vowels) {
    if (v.kind === "CELL") {
      const c = v as Cell;
      const cell = new Cell({
        id: c.id,
        actorId: c.actorId,
        persistence: c.persistence,
        idempotencyEnforced: c.idempotencyEnforced,
        fencingTokenEnforced: c.fencingTokenEnforced,
        initialState: structuredClone(c.state),
        sim,
      });
      cellMap.set(cell.id, cell);
      vowelMap.set(cell.id, cell);
    } else if (v.kind === "LEASE") {
      const l = v as Lease;
      const lease = new Lease({
        id: l.id,
        actorId: l.actorId,
        maxCapacity: l.maxCapacity,
        ttlMs: l.ttlMs,
        overflowPolicy: l.overflowPolicy,
        heldDuringExternalChannel: l.heldDuringExternalChannel,
        sim,
      });
      leaseMap.set(lease.id, lease);
      vowelMap.set(lease.id, lease);
    } else if (v.kind === "LOG") {
      const l = v as Log;
      const log = new Log({
        id: l.id,
        actorId: l.actorId,
        maxCapacity: l.maxCapacity,
        compactionLagMs: l.compactionLagMs,
        deduplicateOnCompact: l.deduplicateOnCompact,
        seed,
        sim,
      });
      logMap.set(log.id, log);
      vowelMap.set(log.id, log);
    } else if (v.kind === "CHANNEL") {
      const ch = v as Channel;
      const channel = new Channel({
        id: ch.id,
        sourceActorId: ch.sourceActorId,
        targetActorId: ch.targetActorId,
        timeoutMs: ch.timeoutMs,
        retryPolicy: ch.retryPolicy,
        sim,
      });
      channelMap.set(channel.id, channel);
      vowelMap.set(channel.id, channel);
    }
  }

  // 2. Separate faults by stage: pre-execution faults vs channel faults
  const nonChannelFaults = faults.filter((f) => {
    const v = vowelMap.get(f.targetVowelId);
    return v && v.kind !== "CHANNEL";
  });
  const channelFaults = faults.filter((f) => {
    const v = vowelMap.get(f.targetVowelId);
    return !v || v.kind === "CHANNEL";
  });

  // Apply pre-channel faults
  for (const fault of nonChannelFaults) {
    const target = vowelMap.get(fault.targetVowelId);
    if (target) {
      const consonant: Consonant = {
        kind: fault.consonantKind,
        ...(fault.params as any),
      };
      applyConsonant(sim, target, consonant, fault.params, sim.rng);
    }
  }

  // 3. Execute Interconnected 15-Component Causal Workflow

  // Step 1: User / API Ingress Admission
  const admissionLease = leaseMap.get("lease-admission");
  const ingressChannel = channelMap.get("chan-ingress");
  if (admissionLease) {
    admissionLease.acquire("actor-ingress", sim.now, sim);
  }
  sim.emit("workflow.admission", "root", { admissionStatus: "admitted" });

  // Step 2: Task Queue Ingestion
  const taskQueueLog = logMap.get("log-task-queue");
  taskQueueLog?.append({ taskId: "task-100", taskType: "enterprise_agent_settlement", priority: "high" }, "dedup-task-100", sim);

  // Step 3: Shared Database Pool Acquisition & Task State Initialization
  const pgPool = leaseMap.get("lease-pg-pool");
  const taskStateCell = cellMap.get("cell-task-state");
  pgPool?.acquire("actor-orchestrator", sim.now, sim);
  taskStateCell?.mutate({ status: "processing", version: 1, stepsCompleted: 1 }, { sim });

  // Step 4: Redis Distributed Lock & Idempotency Key Initialization
  const redisLock = leaseMap.get("lease-redis-lock");
  const redisCacheCell = cellMap.get("cell-redis-cache");
  const pgIdempotencyCell = cellMap.get("cell-pg-idempotency");

  redisLock?.acquire("actor-orchestrator", sim.now, sim);
  const currentLockEpoch = redisLock?.currentEpoch ?? 0;

  // Cache idempotency key in Redis volatile cache
  redisCacheCell?.mutate({ cachedKeys: { "task-100": { key: "idem-task-100", epoch: currentLockEpoch } } }, { sim });
  pgIdempotencyCell?.mutate({ records: { "task-100": { key: "idem-task-100" } } }, { sim });

  // Step 5: LLM Gateway Invocation
  const llmChannel = channelMap.get("chan-llm-gateway");
  const llmRateLimit = leaseMap.get("lease-llm-rate-limit");
  llmRateLimit?.acquire("actor-orchestrator", sim.now, sim);
  if (llmChannel) {
    const llmFaults = channelFaults.filter((f) => f.targetVowelId === llmChannel.id);
    if (llmFaults.length > 0) {
      for (const fault of llmFaults) {
        applyConsonant(sim, llmChannel, { kind: fault.consonantKind, ...(fault.params as any) }, fault.params, sim.rng);
      }
    } else {
      llmChannel.send(sim, { prompt: "Analyze customer settlement", model: "claude-3-opus" });
    }
  }
  llmRateLimit?.release("actor-orchestrator", sim.now, sim);

  // Step 6: Tool Worker Execution (Bounded Pool)
  const workerPool = leaseMap.get("lease-worker-pool");
  const toolRouterChannel = channelMap.get("chan-tool-router");
  workerPool?.acquire("actor-orchestrator", sim.now, sim);
  if (toolRouterChannel) {
    const toolFaults = channelFaults.filter((f) => f.targetVowelId === toolRouterChannel.id);
    if (toolFaults.length > 0) {
      for (const fault of toolFaults) {
        applyConsonant(sim, toolRouterChannel, { kind: fault.consonantKind, ...(fault.params as any) }, fault.params, sim.rng);
      }
    } else {
      toolRouterChannel.send(sim, { tool: "fetch_kyc_and_contract", taskId: "task-100" });
    }
  }

  // Step 7: External Payment Gateway (Critical Path)
  const paymentChannel = channelMap.get("chan-payment");
  const paymentLedger = cellMap.get("cell-payment-ledger");
  const paymentFaults = channelFaults.filter((f) => f.targetVowelId === paymentChannel?.id);

  let paymentSucceeded = false;
  const paymentPayload = {
    action: "charge_payment",
    amount: 500,
    currency: "USD",
    customerId: "cust-900",
    channelId: paymentChannel?.id ?? "chan-payment",
  };

  if (paymentChannel && paymentLedger) {
    if (paymentFaults.length > 0) {
      for (const fault of paymentFaults) {
        const res = applyConsonant(
          sim,
          paymentChannel,
          { kind: fault.consonantKind, ...(fault.params as any) },
          {
            targetCell: paymentLedger,
            payload: paymentPayload,
            dedupKey: "idem-task-100",
            ...fault.params,
          },
          sim.rng,
        );

        if (res.details?.targetCommitted || (res.details as any)?.channelResult?.targetCommitted) {
          paymentSucceeded = true;
        }

        const timeoutOccurred =
          res.details?.callerObservation === "timeout" ||
          (res.details as any)?.channelResult?.callerObservation === "timeout" ||
          (res.details as any)?.timedOut === true ||
          res.details?.phase === "POST_COMMIT" ||
          fault.consonantKind === "SEVER";

        if (timeoutOccurred) {
          sim.emit("channel.retry", paymentChannel.id, {
            channelId: paymentChannel.id,
            retryAttempt: 1,
            targetActorId: paymentChannel.targetActorId,
          });

          // Check if Redis volatile cache is still available or was wiped
          const cacheState = (redisCacheCell?.state as { cachedKeys?: Record<string, { key: string }> }) ?? {};
          const cachedKey = cacheState.cachedKeys?.["task-100"]?.key;

          // If cache was wiped (C5) or provider un-enforced, retry dedup key is omitted
          const retryDedupKey = paymentLedger.idempotencyEnforced ? (cachedKey ?? "idem-task-100") : undefined;

          // Target cell receives retry through channel send
          const retrySendRes = paymentChannel.send(sim, paymentPayload, paymentLedger, {
            dedupKey: retryDedupKey,
          });
          if (retrySendRes.targetCommitted) {
            paymentSucceeded = true;
          }
        }
      }
    } else {
      // Normal payment execution
      const res = paymentChannel.send(sim, paymentPayload, paymentLedger, {
        dedupKey: "idem-task-100",
      });
      if (res.targetCommitted) {
        paymentSucceeded = true;
      }
    }
  }

  // Step 8: Mid-Flight State & Fencing Token Validation
  if (redisLock) {
    const expiredRes = redisLock.expire(sim.now, sim);
    if (expiredRes.expiredCount > 0) {
      // When expired, another worker acquires the lease with the new epoch
      if (taskStateCell && taskStateCell.fencingTokenEnforced) {
        taskStateCell.epoch = redisLock.currentEpoch;
      }
    }
  }

  // Attempt state update with the epoch captured when the lock was acquired
  if (taskStateCell) {
    const isExpired = (redisLock?.currentEpoch ?? 0) > currentLockEpoch;
    const updateRes = taskStateCell.mutate(
      { status: "payment_completed", version: 2, stepsCompleted: 2 },
      { epoch: currentLockEpoch, sim },
      sim,
    );
    if (!updateRes.ok && updateRes.staleEpoch) {
      sim.emit("cell.stale_write_rejected", taskStateCell.id, {
        cellId: taskStateCell.id,
        attemptedEpoch: currentLockEpoch,
        currentEpoch: taskStateCell.epoch,
      });
    } else if (updateRes.ok && isExpired) {
      // Stale write accepted because fencingTokenEnforced was false!
      sim.emit("cell.stale_write_accepted", taskStateCell.id, {
        cellId: taskStateCell.id,
        staleEpoch: currentLockEpoch,
        currentEpoch: redisLock?.currentEpoch ?? 0,
      });
    }
  }

  // Step 9: Checkpoint and Artifact Persistence
  const checkpointCell = cellMap.get("cell-checkpoint");
  const artifactStorageCell = cellMap.get("cell-artifacts");
  const supervisorLease = leaseMap.get("lease-supervisor");

  // Check if supervisor crashed before checkpoint (Scenario B)
  const isSupervisorCrashed = supervisorLease?.overflowPolicy === "PANIC_CRASH" && supervisorLease?.currentLoad >= supervisorLease?.maxCapacity;

  if (!isSupervisorCrashed && paymentSucceeded) {
    artifactStorageCell?.mutate({ artifacts: [{ id: "art-1", data: "Customer settlement payload" }] }, { sim });
    checkpointCell?.mutate({ checkpointId: "cp-1", committedStep: "payment_and_tools", snapshotEpoch: 1 }, { sim });
    taskStateCell?.mutate({ status: "completed", version: 3, stepsCompleted: 3 }, { sim });
  } else if (isSupervisorCrashed && paymentSucceeded) {
    // Process crashed after payment but BEFORE checkpoint was committed!
    sim.emit("process.crash", "actor-supervisor", { crashedAt: sim.now, reason: "lease.panic_crash" });

    // Recovery worker triggers restart from last known checkpoint (cp-0)
    sim.emit("recovery.replay", "actor-recovery-worker", {
      fromCheckpoint: "cp-0",
      replayAction: "re-execute uncommitted steps",
    });

    // Replay repeats payment operation through channel!
    paymentChannel?.send(sim, paymentPayload, paymentLedger, {
      dedupKey: paymentLedger?.idempotencyEnforced ? "idem-task-100" : undefined,
    });
  }

  // Step 10: Result Delivery & Notification
  const deliveryChannel = channelMap.get("chan-delivery");
  const deliveredResultCell = cellMap.get("cell-delivered-result");
  if (deliveryChannel && deliveredResultCell) {
    deliveryChannel.send(sim, { status: "success", taskId: "task-100" });
    deliveredResultCell.mutate({ deliveries: [{ receiptId: "rec-1", status: "success" }] }, { sim });
  }

  // Step 11: Release Held Resources
  workerPool?.release("actor-orchestrator", sim.now, sim);
  pgPool?.release("actor-orchestrator", sim.now, sim);
  redisLock?.release("actor-orchestrator", sim.now, sim);
  admissionLease?.release("actor-ingress", sim.now, sim);

  // Advance simulation clock to drain remaining events
  sim.advanceTo(sim.now + 100);

  // 4. Invariant Auditor Integration
  const events = sim.log;
  const jsonl = convertAlphabetEventsToLangChainJsonl(events, cellMap, channelMap);
  let auditorFindings: any[] = [];
  try {
    const auditor = resolveAuditor();
    const trace = auditor.parseLangChainCallbackJsonl(jsonl);
    auditorFindings = auditor.auditTrace(trace);
  } catch (err) {
    sim.emit("auditor.warning", "auditor", { error: String(err) });
  }

  // 5. Evaluate System Invariants
  const { invariants, violatedInvariants } = evaluateDistribInvariants({
    events,
    cells: cellMap,
    leases: leaseMap,
    logs: logMap,
    auditorFindings,
  });

  return {
    events,
    invariants,
    auditorFindings,
    violatedInvariants,
    worldState: {
      cells: Object.fromEntries(Array.from(cellMap.entries()).map(([k, v]) => [k, v.state])),
      leases: Object.fromEntries(Array.from(leaseMap.entries()).map(([k, v]) => [k, { load: v.currentLoad, epoch: v.currentEpoch }])),
      logs: Object.fromEntries(Array.from(logMap.entries()).map(([k, v]) => [k, { count: v.entries.length }])),
    },
  };
}

