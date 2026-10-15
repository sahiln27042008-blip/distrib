// Combinatorial Enterprise Matrix Simulator (A x B x C x D x E x F)
// Deterministic virtual-time execution over kernel.ts (Sim, Rng)

import { Sim, Rng, type SimEvent } from "./kernel.ts";
import { exportTrace, type Trace } from "./trace.ts";

export type DialA = "A1_single_task" | "A2_mixed_saas" | "A3_exec_demo_burst" | "A4_bulk_crm_swarm" | "A5_marathon_30step";
export type DialB = "B1_zero_hold_2ms" | "B2_stream_hog_30s" | "B3_write_amp_15mb" | "B4_hydration_freeze_4s" | "B5_in_doubt_zombie_tx";
export type DialC = "C1_clean_20ms" | "C2_socket_drop_2ms_late" | "C3_rate_limit_429_brownout" | "C4_bulk_50_poison_pill" | "C5_legacy_erp_no_idem";
export type DialD = "D1_raw_json_80k_flood" | "D2_append_only_quadratic" | "D3_lossy_llm_summary" | "D4_unmapped_schema_drift" | "D5_cqrs_duckdb_blackboard_o1";
export type DialE = "E1_god_mode_main_thread" | "E2_walled_garden_stuck" | "E3_hitl_fatigue_global_bool" | "E4_state_leases_ipc_worker";
export type DialF = "F1_blind_retry_unbounded_spend" | "F2_ask_llm_to_undo" | "F3_resilient_invariant_runtime";

export interface MatrixConfig {
  seed: number;
  runId: string;
  A: DialA;
  B: DialB;
  C: DialC;
  D: DialD;
  E: DialE;
  F: DialF;
  humanUsers: number;
  concurrentAgents: number;
  dbPoolSize: number;
  workflowSteps: number;
  saasPriceUsd: number;
  ticketValueUsd: number;
}

export interface MatrixSnapshot {
  mode: "selected" | "resilient";
  config: MatrixConfig;
  virtualTimeMs: number;
  dials: { A: DialA; B: DialB; C: DialC; D: DialD; E: DialE; F: DialF };
  db: {
    activeConnections: number;
    poolSize: number;
    waitQueue: number;
    timeouts: number;
    avgHoldMs: number;
    p99HoldMs: number;
    cpuPct: number;
    ramPct: number;
    saas500s: number;
  };
  storage: {
    iopsUsed: number;
    iopsLimit: number;
    bytesWritten: number;
    frozenQueries: number;
  };
  host: {
    activeSessions: number;
    eventLoopBlockedMs: number;
    crashed: boolean;
    restarts: number;
  };
  context: {
    promptTokens: number;
    turn1Tokens: number;
    turn10Tokens: number;
    signalPct: number;
    ttftMs: number;
  };
  network: {
    calls: number;
    ecnoreset: number;
    rateLimited: number;
    poisonAborts: number;
    duplicateShipments: number;
    duplicateCharges: number;
    duplicateDollars: number;
  };
  security: {
    toolCallsAllowed: number;
    toolCallsBlocked: number;
    injectionAttempts: number;
    injectionBlocked: number;
    crashesContained: number;
    crashesFatal: number;
  };
  recovery: {
    checkpointsWritten: number;
    checkpointBytes: number;
    stepsReplayed: number;
    tokensWasted: number;
    orphansLeft: number;
    compensationsRun: number;
  };
  economics: {
    totalTokens: number;
    costUsd: number;
    perTenant: Array<{ tenant: string; revenueUsd: number; costUsd: number; marginUsd: number }>;
  };
  totals: {
    tokensConsumed: number;
    costUsd: number;
    duplicateDollars: number;
    orphanedCloudCostUsd: number;
    storageBytesWritten: number;
    hostCrashes: number;
    eventLoopFreezes: number;
    saas500s: number;
  };
}

export interface RootCause {
  dial: string;
  title: string;
  mechanism: string;
  businessImpact: string;
}

export interface AppliedFix {
  dial: string;
  invariantName: string;
  howItWorks: string;
  codeSnippet: string;
  metricDelta: string;
}

export interface ValueDelta {
  brokenMonthlyLeak: number;
  resilientMonthlyCost: number;
  netMonthlySavings: number;
  annualizedSavings: number;
  engagementCostUsd: number;
  paybackDays: number;
}

export const TENANT_NAMES = [
  "Brightwater Health",
  "Halvorsen Logistics",
  "Cobalt Freight",
  "Dunmore Capital",
  "Eastgate Retail",
  "Acme Corp",
  "Nexus Tech",
  "Apex Systems",
  "Omni Global",
  "Vortex Analytics",
];

export const MATRIX_PRESETS: Record<string, MatrixConfig> = {
  login_freeze_db_hog: {
    seed: 42,
    runId: "preset-login-freeze",
    A: "A2_mixed_saas",
    B: "B2_stream_hog_30s",
    C: "C1_clean_20ms",
    D: "D2_append_only_quadratic",
    E: "E1_god_mode_main_thread",
    F: "F1_blind_retry_unbounded_spend",
    humanUsers: 200,
    concurrentAgents: 10,
    dbPoolSize: 20,
    workflowSteps: 10,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  },
  double_charge_2ms_drop: {
    seed: 42,
    runId: "preset-double-charge",
    A: "A2_mixed_saas",
    B: "B1_zero_hold_2ms",
    C: "C2_socket_drop_2ms_late",
    D: "D3_lossy_llm_summary",
    E: "E4_state_leases_ipc_worker",
    F: "F1_blind_retry_unbounded_spend",
    humanUsers: 200,
    concurrentAgents: 10,
    dbPoolSize: 20,
    workflowSteps: 10,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  },
  split_brain_orphan_aws: {
    seed: 42,
    runId: "preset-split-brain",
    A: "A1_single_task",
    B: "B2_stream_hog_30s",
    C: "C1_clean_20ms",
    D: "D2_append_only_quadratic",
    E: "E1_god_mode_main_thread",
    F: "F2_ask_llm_to_undo",
    humanUsers: 0,
    concurrentAgents: 1,
    dbPoolSize: 20,
    workflowSteps: 10,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  },
  json_80k_churn_choke: {
    seed: 42,
    runId: "preset-json-80k",
    A: "A2_mixed_saas",
    B: "B1_zero_hold_2ms",
    C: "C1_clean_20ms",
    D: "D1_raw_json_80k_flood",
    E: "E4_state_leases_ipc_worker",
    F: "F1_blind_retry_unbounded_spend",
    humanUsers: 200,
    concurrentAgents: 10,
    dbPoolSize: 20,
    workflowSteps: 10,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  },
  turn10_quadratic_spiral: {
    seed: 42,
    runId: "preset-quadratic-spiral",
    A: "A5_marathon_30step",
    B: "B3_write_amp_15mb",
    C: "C1_clean_20ms",
    D: "D2_append_only_quadratic",
    E: "E1_god_mode_main_thread",
    F: "F1_blind_retry_unbounded_spend",
    humanUsers: 50,
    concurrentAgents: 5,
    dbPoolSize: 20,
    workflowSteps: 30,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  },
  checkpoint_15mb_disk_collapse: {
    seed: 42,
    runId: "preset-disk-collapse",
    A: "A5_marathon_30step",
    B: "B3_write_amp_15mb",
    C: "C1_clean_20ms",
    D: "D3_lossy_llm_summary",
    E: "E4_state_leases_ipc_worker",
    F: "F1_blind_retry_unbounded_spend",
    humanUsers: 100,
    concurrentAgents: 10,
    dbPoolSize: 20,
    workflowSteps: 30,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  },
  cfo_40usd_margin_inversion: {
    seed: 42,
    runId: "preset-margin-inversion",
    A: "A5_marathon_30step",
    B: "B1_zero_hold_2ms",
    C: "C1_clean_20ms",
    D: "D1_raw_json_80k_flood",
    E: "E4_state_leases_ipc_worker",
    F: "F1_blind_retry_unbounded_spend",
    humanUsers: 50,
    concurrentAgents: 5,
    dbPoolSize: 20,
    workflowSteps: 15,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  },
  bulk_50_poison_rate_storm: {
    seed: 42,
    runId: "preset-poison-storm",
    A: "A4_bulk_crm_swarm",
    B: "B1_zero_hold_2ms",
    C: "C4_bulk_50_poison_pill",
    D: "D4_unmapped_schema_drift",
    E: "E4_state_leases_ipc_worker",
    F: "F1_blind_retry_unbounded_spend",
    humanUsers: 100,
    concurrentAgents: 50,
    dbPoolSize: 20,
    workflowSteps: 10,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  },
  god_mode_prompt_injection: {
    seed: 42,
    runId: "preset-god-mode-injection",
    A: "A1_single_task",
    B: "B2_stream_hog_30s",
    C: "C1_clean_20ms",
    D: "D2_append_only_quadratic",
    E: "E1_god_mode_main_thread",
    F: "F2_ask_llm_to_undo",
    humanUsers: 0,
    concurrentAgents: 1,
    dbPoolSize: 20,
    workflowSteps: 10,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  },
  marathon_20min_kill_test: {
    seed: 42,
    runId: "preset-kill-test",
    A: "A5_marathon_30step",
    B: "B3_write_amp_15mb",
    C: "C3_rate_limit_429_brownout",
    D: "D2_append_only_quadratic",
    E: "E1_god_mode_main_thread",
    F: "F1_blind_retry_unbounded_spend",
    humanUsers: 50,
    concurrentAgents: 5,
    dbPoolSize: 20,
    workflowSteps: 30,
    saasPriceUsd: 20,
    ticketValueUsd: 5,
  },
};

export class MatrixScenario {
  private readonly config: MatrixConfig;
  private sim: Sim;
  private rng: Rng;
  private isStarted = false;

  // DB & Disk State
  private dbActive = 0;
  private dbWaitQueue = 0;
  private dbTimeouts = 0;
  private dbAvgHoldMs = 2;
  private dbP99HoldMs = 2;
  private dbCpuPct = 15;
  private dbRamPct = 25;
  private saas500s = 0;

  // Storage State
  private iopsUsed = 5;
  private iopsLimit = 1000;
  private bytesWritten = 0;
  private frozenQueries = 0;

  // Host State
  private activeSessions = 0;
  private eventLoopBlockedMs = 5;
  private hostCrashed = false;
  private restarts = 0;

  // Context State
  private promptTokens = 400;
  private turn1Tokens = 400;
  private turn10Tokens = 400;
  private signalPct = 99;
  private ttftMs = 85;

  // Network State
  private networkCalls = 0;
  private econreset = 0;
  private rateLimited = 0;
  private poisonAborts = 0;
  private duplicateShipments = 0;
  private duplicateCharges = 0;
  private duplicateDollars = 0;

  // Security State
  private toolCallsAllowed = 0;
  private toolCallsBlocked = 0;
  private injectionAttempts = 0;
  private injectionBlocked = 0;
  private crashesContained = 0;
  private crashesFatal = 0;

  // Recovery State
  private checkpointsWritten = 0;
  private checkpointBytes = 0;
  private stepsReplayed = 0;
  private tokensWasted = 0;
  private orphansLeft = 0;
  private compensationsRun = 0;

  // Economics
  private totalTokens = 0;
  private costUsd = 0;
  private eventLoopFreezes = 0;

  constructor(cfg: MatrixConfig) {
    this.config = structuredClone(cfg);
    this.sim = new Sim(cfg.seed);
    this.rng = new Rng(cfg.seed);
  }

  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;

    this.sim.emit("matrix.started", "sys-0", {
      runId: this.config.runId,
      seed: this.config.seed,
      dials: {
        A: this.config.A,
        B: this.config.B,
        C: this.config.C,
        D: this.config.D,
        E: this.config.E,
        F: this.config.F,
      },
    });

    this.sim.at(10, "workflow.setup", () => {
      this.executeMatrixSimulation();
    });
  }

  step(): boolean {
    if (!this.isStarted) this.start();
    return this.sim.step();
  }

  run(): void {
    if (!this.isStarted) this.start();
    while (this.sim.step()) {
      // step through simulated clock
    }
  }

  reset(): void {
    this.sim = new Sim(this.config.seed);
    this.rng = new Rng(this.config.seed);
    this.isStarted = false;
    this.dbActive = 0;
    this.dbWaitQueue = 0;
    this.dbTimeouts = 0;
    this.saas500s = 0;
    this.bytesWritten = 0;
    this.frozenQueries = 0;
    this.hostCrashed = false;
    this.restarts = 0;
    this.duplicateDollars = 0;
    this.duplicateShipments = 0;
    this.duplicateCharges = 0;
    this.orphansLeft = 0;
    this.compensationsRun = 0;
    this.tokensWasted = 0;
    this.totalTokens = 0;
    this.costUsd = 0;
    this.eventLoopFreezes = 0;
    this.eventLoopBlockedMs = 5;
    this.crashesFatal = 0;
    this.crashesContained = 0;
    this.injectionBlocked = 0;
    this.injectionAttempts = 0;
    this.toolCallsBlocked = 0;
    this.toolCallsAllowed = 0;
  }

  private executeMatrixSimulation(): void {
    const { A, B, C, D, E, F, humanUsers, concurrentAgents, dbPoolSize, workflowSteps } = this.config;

    // --- DIAL A: TRAFFIC LOAD ---
    let effectiveAgents = concurrentAgents;
    let effectiveHumans = humanUsers;
    if (A === "A1_single_task") {
      effectiveAgents = 1;
      effectiveHumans = 0;
    } else if (A === "A3_exec_demo_burst") {
      effectiveAgents = Math.max(5, concurrentAgents);
    } else if (A === "A4_bulk_crm_swarm") {
      effectiveAgents = Math.max(50, concurrentAgents);
    } else if (A === "A5_marathon_30step") {
      effectiveAgents = Math.max(5, concurrentAgents);
    }
    this.activeSessions = effectiveHumans + effectiveAgents;

    // --- DIAL B: DATABASE & STORAGE ---
    if (B === "B1_zero_hold_2ms") {
      this.dbActive = 0;
      this.dbAvgHoldMs = 2;
      this.dbP99HoldMs = 2;
      this.dbCpuPct = 24;
      this.dbRamPct = 28;
      this.dbWaitQueue = 0;
      this.dbTimeouts = 0;
      this.saas500s = 0;
      this.iopsUsed = 4;
      this.bytesWritten = 4096;
      this.frozenQueries = 0;
    } else if (B === "B2_stream_hog_30s") {
      this.dbActive = Math.min(dbPoolSize, effectiveAgents);
      this.dbAvgHoldMs = 28450;
      this.dbP99HoldMs = 28450;
      this.dbCpuPct = 2; // Idle pool during streaming hold paradox
      this.dbRamPct = 35;
      if (effectiveAgents >= dbPoolSize || effectiveHumans > 0) {
        this.dbWaitQueue = Math.max(0, effectiveAgents + (effectiveHumans > 0 ? 14 : 0) - dbPoolSize);
        this.dbTimeouts = Math.max(8, this.dbWaitQueue);
        this.saas500s = effectiveHumans > 0 ? 14 : 0;
      }
      this.iopsUsed = 8;
      this.bytesWritten = 12288;
      this.frozenQueries = 0;
    } else if (B === "B3_write_amp_15mb") {
      this.dbActive = Math.min(dbPoolSize, Math.floor(effectiveAgents / 2));
      this.dbAvgHoldMs = 1200;
      this.dbP99HoldMs = 4500;
      this.dbCpuPct = 65;
      this.dbRamPct = 80;
      this.bytesWritten = 15_000_000;
      this.iopsUsed = 100;
      this.frozenQueries = 1;
      this.saas500s = effectiveHumans > 0 ? 8 : 0;
    } else if (B === "B4_hydration_freeze_4s") {
      this.dbActive = Math.min(dbPoolSize, 5);
      this.dbAvgHoldMs = 3200;
      this.dbP99HoldMs = 4000;
      this.dbCpuPct = 85;
      this.bytesWritten = 20_000_000;
      this.eventLoopBlockedMs = 3200;
      this.eventLoopFreezes = 2;
      this.iopsUsed = 92;
      this.frozenQueries = 1;
      this.saas500s = effectiveHumans > 0 ? 6 : 0;
    } else if (B === "B5_in_doubt_zombie_tx") {
      this.dbActive = Math.min(dbPoolSize, 8);
      this.dbAvgHoldMs = 14000;
      this.dbP99HoldMs = 20000;
      this.dbTimeouts = 5;
      this.dbWaitQueue = 6;
      this.saas500s = effectiveHumans > 0 ? 10 : 0;
      this.bytesWritten = 50000;
      this.iopsUsed = 15;
    }

    // --- DIAL C: NETWORK & EXTERNAL APIS ---
    this.networkCalls = effectiveAgents * workflowSteps;
    if (C === "C1_clean_20ms") {
      this.econreset = 0;
      this.rateLimited = 0;
      this.poisonAborts = 0;
      this.duplicateShipments = 0;
      this.duplicateCharges = 0;
      this.duplicateDollars = 0;
    } else if (C === "C2_socket_drop_2ms_late") {
      this.econreset = 1;
      if (F === "F3_resilient_invariant_runtime") {
        this.duplicateCharges = 0;
        this.duplicateDollars = 0;
      } else {
        this.duplicateCharges = 1;
        this.duplicateDollars = 500;
      }
    } else if (C === "C3_rate_limit_429_brownout") {
      this.rateLimited = Math.max(12, Math.floor(this.networkCalls * 0.25));
    } else if (C === "C4_bulk_50_poison_pill") {
      if (F === "F3_resilient_invariant_runtime") {
        this.poisonAborts = 0; // Unrolled: 49 succeed, 1 isolated poison pill
      } else {
        this.poisonAborts = 49; // All innocent 49 items rejected due to item 27
      }
    } else if (C === "C5_legacy_erp_no_idem") {
      if (F === "F3_resilient_invariant_runtime") {
        this.duplicateShipments = 0; // Deduplicated before dispatch
      } else {
        this.duplicateShipments = 2; // Ships 2 physical boxes on retry
      }
    }

    // --- DIAL D: CONTEXT & SIGNAL PLANE ---
    if (D === "D1_raw_json_80k_flood") {
      this.promptTokens = 80000;
      this.turn1Tokens = 80000;
      this.turn10Tokens = 80000;
      this.signalPct = 1;
      this.ttftMs = 45000;
    } else if (D === "D2_append_only_quadratic") {
      this.turn1Tokens = 500;
      this.turn10Tokens = 42000;
      this.promptTokens = 42000;
      this.signalPct = 12;
      this.ttftMs = 35000;
    } else if (D === "D3_lossy_llm_summary") {
      this.turn1Tokens = 500;
      this.turn10Tokens = 12000;
      this.promptTokens = 12000;
      this.signalPct = 35;
      this.ttftMs = 6500;
    } else if (D === "D4_unmapped_schema_drift") {
      this.turn1Tokens = 800;
      this.turn10Tokens = 8500;
      this.promptTokens = 8500;
      this.signalPct = 40;
      this.ttftMs = 4200;
    } else if (D === "D5_cqrs_duckdb_blackboard_o1") {
      this.turn1Tokens = 178;
      this.turn10Tokens = 227;
      this.promptTokens = 400;
      this.signalPct = 99.5;
      this.ttftMs = 85;
    }

    // --- DIAL E: SECURITY & PROCESS BOUNDARIES ---
    if (E === "E1_god_mode_main_thread") {
      this.toolCallsAllowed = 200;
      this.toolCallsBlocked = 0;
      this.injectionAttempts = 1;
      this.injectionBlocked = 0; // Allowed db.delete(402)
      this.hostCrashed = true;
      this.crashesFatal = 1;
      this.crashesContained = 0;
      this.eventLoopBlockedMs = 1800;
      this.eventLoopFreezes = 3;
    } else if (E === "E2_walled_garden_stuck") {
      this.toolCallsAllowed = 3;
      this.toolCallsBlocked = 14;
      this.injectionAttempts = 0;
      this.injectionBlocked = 0;
      this.hostCrashed = false;
    } else if (E === "E3_hitl_fatigue_global_bool") {
      this.toolCallsAllowed = 80;
      this.toolCallsBlocked = 0;
      this.injectionAttempts = 1;
      this.injectionBlocked = 0;
      this.hostCrashed = false;
    } else if (E === "E4_state_leases_ipc_worker") {
      this.toolCallsAllowed = 4; // strictly scoped JIT lease
      this.toolCallsBlocked = 196; // blocked out-of-scope tools in 1ms
      this.injectionAttempts = 1;
      this.injectionBlocked = 1; // blocked db.delete(402)
      this.hostCrashed = false;
      this.crashesFatal = 0;
      this.crashesContained = 1; // isolated child worker crash rebooted in 5ms
      this.eventLoopBlockedMs = 12;
      this.eventLoopFreezes = 0;
    }

    // --- DIAL F: RECOVERY & UNIT ECONOMICS ---
    if (F === "F1_blind_retry_unbounded_spend") {
      this.checkpointsWritten = 0;
      this.checkpointBytes = 0;
      this.stepsReplayed = workflowSteps;
      this.tokensWasted = 350000;
      this.orphansLeft = 0;
      this.compensationsRun = 0;
      this.totalTokens = 400000;
      this.costUsd = 40.0; // $40 on a $5 ticket
    } else if (F === "F2_ask_llm_to_undo") {
      this.checkpointsWritten = 0;
      this.checkpointBytes = 0;
      this.stepsReplayed = 0;
      this.tokensWasted = 45000;
      this.orphansLeft = 1; // Left orphaned EC2 instance on bill
      this.compensationsRun = 0;
      this.totalTokens = 120000;
      this.costUsd = 12.0;
    } else if (F === "F3_resilient_invariant_runtime") {
      this.checkpointsWritten = workflowSteps;
      this.checkpointBytes = workflowSteps * 136;
      this.stepsReplayed = 0;
      this.tokensWasted = 0;
      this.orphansLeft = 0;
      this.compensationsRun = 4; // LIFO reverse rollback in 4ms
      this.totalTokens = Math.min(5000, workflowSteps * 450);
      this.costUsd = 0.25; // Strict $0.25 execution budget envelope cap
      this.bytesWritten = Math.min(this.bytesWritten, 4096);
    }

    // Emit completed event
    this.sim.emit("matrix.completed", "sys-1", {
      virtualTimeMs: this.sim.now,
      costUsd: this.costUsd,
      totalTokens: this.totalTokens,
    });
  }

  snapshot(): MatrixSnapshot {
    const isResilientMode =
      this.config.B === "B1_zero_hold_2ms" &&
      this.config.D === "D5_cqrs_duckdb_blackboard_o1" &&
      this.config.E === "E4_state_leases_ipc_worker" &&
      this.config.F === "F3_resilient_invariant_runtime";

    const saasPrice = this.config.saasPriceUsd || 20;
    const costPerTenant = this.costUsd / 10;
    const perTenant = TENANT_NAMES.map((tenant) => ({
      tenant,
      revenueUsd: saasPrice,
      costUsd: Number(costPerTenant.toFixed(2)),
      marginUsd: Number((saasPrice - costPerTenant).toFixed(2)),
    }));

    return structuredClone({
      mode: isResilientMode ? "resilient" : "selected",
      config: this.config,
      virtualTimeMs: this.sim.now || 10,
      dials: {
        A: this.config.A,
        B: this.config.B,
        C: this.config.C,
        D: this.config.D,
        E: this.config.E,
        F: this.config.F,
      },
      db: {
        activeConnections: this.dbActive,
        poolSize: this.config.dbPoolSize,
        waitQueue: this.dbWaitQueue,
        timeouts: this.dbTimeouts,
        avgHoldMs: this.dbAvgHoldMs,
        p99HoldMs: this.dbP99HoldMs,
        cpuPct: this.dbCpuPct,
        ramPct: this.dbRamPct,
        saas500s: this.saas500s,
      },
      storage: {
        iopsUsed: this.iopsUsed,
        iopsLimit: this.iopsLimit,
        bytesWritten: this.bytesWritten,
        frozenQueries: this.frozenQueries,
      },
      host: {
        activeSessions: this.activeSessions,
        eventLoopBlockedMs: this.eventLoopBlockedMs,
        crashed: this.hostCrashed,
        restarts: this.restarts,
      },
      context: {
        promptTokens: this.promptTokens,
        turn1Tokens: this.turn1Tokens,
        turn10Tokens: this.turn10Tokens,
        signalPct: this.signalPct,
        ttftMs: this.ttftMs,
      },
      network: {
        calls: this.networkCalls,
        ecnoreset: this.econreset,
        rateLimited: this.rateLimited,
        poisonAborts: this.poisonAborts,
        duplicateShipments: this.duplicateShipments,
        duplicateCharges: this.duplicateCharges,
        duplicateDollars: this.duplicateDollars,
      },
      security: {
        toolCallsAllowed: this.toolCallsAllowed,
        toolCallsBlocked: this.toolCallsBlocked,
        injectionAttempts: this.injectionAttempts,
        injectionBlocked: this.injectionBlocked,
        crashesContained: this.crashesContained,
        crashesFatal: this.crashesFatal,
      },
      recovery: {
        checkpointsWritten: this.checkpointsWritten,
        checkpointBytes: this.checkpointBytes,
        stepsReplayed: this.stepsReplayed,
        tokensWasted: this.tokensWasted,
        orphansLeft: this.orphansLeft,
        compensationsRun: this.compensationsRun,
      },
      economics: {
        totalTokens: this.totalTokens,
        costUsd: this.costUsd,
        perTenant,
      },
      totals: {
        tokensConsumed: this.totalTokens,
        costUsd: this.costUsd,
        duplicateDollars: this.duplicateDollars,
        orphanedCloudCostUsd: this.orphansLeft * 1440,
        storageBytesWritten: this.bytesWritten,
        hostCrashes: this.hostCrashed ? 1 : 0,
        eventLoopFreezes: this.eventLoopFreezes,
        saas500s: this.saas500s,
      },
    });
  }

  exportTrace(): { schema: "sim-trace/0"; simulated: true; virtualTime: true; traceId: string; spans: unknown[]; derived: unknown } {
    return exportTrace(this.sim.log, `matrix-${this.config.runId}-${this.config.seed}`, { snapshot: this.snapshot() });
  }
}

export function runMatrixComparison(config: MatrixConfig): {
  selected: MatrixSnapshot;
  resilient: MatrixSnapshot;
  rootCauses: RootCause[];
  appliedFixes: AppliedFix[];
  valueDelta: ValueDelta;
} {
  // 1. Run Selected Configuration
  const selScenario = new MatrixScenario(config);
  selScenario.run();
  const selected = selScenario.snapshot();

  // 2. Build and Run Resilient Override Counterpart
  const resilientConfig: MatrixConfig = {
    ...config,
    runId: `${config.runId}-resilient`,
    B: "B1_zero_hold_2ms",
    D: "D5_cqrs_duckdb_blackboard_o1",
    E: "E4_state_leases_ipc_worker",
    F: "F3_resilient_invariant_runtime",
    // Dial A, Dial C, seed, and scale parameters are preserved exactly
  };

  const resScenario = new MatrixScenario(resilientConfig);
  resScenario.run();
  const resilient = resScenario.snapshot();

  // 3. Derive Root Causes (for non-resilient dials in selected)
  const rootCauses: RootCause[] = [];
  if (config.B !== "B1_zero_hold_2ms") {
    rootCauses.push({
      dial: "Dial B (Database & Storage)",
      title: "Streaming DB Connection Hold & IOPS Saturation",
      mechanism: `Holding Postgres connections open (${selected.db.avgHoldMs}ms) across LLM token streaming starved pool connections while DB CPU sat at 2%.`,
      businessImpact: `${selected.db.saas500s} paying SaaS customers received HTTP 500 errors during routine checkout/login.`,
    });
  }

  if (config.C !== "C1_clean_20ms") {
    rootCauses.push({
      dial: "Dial C (Network & APIs)",
      title: "Non-Idempotent Network Drop & Bulk Contamination",
      mechanism: `Network socket dropped or API poisoned during state mutation without deterministic write-ahead reconciliation.`,
      businessImpact: `$${selected.network.duplicateDollars} duplicate dollars charged, ${selected.network.duplicateShipments} extra warehouse shipments, or ${selected.network.poisonAborts} aborted tasks.`,
    });
  }

  if (config.D !== "D5_cqrs_duckdb_blackboard_o1") {
    rootCauses.push({
      dial: "Dial D (Context & Signal Plane)",
      title: "Quadratic Prompt Bloat & Context Dilution",
      mechanism: `Pasting un-indexed JSON history (${selected.context.promptTokens} tokens) delayed TTFT by ${selected.context.ttftMs}ms with only ${selected.context.signalPct}% useful signal.`,
      businessImpact: `Critical ACV accounts dropped from context; LLM hallucination rate increased 4x over repeated turns.`,
    });
  }

  if (config.E !== "E1_god_mode_main_thread" && config.E !== "E4_state_leases_ipc_worker") {
    rootCauses.push({
      dial: "Dial E (Security & Process Isolation)",
      title: "Ambient Tool Authority / Over-Restricted Sandbox",
      mechanism: `Broad tool surface exposed without step-gated capability leases or sandbox boundaries.`,
      businessImpact: `Tool parser crashes or injection drift triggered unexpected mutations or workflow failure.`,
    });
  } else if (config.E === "E1_god_mode_main_thread") {
    rootCauses.push({
      dial: "Dial E (Security & Process Isolation)",
      title: "Ambient Authority & Main-Thread Host Crash",
      mechanism: `All 200 tools were exposed on the main Node.js thread; model executed un-gated destructive calls or triggered SIGSEGV.`,
      businessImpact: `Host process crashed, severing ${selected.host.activeSessions} active sessions.`,
    });
  }

  if (config.F !== "F3_resilient_invariant_runtime") {
    rootCauses.push({
      dial: "Dial F (Recovery & Economics)",
      title: "Unbounded Retry Storm & Margin Inversion",
      mechanism: `Blind 10x retries on a shared frontier model key burned $${selected.economics.costUsd.toFixed(2)} on a $${config.ticketValueUsd} task without step checkpoints.`,
      businessImpact: `Inverted SaaS tenant margin to negative; left ${selected.recovery.orphansLeft} orphaned cloud server running on the monthly bill.`,
    });
  }

  // 4. Derive Applied Fixes
  const appliedFixes: AppliedFix[] = [
    {
      dial: "Dial B (Database & Storage)",
      invariantName: "Zero-Hold DB Connection Lease",
      howItWorks: "Borrows connection for 2ms to fetch row, closes connection before token streaming, and executes an isolated 2ms atomic write on completion.",
      codeSnippet: `await withQuickConnection(pool, async (client) => {\n  const row = await client.query("SELECT * FROM state WHERE id=$1", [id]);\n  return cloneToRam(row);\n});\n// Connection is released: 0 connections held during LLM stream`,
      metricDelta: `DB hold dropped from ${selected.db.avgHoldMs}ms to 2ms (0 held during stream; SaaS 500s: 0)`,
    },
    {
      dial: "Dial C (Network & APIs)",
      invariantName: "Deterministic SHA-256 Idempotency & Saga Rollback",
      howItWorks: "Binds canonical SHA-256 idempotency key to local write-ahead log and checks out-of-band GET status before any payment retry.",
      codeSnippet: `const idemKey = sha256(\`\${runId}_\${stepId}_\${amount}\`);\nconst status = await getPaymentStatus(idemKey);\nif (!status.charged) {\n  await postPayment({ idemKey, amount });\n}`,
      metricDelta: `Duplicate charges: $${selected.network.duplicateDollars} -> $0; Orphaned cloud: $${selected.totals.orphanedCloudCostUsd} -> $0`,
    },
    {
      dial: "Dial D (Context & Signal Plane)",
      invariantName: "DuckDB CQRS Blackboard with 250B Claim-Checks",
      howItWorks: "Executes in-memory DuckDB join in 2ms, offloads bulky payloads to S3 claim-checks, and emits bounded 400-token summaries.",
      codeSnippet: `const matches = await duckdb.all(\n  "SELECT c.id, z.ticket FROM c JOIN z ON c.id=z.user_id_v2"\n);\nreturn emitClaimCheck(matches); // 400 tokens instead of 80,000`,
      metricDelta: `Prompt tokens cut from ${selected.context.promptTokens} to 400 (99.5% reduction); TTFT: ${selected.context.ttftMs}ms -> 85ms`,
    },
    {
      dial: "Dial E (Security & Process Isolation)",
      invariantName: "State-Gated Capability Leases & IPC Child Process",
      howItWorks: "Only tools valid for the active state are leased with 5-minute expiry. Tool binaries run in an isolated child worker over IPC.",
      codeSnippet: `const lease = gatekeeper.issueLease(activeStep, tenantId, "5m");\nif (!lease.permits(toolCall)) throw new UnauthorizedToolCall();\nconst result = await ipcWorker.execute(toolCall);`,
      metricDelta: `Blocked destructive mutations in 1ms; contained worker crashes without dropping host process`,
    },
    {
      dial: "Dial F (Recovery & Economics)",
      invariantName: "136B Step Checkpoints & $0.25 Execution Budget Envelope",
      howItWorks: "Persists compact 136-byte checkpoints on every turn; cascades routine steps to lightweight models and halts execution if budget cap is reached.",
      codeSnippet: `ledger.recordCheckpoint({ step, hash, deltaBytes: 136 });\nif (inFlightCost > 0.25) return gracefulHandoff();`,
      metricDelta: `Task cost: $${selected.economics.costUsd.toFixed(2)} -> $0.25; Wasted replay tokens: ${selected.recovery.tokensWasted} -> 0`,
    },
  ];

  // 5. Compute Value Delta & ROI
  const brokenMonthlyLeak = Math.round(
    selected.totals.duplicateDollars * 20 +
      selected.totals.orphanedCloudCostUsd +
      selected.totals.saas500s * 150 +
      (selected.economics.costUsd - resilient.economics.costUsd) * 400
  );
  const resilientMonthlyCost = Math.round(resilient.economics.costUsd * 400);
  const netMonthlySavings = Math.max(0, brokenMonthlyLeak - resilientMonthlyCost);
  const annualizedSavings = netMonthlySavings * 12;
  const engagementCostUsd = 15000;
  const paybackDays = netMonthlySavings > 0 ? Math.round((engagementCostUsd / netMonthlySavings) * 30) : 365;

  return {
    selected,
    resilient,
    rootCauses,
    appliedFixes,
    valueDelta: {
      brokenMonthlyLeak,
      resilientMonthlyCost,
      netMonthlySavings,
      annualizedSavings,
      engagementCostUsd,
      paybackDays,
    },
  };
}
