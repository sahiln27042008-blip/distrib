// enterpriseee/enterprise-simulator/src/physics/distrib/distrib-invariants.ts

import type { SimEvent } from "../../kernel.ts";
import type { Finding } from "../search/search-types.ts";
import type { InvariantResult } from "./distrib-types.ts";
import type { Cell } from "../alphabet/vowels/cell.ts";
import type { Lease } from "../alphabet/vowels/lease.ts";
import type { Log } from "../alphabet/vowels/log.ts";
import type {
  BusinessState,
  InDoubtState,
  LittleLawMetrics,
  OperationLedger,
  QueueBacklog,
} from "./distrib-types.ts";
import { reconcileLedger } from "./distrib-world.ts";

export interface EvaluationContext {
  events: SimEvent[];
  cells: Map<string, Cell>;
  leases: Map<string, Lease>;
  logs: Map<string, Log>;
  auditorFindings: Finding[];
  ledger: OperationLedger;
  operationStates: Map<string, BusinessState>;
  queueBacklog: QueueBacklog;
  littleLawMetrics: LittleLawMetrics;
  inDoubtState: InDoubtState;
}

export function checkZeroHoldLease(
  queue: QueueBacklog,
  metrics: LittleLawMetrics,
): InvariantResult {
  const breached =
    queue.total504Errors > 0 || queue.queuedWaiters.length > queue.maxQueueDepth;
  return {
    id: "R08_ZeroHoldLease",
    name: "R08 Zero-Hold Lease: Continuous Queue Saturation",
    category: "lease_safety",
    passed: !breached,
    evidence: breached
      ? `Connection pool starvation: ${queue.total504Errors} HTTP 504 errors and ${queue.queuedWaiters.length} queued waiters`
      : `No queue saturation (${queue.queuedWaiters.length}/${queue.maxQueueDepth} waiters, ${queue.total504Errors} HTTP 504 errors)`,
    details: breached
      ? {
          activeConnections: queue.activeLeases,
          maxPoolCapacity: queue.maxPoolCapacity,
          queuedWaiters: queue.queuedWaiters.length,
          avgHoldMs: metrics.avgHoldMs,
          dbCpuPct: metrics.dbCpuPct,
          breachType: "HTTP_504_GATEWAY_TIMEOUT",
          detail: `Connection pool starvation on ClientRead wait event; DB CPU idle at ${metrics.dbCpuPct}% while held leases block callers`,
        }
      : undefined,
  };
}

export function checkNetworkIdempotencyInDoubt(
  state: InDoubtState,
  ledger: OperationLedger,
): InvariantResult {
  const duplicateEntries = Array.from(ledger.entries.values()).filter(
    (entry) => entry.duplicateOf !== null,
  );
  const duplicateDollars = duplicateEntries.reduce(
    (sum, entry) => sum + entry.amountCents,
    0,
  ) / 100;
  return {
    id: "R04_NetworkIdempotency",
    name: "R04 Network Idempotency: In-Doubt Mutation Replay",
    category: "idempotency",
    passed: !state.duplicateMutation,
    evidence: state.duplicateMutation
      ? `Post-commit ACK loss followed by retry created ${ledger.totalDuplicateEffects} duplicate mutation(s)`
      : `No duplicate mutation after ACK loss or retry (phase: ${state.phase})`,
    details: state.duplicateMutation
      ? {
          inDoubtPhase: state.phase,
          committedAt: state.committedAt,
          ackLostAt: state.ackLostAt,
          retryKey: state.retryIdempotencyKey,
          duplicateCharges: ledger.totalDuplicateEffects,
          duplicateDollars,
          detail: "Post-commit ACK lost; client in IN_DOUBT state retried without an effective idempotency key",
        }
      : undefined,
  };
}

export function evaluateDistribInvariants(ctx: EvaluationContext): {
  invariants: InvariantResult[];
  violatedInvariants: string[];
} {
  const { events, cells, leases, logs, auditorFindings, ledger, operationStates } = ctx;
  const results: InvariantResult[] = [];

  // 1. Payment Safety: 1 logical payment operation must not produce multiple successful charges
  const paymentLedger = cells.get("cell-payment-ledger");
  const mutationCount = paymentLedger?.mutationCount ?? 0;
  const duplicateCharge = mutationCount > 1;
  const paymentPassed = !duplicateCharge;
  results.push({
    id: "payment_safety",
    name: "Payment Safety: Single Charge Commitment",
    category: "payment_safety",
    passed: paymentPassed,
    evidence: paymentPassed
      ? `Exactly ${mutationCount} charge mutation committed to ledger`
      : `DUPLICATE CHARGE DETECTED: ${mutationCount} charge mutations committed to payment ledger`,
    details: { mutationCount },
  });

  // 2. Task Correctness: Task marked completed requires durable state checkpoint
  const taskState = (cells.get("cell-task-state")?.state as { status?: string; stepsCompleted?: number }) ?? {};
  const checkpoint = (cells.get("cell-checkpoint")?.state as { committedStep?: string }) ?? {};
  const isMarkedCompleted = taskState.status === "completed";
  const hasDurableCheckpoint = checkpoint.committedStep === "payment_and_tools";
  const taskCorrectnessPassed = !isMarkedCompleted || hasDurableCheckpoint;
  results.push({
    id: "task_correctness",
    name: "Task Correctness: Durable State Precedence",
    category: "task_correctness",
    passed: taskCorrectnessPassed,
    evidence: taskCorrectnessPassed
      ? `Task status is '${taskState.status ?? "pending"}' consistent with checkpoint '${checkpoint.committedStep ?? "none"}'`
      : `TASK STATE INCONSISTENT: Task marked completed before checkpoint durable (committedStep: '${checkpoint.committedStep}')`,
  });

  // 3. Idempotency: Retries must not bypass logical operation identity
  const r04Finding = auditorFindings.find((f) => f.rule_id === "r04-network-idempotency" && f.status === "proven");
  const cellDuplicates = events.filter((e) => e.kind === "cell.duplicate_detected");
  const unhandledRetries = events.filter((e) => e.kind === "channel.retry" && e.data.dedupKey === undefined);
  const idempotencyPassed = !r04Finding && !duplicateCharge;
  results.push({
    id: "idempotency",
    name: "Idempotency: Retries Bound to Operation Identity",
    category: "idempotency",
    passed: idempotencyPassed,
    evidence: idempotencyPassed
      ? "All mutations properly deduplicated; no idempotency bypasses detected"
      : `IDEMPOTENCY VIOLATED: ${r04Finding ? r04Finding.message : "Duplicate mutation on retry without idempotency key"}`,
    details: { r04Finding, cellDuplicatesCount: cellDuplicates.length, unhandledRetriesCount: unhandledRetries.length },
  });

  // 4. Lease Safety: Expired lease ownership must not authorize stale writes
  const staleWriteEvents = events.filter((e) => e.kind === "cell.stale_write_rejected");
  const staleWriteAccepted = events.filter((e) => e.kind === "cell.stale_write_accepted");
  const leaseEpochExpired = events.filter((e) => e.kind === "lease.epoch_expired");
  const leaseSafetyPassed = staleWriteAccepted.length === 0;
  results.push({
    id: "lease_safety",
    name: "Lease Safety: Fencing Token Rejection of Stale Writes",
    category: "lease_safety",
    passed: leaseSafetyPassed,
    evidence: leaseSafetyPassed
      ? `Lease fencing maintained. ${staleWriteEvents.length} stale writes caught and rejected`
      : `STALE WRITE ACCEPTED: Worker wrote to state with an expired fencing epoch (${staleWriteAccepted.length} un-fenced mutations)`,
    details: { expiredLeaseEvents: leaseEpochExpired.length, staleWriteEvents: staleWriteEvents.length },
  });

  // 5. Resource Safety: Connection and worker concurrency respects limits
  const pgPool = leases.get("lease-pg-pool");
  const workerPool = leases.get("lease-worker-pool");
  const poolTimeouts = events.filter((e) => e.kind === "lease.wait_timeout");
  const poolRejections = events.filter((e) => e.kind === "lease.rejected");
  const poolCrashes = events.filter((e) => e.kind === "lease.panic_crash");
  const resourceSafetyPassed = poolCrashes.length === 0 && poolTimeouts.length === 0 && poolRejections.length === 0;
  results.push({
    id: "resource_safety",
    name: "Resource Safety: Bounded Pool Concurrency & Liveness",
    category: "resource_safety",
    passed: resourceSafetyPassed,
    evidence: resourceSafetyPassed
      ? `All resources within limits (PG load: ${pgPool?.currentLoad ?? 0}/${pgPool?.maxCapacity ?? 0}, Worker load: ${workerPool?.currentLoad ?? 0}/${workerPool?.maxCapacity ?? 0})`
      : `RESOURCE EXHAUSTION: ${poolCrashes.length} crashes, ${poolTimeouts.length} timeouts, ${poolRejections.length} capacity rejections`,
    details: { poolCrashes: poolCrashes.length, poolTimeouts: poolTimeouts.length, poolRejections: poolRejections.length },
  });

  // 6. Cancellation: Canceled work must not produce forbidden side effects
  const cancellation = (cells.get("cell-cancellation")?.state as { cancelled?: boolean; cancelledAt?: number }) ?? {};
  let postCancellationSideEffect = false;
  if (cancellation.cancelled && cancellation.cancelledAt !== undefined) {
    const cancelTime = cancellation.cancelledAt;
    const postCancelMutations = events.filter(
      (e) => (e.kind === "channel.mutate" || e.kind === "cell.mutate") && e.t > cancelTime && e.data.targetCellId !== "cell-cancellation",
    );
    if (postCancelMutations.length > 0) {
      postCancellationSideEffect = true;
    }
  }
  const cancellationPassed = !postCancellationSideEffect;
  results.push({
    id: "cancellation",
    name: "Cancellation: Post-Cancel Effect Prevention",
    category: "cancellation",
    passed: cancellationPassed,
    evidence: cancellationPassed
      ? (cancellation.cancelled ? "Task cancelled cleanly with zero post-cancellation side effects" : "No cancellation requested")
      : "CANCELLATION RACE: In-flight tool or payment committed AFTER cancellation was issued",
  });

  // 7. Recovery: Restart/replay must not duplicate irreversible effects
  const recoveryEvents = events.filter((e) => e.kind === "recovery.replay");
  const recoveryPassed = !(recoveryEvents.length > 0 && duplicateCharge);
  results.push({
    id: "recovery",
    name: "Recovery: Replay State Reconciliation",
    category: "recovery",
    passed: recoveryPassed,
    evidence: recoveryPassed
      ? `Recovery state consistent (${recoveryEvents.length} recovery replays)`
      : `RECOVERY DUPLICATION: Process crash recovery replayed already-committed external transaction`,
  });

  // 8. Event Integrity: Required events must not be silently reordered, lost, or corrupted
  const asyncLog = logs.get("log-async-events");
  const corruptLogEvents = events.filter((e) => e.kind.startsWith("consonant.corrupt"));
  const logDropped = events.filter((e) => e.kind === "log.dropped" || e.kind === "log.lossy_drop");
  const eventIntegrityPassed = corruptLogEvents.length === 0 && logDropped.length === 0;
  results.push({
    id: "event_integrity",
    name: "Event Integrity: Asynchronous Stream Fidelity",
    category: "event_integrity",
    passed: eventIntegrityPassed,
    evidence: eventIntegrityPassed
      ? `Event log intact with ${asyncLog?.entries.length ?? 0} entries preserved`
      : `EVENT STREAM CORRUPTED: ${logDropped.length} entries lost or corrupted in stream`,
  });

  // 9. Result Integrity: Delivered success corresponds to completed operation
  const delivered = (cells.get("cell-delivered-result")?.state as { deliveries?: Array<{ receiptId: string; status: string }> }) ?? {};
  const deliveries = delivered.deliveries ?? [];
  const invalidDelivery = deliveries.some((d) => d.status === "success" && !hasDurableCheckpoint);
  const resultIntegrityPassed = !invalidDelivery;
  results.push({
    id: "result_integrity",
    name: "Result Integrity: Delivered Outcome Veracity",
    category: "result_integrity",
    passed: resultIntegrityPassed,
    evidence: resultIntegrityPassed
      ? `Result deliveries (${deliveries.length}) verified against durable state`
      : "FALSE RESULT DELIVERED: Success delivered to caller for unverified / non-checkpointed operation",
  });

  // 10. Observability: Events retain causal chain correlation
  const causalHops = events.filter((e) => e.corr !== undefined);
  const missingCorr = events.filter((e) => e.kind.startsWith("channel.") && !e.corr);
  const observabilityPassed = missingCorr.length === 0;
  results.push({
    id: "observability",
    name: "Observability: Causal Correlation Preservation",
    category: "observability",
    passed: observabilityPassed,
    evidence: observabilityPassed
      ? `Causal correlation preserved across all ${causalHops.length} recorded events`
      : `BROKEN CAUSAL CHAIN: ${missingCorr.length} channel events missing correlation ids`,
  });

  const noDuplicateEffectsPassed = ledger.totalDuplicateEffects === 0;
  results.push({
    id: "no_duplicate_effects",
    name: "No Duplicate Financial Effects",
    category: "payment_safety",
    passed: noDuplicateEffectsPassed,
    evidence: noDuplicateEffectsPassed
      ? `No duplicate effects across ${ledger.totalCommittedEffects} committed operations`
      : `DUPLICATE EFFECTS: ${ledger.totalDuplicateEffects} duplicate financial effects recorded`,
    details: {
      totalCommittedEffects: ledger.totalCommittedEffects,
      totalDuplicateEffects: ledger.totalDuplicateEffects,
      duplicates: Array.from(ledger.entries.values()).filter((entry) => entry.duplicateOf !== null),
    },
  });

  results.push(checkZeroHoldLease(ctx.queueBacklog, ctx.littleLawMetrics));
  results.push(checkNetworkIdempotencyInDoubt(ctx.inDoubtState, ledger));

  const incompleteOperations = Array.from(operationStates.entries())
    .filter(([, state]) => state !== "COMPLETED")
    .map(([operationId, state]) => ({ operationId, state }));
  results.push({
    id: "all_operations_completed",
    name: "All Business Operations Completed",
    category: "task_correctness",
    passed: incompleteOperations.length === 0,
    evidence: incompleteOperations.length === 0
      ? `All ${operationStates.size} logical operations reached COMPLETED`
      : `INCOMPLETE BUSINESS OPERATIONS: ${incompleteOperations.map(({ operationId, state }) => `${operationId}=${state}`).join(", ")}`,
    details: { incompleteOperations },
  });

  const reconciliation = reconcileLedger(ledger);
  results.push({
    id: "ledger_reconciliation",
    name: "Authoritative Ledger Reconciliation",
    category: "payment_safety",
    passed: reconciliation.balanced,
    evidence: reconciliation.balanced
      ? `Ledger reconciled: ${ledger.totalCommittedEffects} committed effects and ${ledger.totalDuplicateEffects} duplicates`
      : `LEDGER UNRECONCILED: unresolved operations [${reconciliation.unresolved.join(", ")}], committed=${ledger.totalCommittedEffects}, duplicates=${ledger.totalDuplicateEffects}`,
    details: {
      ...reconciliation,
      totalCommittedEffects: ledger.totalCommittedEffects,
      totalDuplicateEffects: ledger.totalDuplicateEffects,
    },
  });

  const seenKeys = new Set<string>();
  const repeatedKeys: string[] = [];
  for (const entry of ledger.entries.values()) {
    if (entry.idempotencyKey !== null) {
      if (seenKeys.has(entry.idempotencyKey)) repeatedKeys.push(entry.idempotencyKey);
      seenKeys.add(entry.idempotencyKey);
    }
  }
  results.push({
    id: "idempotency_key_integrity",
    name: "Idempotency Key Integrity",
    category: "idempotency",
    passed: repeatedKeys.length === 0,
    evidence: repeatedKeys.length === 0
      ? "No committed effects share an idempotency key"
      : `IDEMPOTENCY KEY REUSED FOR DISTINCT EFFECTS: ${repeatedKeys.join(", ")}`,
    details: { repeatedKeys },
  });

  const violatedInvariants = results.filter((r) => !r.passed).map((r) => r.id);

  // Also include any proven rules from the external invariant auditor (e.g. r04-network-idempotency, r03, r05)
  for (const finding of auditorFindings) {
    if (finding.status === "proven") {
      const ruleId = finding.rule_id;
      if (ruleId && !violatedInvariants.includes(ruleId)) {
        violatedInvariants.push(ruleId);
      }
    }
  }

  return { invariants: results, violatedInvariants };
}

