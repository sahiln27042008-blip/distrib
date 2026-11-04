// enterpriseee/enterprise-simulator/src/scientist/matrix-to-graph.ts

import type { MatrixConfig } from "../matrix-copy.ts";
import type {
  CompiledAlphabetGraph,
  CandidatePerturbation,
  Consonant,
} from "../physics/alphabet/types.ts";
import { buildAdversarialAgentWorld } from "../physics/distrib/distrib-world.ts";
import type { Channel } from "../physics/alphabet/vowels/channel.ts";
import type { Lease } from "../physics/alphabet/vowels/lease.ts";
import type { Log } from "../physics/alphabet/vowels/log.ts";
import type { Cell } from "../physics/alphabet/vowels/cell.ts";

const VALID_A = new Set([
  "A1_single_task",
  "A2_mixed_saas",
  "A3_exec_demo_burst",
  "A4_bulk_crm_swarm",
  "A5_marathon_30step",
]);

const VALID_B = new Set([
  "B1_zero_hold_2ms",
  "B2_stream_hog_30s",
  "B3_write_amp_15mb",
  "B4_hydration_freeze_4s",
  "B5_in_doubt_zombie_tx",
]);

const VALID_C = new Set([
  "C1_clean_20ms",
  "C2_socket_drop_2ms_late",
  "C3_rate_limit_429_brownout",
  "C4_bulk_50_poison_pill",
  "C5_legacy_erp_no_idem",
]);

const VALID_D = new Set([
  "D1_raw_json_80k_flood",
  "D2_append_only_quadratic",
  "D3_lossy_llm_summary",
  "D4_unmapped_schema_drift",
  "D5_cqrs_duckdb_blackboard_o1",
]);

const VALID_E = new Set([
  "E1_god_mode_main_thread",
  "E2_walled_garden_stuck",
  "E3_hitl_fatigue_global_bool",
  "E4_state_leases_ipc_worker",
  "E5_audit_log_only_no_enforcement",
]);

const VALID_F = new Set([
  "F1_blind_retry_unbounded_spend",
  "F2_bounded_backoff_deadletter",
  "F2_ask_llm_to_undo",
  "F3_resilient_invariant_runtime",
  "F4_saga_orchestrated_compensate",
  "F5_graceful_handoff_cascade",
]);

/**
 * Adapts a 6-dial MatrixConfig to a CompiledAlphabetGraph for the Causal Alphabet engine.
 * Faithfully translates dial values into Alphabet vowels, channels, and candidate perturbations.
 * Returns MODEL_GAP in unrepresentableSemantics if any dial value cannot be represented.
 */
export function matrixToGraph(config: MatrixConfig): CompiledAlphabetGraph {
  const unrepresentable: string[] = [];

  // Validate all 6 dials
  if (config.A && !VALID_A.has(config.A)) {
    unrepresentable.push(`MODEL_GAP: Dial A value '${config.A}' is not representable in alphabet`);
  }
  if (config.B && !VALID_B.has(config.B)) {
    unrepresentable.push(`MODEL_GAP: Dial B value '${config.B}' is not representable in alphabet`);
  }
  if (config.C && !VALID_C.has(config.C)) {
    unrepresentable.push(`MODEL_GAP: Dial C value '${config.C}' is not representable in alphabet`);
  }
  if (config.D && !VALID_D.has(config.D)) {
    unrepresentable.push(`MODEL_GAP: Dial D value '${config.D}' is not representable in alphabet`);
  }
  if (config.E && !VALID_E.has(config.E)) {
    unrepresentable.push(`MODEL_GAP: Dial E value '${config.E}' is not representable in alphabet`);
  }
  if (config.F && !VALID_F.has(config.F)) {
    unrepresentable.push(`MODEL_GAP: Dial F value '${config.F}' is not representable in alphabet`);
  }

  const injected = new Set(config.injectedInterventions ?? []);

  // Determine idempotency enforcement:
  // C5 is legacy ERP without idempotency. injected missing_idempotency_key also disables idempotency.
  const paymentIdempotencyEnforced =
    config.C !== "C5_legacy_erp_no_idem" &&
    !injected.has("missing_idempotency_key");

  // Determine fencing token enforcement:
  // E4 enforces fencing tokens via state leases IPC worker.
  const fencingTokenEnforced = config.E === "E4_state_leases_ipc_worker";

  // Determine PG pool capacity from dbPoolSize
  const pgPoolCapacity = typeof config.dbPoolSize === "number" && config.dbPoolSize > 0
    ? config.dbPoolSize
    : 3;

  // Build base adversarial agent world
  const graph = buildAdversarialAgentWorld({
    paymentIdempotencyEnforced,
    fencingTokenEnforced,
    pgPoolCapacity,
    lockTtlMs: 30000,
  });

  // Vowel references
  const pgPoolLease = graph.vowels.find((v) => v.id === "lease-pg-pool") as Lease | undefined;
  const paymentChannel = graph.channels.find((ch) => ch.id === "chan-payment") as Channel | undefined;
  const paymentLedgerCell = graph.vowels.find((v) => v.id === "cell-payment-ledger") as Cell | undefined;
  const taskQueueLog = graph.vowels.find((v) => v.id === "log-task-queue") as Log | undefined;
  const asyncEventLog = graph.vowels.find((v) => v.id === "log-async-events") as Log | undefined;

  // Ensure idempotency setting is synced to vowel instances
  if (paymentChannel) {
    (paymentChannel as any).idempotencyEnabled = paymentIdempotencyEnforced;
  }
  if (paymentLedgerCell) {
    (paymentLedgerCell as any).idempotencyEnforced = paymentIdempotencyEnforced;
  }

  // Dial A: Workload scale
  // A1=1, A2=10, A3=50, A4=200, A5=10 (with 30 steps)
  // Higher loads stress admission and worker pool

  // Dial B: DB hold
  if (pgPoolLease) {
    if (config.B === "B1_zero_hold_2ms") {
      (pgPoolLease as any).heldDuringExternalChannel = false;
      (pgPoolLease as any).ttlMs = 2000;
    } else if (config.B === "B2_stream_hog_30s") {
      (pgPoolLease as any).heldDuringExternalChannel = true;
      (pgPoolLease as any).ttlMs = 30000;
    }
  }

  // Dial F: Recovery & Budget
  let budgetUsd: number | undefined;
  if (config.F === "F3_resilient_invariant_runtime" || config.F === "F5_graceful_handoff_cascade") {
    budgetUsd = 0.25;
    if (paymentChannel) {
      (paymentChannel as any).budgetUsd = 0.25;
    }
  }

  // Candidate perturbations
  const candidates: CandidatePerturbation[] = [];

  // Dial C candidate perturbations:
  if (config.C === "C2_socket_drop_2ms_late" || injected.has("drop_response") || injected.has("delay_response")) {
    candidates.push({
      consonant: { kind: "SEVER", phase: "POST_COMMIT" },
      targetId: "chan-payment",
      description: "C2 socket drop 2ms late: severed post-commit acknowledgment",
    });
  } else if (config.C === "C3_rate_limit_429_brownout" || injected.has("rate_limit")) {
    candidates.push({
      consonant: { kind: "SATURATE", loadUnits: 5 },
      targetId: "lease-llm-rate-limit",
      description: "C3 rate limit 429 brownout",
    });
  } else if (config.C === "C4_bulk_50_poison_pill" || injected.has("partial_failure")) {
    candidates.push({
      consonant: { kind: "CORRUPT", mode: "POISON_PILL" },
      targetId: "chan-payment",
      description: "C4 poison pill payload corruption",
    });
  } else if (config.C === "C5_legacy_erp_no_idem" || injected.has("missing_idempotency_key")) {
    // Legacy ERP without idempotency: post-commit sever triggers retry that creates duplicate
    candidates.push({
      consonant: { kind: "SEVER", phase: "POST_COMMIT" },
      targetId: "chan-payment",
      description: "C5 legacy ERP: severed post-commit response triggers duplicate side effect",
    });
    candidates.push({
      consonant: { kind: "DUPLICATE", count: 2 },
      targetId: "chan-payment",
      description: "C5 legacy ERP: duplicate payment request",
    });
  }

  // Dial B candidate perturbations:
  if (config.B === "B2_stream_hog_30s") {
    candidates.push({
      consonant: { kind: "SATURATE", loadUnits: pgPoolCapacity },
      targetId: "lease-pg-pool",
      description: "B2 stream hog connection pool saturation",
    });
  } else if (config.B === "B3_write_amp_15mb" || injected.has("write_amplification")) {
    if (asyncEventLog) {
      asyncEventLog.compactionLagMs = 5000;
    }
    candidates.push({
      consonant: { kind: "DELAY", durationMs: 5000 },
      targetId: "log-async-events",
      description: "B3 write amplification compaction lag",
    });
  } else if (config.B === "B4_hydration_freeze_4s") {
    candidates.push({
      consonant: { kind: "DELAY", durationMs: 4000 },
      targetId: "cell-task-state",
      description: "B4 hydration freeze delay",
    });
  } else if (config.B === "B5_in_doubt_zombie_tx" || injected.has("stale_read")) {
    candidates.push({
      consonant: { kind: "WIPE", scope: "VOLATILE_CELLS", cellIds: ["cell-redis-cache"] },
      targetId: "cell-redis-cache",
      description: "B5 in-doubt zombie transaction cache wipe",
    });
  }

  // Dial D candidate perturbations:
  if (config.D === "D1_raw_json_80k_flood" || injected.has("context_bloat")) {
    candidates.push({
      consonant: { kind: "DELAY", durationMs: 1000 },
      targetId: "log-task-queue",
      description: "D1 flood overload delay",
    });
  } else if (config.D === "D3_lossy_llm_summary") {
    candidates.push({
      consonant: { kind: "CORRUPT", mode: "LOSSY_DROP" },
      targetId: "log-task-queue",
      description: "D3 lossy LLM context summary",
    });
  } else if (config.D === "D4_unmapped_schema_drift") {
    candidates.push({
      consonant: { kind: "CORRUPT", mode: "SCHEMA_DRIFT" },
      targetId: "log-task-queue",
      description: "D4 schema drift in tool result",
    });
  }

  // Dial F candidate perturbations:
  if (config.F === "F1_blind_retry_unbounded_spend" || injected.has("duplicate_request")) {
    candidates.push({
      consonant: { kind: "DUPLICATE", count: 2 },
      targetId: "chan-payment",
      description: "F1 blind retry duplicate request",
    });
  }

  // Add all candidate perturbations to graph
  graph.candidatePerturbations = candidates;

  if (unrepresentable.length > 0) {
    graph.epistemicStatus = ["NOT_REPRESENTABLE"];
    graph.unrepresentableSemantics = unrepresentable;
  }

  return graph;
}
