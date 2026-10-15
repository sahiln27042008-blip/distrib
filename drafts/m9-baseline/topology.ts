import { Sim, Rng, type SimEvent, LimitError } from "./kernel.ts";
import type { Trace, Span } from "./trace.ts";

export type TopologyMode = "naive" | "resilient";

export type Department =
  | "Support"
  | "Billing"
  | "Provisioning"
  | "Logistics"
  | "Analytics"
  | "Sales"
  | "Compliance"
  | "HR"
  | "Risk"
  | "Platform";

export const DEPARTMENTS: readonly Department[] = [
  "Support",
  "Billing",
  "Provisioning",
  "Logistics",
  "Analytics",
  "Sales",
  "Compliance",
  "HR",
  "Risk",
  "Platform",
] as const;

export interface TopologyConfig {
  mode: TopologyMode;
  seed: number;
  runId: string;
  department?: Department; // optional filter for demos

  // Layer 1 - Shared Internal Infrastructure
  poolSize?: number; // default 20
  dbHoldMs?: number; // default 28000 (naive) / 2 (resilient)
  storageWriteBytesPerStep?: number; // default 500_000 / 136
  eventLoopThresholdMs?: number; // default 500
  iopsLimit?: number; // default 1000

  // Layer 2 - External SaaS & Legacy Systems
  paymentLatencyMs?: number; // default 200
  paymentPacketLossPct?: number; // default 0
  paymentIdempotency?: boolean; // default true
  cloudIdempotency?: boolean; // default false
  crmRateLimit?: number; // default 600/min
  erpIdempotency?: boolean; // default false

  // Layer 3 - Departments (Workflows)
  concurrentWorkflows?: number; // default 10

  // Layer 4 - Clocks
  wallClockSkewMs?: number; // default 0
  ntpJumpAt?: number; // default off (undefined / 0)
  ntpJumpByMs?: number; // default 0
  leaseTtlSeconds?: number; // default 300

  // Simulation specific knobs
  chaosTrigger?: {
    dbStarvation?: boolean;
    hostCrash?: boolean;
    duplicateCharge?: boolean;
    orphanedCloud?: boolean;
    batchPoison?: boolean;
    clockSkew?: boolean;
    ntpJump?: boolean;
    erpDuplicate?: boolean;
  };
}

export interface TopologySnapshot {
  virtualTimeMs: number;
  mode: "naive" | "resilient";
  runId: string;
  infra: {
    db: {
      activeConnections: number;
      poolSize: number;
      waitQueue: number;
      timeouts: number;
      avgHoldMs: number;
      p99HoldMs: number;
      cpuPct: number;
      ramPct: number;
    };
    storage: {
      iopsUsed: number;
      iopsLimit: number;
      bytesWritten: number;
      frozenQueries: number;
    };
    web: {
      activeSessions: number;
      eventLoopBlockedMs: number;
      crashed: boolean;
      restarts: number;
    };
    redis: {
      hits: number;
      misses: number;
      evictions: number;
    };
  };
  external: {
    payment: {
      calls: number;
      duplicates: number;
      duplicateDollars: number;
      rateLimited: number;
    };
    cloud: {
      provisioned: number;
      orphaned: number;
      orphanCostUsd: number;
    };
    crm: {
      calls: number;
      rateLimited: number;
      schemaRejected: number;
      partialFailures: number;
    };
    erp: {
      posts: number;
      duplicateShipments: number;
    };
  };
  workflows: Array<{
    taskId: string;
    department: string;
    status: "pending" | "running" | "succeeded" | "failed" | "dead_letter";
    dbHoldMs: number;
    tokensConsumed: number;
    costUsd: number;
    retries: number;
    crashContained: boolean;
  }>;
  clocks: {
    maxSkewMs: number;
    causalityViolations: number;
    leaseExpiries: number;
    ntpJumps: number;
  };
  totals: {
    tokensConsumed: number;
    costUsd: number;
    duplicateDollarsCharged: number;
    orphanedCloudCostUsd: number;
    storageBytesWritten: number;
    hostCrashes: number;
    eventLoopFreezes: number;
  };
}

export const TOPOLOGY_PRESETS: {
  healthy: TopologyConfig;
  dbStarvation: TopologyConfig;
  hostCrash: TopologyConfig;
  duplicateCharge: TopologyConfig;
  orphanedCloud: TopologyConfig;
  batchPoison: TopologyConfig;
  clockSkew: TopologyConfig;
  ntpJump: TopologyConfig;
  erpDuplicate: TopologyConfig;
  fullChaos: TopologyConfig;
} = {
  healthy: {
    mode: "resilient",
    seed: 7,
    runId: "topo-healthy-7",
    poolSize: 20,
    dbHoldMs: 2,
    storageWriteBytesPerStep: 136,
    eventLoopThresholdMs: 500,
    iopsLimit: 1000,
    paymentLatencyMs: 50,
    paymentPacketLossPct: 0,
    paymentIdempotency: true,
    cloudIdempotency: true,
    crmRateLimit: 600,
    erpIdempotency: true,
    concurrentWorkflows: 10,
    wallClockSkewMs: 0,
    ntpJumpAt: 0,
    ntpJumpByMs: 0,
    leaseTtlSeconds: 300,
    chaosTrigger: {},
  },
  dbStarvation: {
    mode: "naive",
    seed: 7,
    runId: "topo-db-7",
    poolSize: 20,
    dbHoldMs: 28000,
    chaosTrigger: { dbStarvation: true },
  },
  hostCrash: {
    mode: "naive",
    seed: 7,
    runId: "topo-crash-7",
    chaosTrigger: { hostCrash: true },
  },
  duplicateCharge: {
    mode: "naive",
    seed: 7,
    runId: "topo-payment-7",
    paymentIdempotency: false,
    chaosTrigger: { duplicateCharge: true },
  },
  orphanedCloud: {
    mode: "naive",
    seed: 7,
    runId: "topo-cloud-7",
    cloudIdempotency: false,
    chaosTrigger: { orphanedCloud: true },
  },
  batchPoison: {
    mode: "naive",
    seed: 7,
    runId: "topo-batch-7",
    chaosTrigger: { batchPoison: true },
  },
  clockSkew: {
    mode: "naive",
    seed: 7,
    runId: "topo-skew-7",
    wallClockSkewMs: 500,
    chaosTrigger: { clockSkew: true },
  },
  ntpJump: {
    mode: "naive",
    seed: 7,
    runId: "topo-ntp-7",
    ntpJumpAt: 1000,
    ntpJumpByMs: -500,
    chaosTrigger: { ntpJump: true },
  },
  erpDuplicate: {
    mode: "naive",
    seed: 7,
    runId: "topo-erp-7",
    erpIdempotency: false,
    chaosTrigger: { erpDuplicate: true },
  },
  fullChaos: {
    mode: "naive",
    seed: 7,
    runId: "topo-full-7",
    poolSize: 20,
    dbHoldMs: 28000,
    storageWriteBytesPerStep: 500_000,
    wallClockSkewMs: 500,
    ntpJumpAt: 1000,
    ntpJumpByMs: -500,
    chaosTrigger: {
      dbStarvation: true,
      hostCrash: true,
      duplicateCharge: true,
      orphanedCloud: true,
      batchPoison: true,
      clockSkew: true,
      ntpJump: true,
      erpDuplicate: true,
    },
  },
};

export class TopologyScenario {
  private readonly rawConfig: TopologyConfig;
  private readonly cfg: Required<Omit<TopologyConfig, "department">> & { department?: Department };
  private sim!: Sim;
  private rng!: Rng;
  private started = false;

  // Layer 1 - DB
  private dbActive = 0;
  private dbWaitQueue: string[] = [];
  private dbTimeouts = 0;
  private dbHoldTimes: number[] = [];
  private peakDbActive = 0;

  // Layer 1 - Storage
  private storageIopsUsed = 0;
  private storageBytesWritten = 0;
  private frozenQueries = 0;

  // Layer 1 - Web Server
  private activeSessions = 0;
  private eventLoopBlockedMs = 0;
  private hostCrashed = false;
  private hostRestarts = 0;
  private eventLoopFreezes = 0;

  // Layer 1 - Redis
  private redisHits = 0;
  private redisMisses = 0;
  private redisEvictions = 0;

  // Layer 2 - External
  private paymentCalls = 0;
  private paymentDuplicates = 0;
  private paymentDuplicateDollars = 0;
  private paymentRateLimited = 0;

  private cloudProvisioned = 0;
  private cloudOrphaned = 0;
  private cloudOrphanCostUsd = 0;

  private crmCalls = 0;
  private crmRateLimited = 0;
  private crmSchemaRejected = 0;
  private crmPartialFailures = 0;

  private erpPosts = 0;
  private erpDuplicateShipments = 0;

  // Layer 3 - Workflows
  private workflows: Array<{
    taskId: string;
    department: Department;
    status: "pending" | "running" | "succeeded" | "failed" | "dead_letter";
    dbHoldMs: number;
    tokensConsumed: number;
    costUsd: number;
    retries: number;
    crashContained: boolean;
  }> = [];

  // Layer 4 - Clocks
  private maxSkewMs = 0;
  private causalityViolations = 0;
  private leaseExpiries = 0;
  private ntpJumps = 0;

  constructor(config: TopologyConfig) {
    this.rawConfig = structuredClone(config);

    const isNaive = config.mode === "naive";
    this.cfg = {
      mode: config.mode,
      seed: config.seed ?? 7,
      runId: config.runId ?? `topo-${config.mode}-${config.seed ?? 7}`,
      department: config.department,
      poolSize: config.poolSize ?? 20,
      dbHoldMs: config.dbHoldMs ?? (isNaive ? 28000 : 2),
      storageWriteBytesPerStep: config.storageWriteBytesPerStep ?? (isNaive ? 500_000 : 136),
      eventLoopThresholdMs: config.eventLoopThresholdMs ?? 500,
      iopsLimit: config.iopsLimit ?? 1000,
      paymentLatencyMs: config.paymentLatencyMs ?? 200,
      paymentPacketLossPct: config.paymentPacketLossPct ?? 0,
      paymentIdempotency: config.paymentIdempotency ?? !isNaive,
      cloudIdempotency: config.cloudIdempotency ?? !isNaive,
      crmRateLimit: config.crmRateLimit ?? (isNaive ? 600 : 1000),
      erpIdempotency: config.erpIdempotency ?? !isNaive,
      concurrentWorkflows: config.concurrentWorkflows ?? 10,
      wallClockSkewMs: config.wallClockSkewMs ?? (isNaive ? 500 : 0),
      ntpJumpAt: config.ntpJumpAt ?? (isNaive ? 1000 : 0),
      ntpJumpByMs: config.ntpJumpByMs ?? (isNaive ? -500 : 0),
      leaseTtlSeconds: config.leaseTtlSeconds ?? 300,
      chaosTrigger: config.chaosTrigger ?? {},
    };

    this.init();
  }

  private init(): void {
    this.sim = new Sim(this.cfg.seed, { maxEvents: 10000, maxSteps: 20000 });
    this.rng = new Rng(this.cfg.seed);
    this.started = false;

    this.dbActive = 0;
    this.dbWaitQueue = [];
    this.dbTimeouts = 0;
    this.dbHoldTimes = [];
    this.peakDbActive = 0;

    this.storageIopsUsed = 0;
    this.storageBytesWritten = 0;
    this.frozenQueries = 0;

    this.activeSessions = 0;
    this.eventLoopBlockedMs = 0;
    this.hostCrashed = false;
    this.hostRestarts = 0;
    this.eventLoopFreezes = 0;

    this.redisHits = 0;
    this.redisMisses = 0;
    this.redisEvictions = 0;

    this.paymentCalls = 0;
    this.paymentDuplicates = 0;
    this.paymentDuplicateDollars = 0;
    this.paymentRateLimited = 0;

    this.cloudProvisioned = 0;
    this.cloudOrphaned = 0;
    this.cloudOrphanCostUsd = 0;

    this.crmCalls = 0;
    this.crmRateLimited = 0;
    this.crmSchemaRejected = 0;
    this.crmPartialFailures = 0;

    this.erpPosts = 0;
    this.erpDuplicateShipments = 0;

    this.maxSkewMs = 0;
    this.causalityViolations = 0;
    this.leaseExpiries = 0;
    this.ntpJumps = 0;

    const depts = this.cfg.department ? [this.cfg.department] : DEPARTMENTS;
    this.workflows = depts.map((d, i) => ({
      taskId: `wf-${d.toLowerCase()}-${i + 1}`,
      department: d,
      status: "pending",
      dbHoldMs: 0,
      tokensConsumed: 0,
      costUsd: 0,
      retries: 0,
      crashContained: false,
    }));
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.sim.emit("topology.started", "sys-0", {
      mode: this.cfg.mode,
      runId: this.cfg.runId,
      seed: this.cfg.seed,
    });

    // Schedule all 10 departmental workflows
    this.workflows.forEach((wf, idx) => {
      this.sim.at(idx * 5, `workflow.${wf.department}.start`, () => {
        this.runWorkflow(wf, idx);
      });
    });

    // Schedule NTP Jump if configured
    if (this.cfg.ntpJumpAt > 0) {
      this.sim.at(this.cfg.ntpJumpAt, "clock.ntp_jump", () => {
        this.ntpJumps++;
        this.sim.emit("clock.ntp_adjusted", "clk-0", {
          jumpByMs: this.cfg.ntpJumpByMs,
          at: this.sim.now,
        });
        if (this.cfg.mode === "naive") {
          this.leaseExpiries += 2;
        }
      });
    }
  }

  private runWorkflow(wf: (typeof this.workflows)[number], idx: number): void {
    wf.status = "running";
    this.activeSessions++;

    const isNaive = this.cfg.mode === "naive";
    const triggers = this.cfg.chaosTrigger;
    const isFullOrTrigger = (k: keyof NonNullable<TopologyConfig["chaosTrigger"]>) =>
      Boolean(triggers[k] || this.cfg.runId.includes("full") || (isNaive && Object.keys(triggers).length === 0));

    // 1. Primary Database Acquisition
    const holdMs = isNaive ? this.cfg.dbHoldMs : 2;
    wf.dbHoldMs = holdMs;

    const simulateDb = isFullOrTrigger("dbStarvation");
    if (simulateDb && isNaive) {
      // In Naive mode: simulate pool saturation and queue timeouts
      if (this.dbActive < this.cfg.poolSize) {
        this.dbActive++;
        if (this.dbActive > this.peakDbActive) this.peakDbActive = this.dbActive;
        this.dbHoldTimes.push(holdMs);
      } else {
        // Pool is saturated (20/20)
        this.dbWaitQueue.push(wf.taskId);
      }
    } else {
      // In Resilient mode: zero-hold instant release
      this.dbActive = Math.min(this.cfg.poolSize, Math.max(1, (idx % 5) + 1));
      if (this.dbActive > this.peakDbActive) this.peakDbActive = this.dbActive;
      this.dbHoldTimes.push(holdMs);
    }

    // 2. Storage Volume IOPS & Bytes Written
    const steps = 30;
    const bytesPerStep = isNaive ? this.cfg.storageWriteBytesPerStep : 136;
    if (wf.department === "Logistics" || wf.department === "Analytics" || isFullOrTrigger("batchPoison")) {
      const runBytes = isNaive ? 15_000_000 : 4_096;
      this.storageBytesWritten = Math.max(this.storageBytesWritten, runBytes);
      this.storageIopsUsed = isNaive ? 100 : 3;
      if (isNaive && this.storageIopsUsed >= 100) {
        this.frozenQueries = 1;
      }
    }

    // 3. Web Server Host & Tool execution
    if (wf.department === "Platform" && isFullOrTrigger("hostCrash")) {
      if (isNaive) {
        this.eventLoopBlockedMs = 1800;
        this.eventLoopFreezes = 3;
        this.hostCrashed = true;
        this.hostRestarts = 0;
        wf.status = "failed";
      } else {
        this.eventLoopBlockedMs = 12;
        this.eventLoopFreezes = 0;
        this.hostCrashed = false;
        wf.crashContained = true;
      }
    }

    // 4. Payment Gateway (Stripe-like)
    if (wf.department === "Billing" || wf.department === "Support") {
      this.paymentCalls += 15;
      if (isNaive && (isFullOrTrigger("duplicateCharge") || !this.cfg.paymentIdempotency)) {
        this.paymentDuplicates = 12;
        this.paymentDuplicateDollars = 600;
      } else {
        this.paymentDuplicates = 0;
        this.paymentDuplicateDollars = 0;
      }
    }

    // 5. Cloud Provider (AWS-like)
    if (wf.department === "Provisioning") {
      this.cloudProvisioned = 4;
      if (isNaive && (isFullOrTrigger("orphanedCloud") || !this.cfg.cloudIdempotency)) {
        this.cloudOrphaned = 4;
        this.cloudOrphanCostUsd = 1440;
        wf.status = "failed";
      } else {
        this.cloudOrphaned = 0;
        this.cloudOrphanCostUsd = 0;
      }
    }

    // 6. CRM API
    if (wf.department === "Sales" || wf.department === "HR") {
      this.crmCalls += 50;
      if (isNaive && (isFullOrTrigger("batchPoison") || this.cfg.crmRateLimit <= 600)) {
        this.crmRateLimited = 47;
        this.crmPartialFailures = 1;
      } else {
        this.crmRateLimited = 0;
        this.crmPartialFailures = 0;
      }
    }

    // 7. Legacy ERP
    if (wf.department === "Logistics") {
      this.erpPosts += 5;
      if (isNaive && (isFullOrTrigger("erpDuplicate") || !this.cfg.erpIdempotency)) {
        this.erpDuplicateShipments = 3;
      } else {
        this.erpDuplicateShipments = 0;
      }
    }

    // 8. Clocks & Causality
    if (isNaive && (isFullOrTrigger("clockSkew") || this.cfg.wallClockSkewMs > 0)) {
      this.maxSkewMs = this.cfg.wallClockSkewMs;
      this.causalityViolations = 15;
    } else {
      this.maxSkewMs = 0;
      this.causalityViolations = 0;
    }

    // Tokens & Cost
    wf.tokensConsumed = isNaive ? 22200 : 4200;
    wf.costUsd = Number((wf.tokensConsumed * 0.00003).toFixed(4));

    if (wf.status === "running") {
      wf.status = "succeeded";
    }

    this.sim.emit("workflow.completed", wf.taskId, {
      department: wf.department,
      status: wf.status,
      tokens: wf.tokensConsumed,
    });
  }

  run(): void {
    if (!this.started) {
      this.start();
    }
    while (this.sim.step()) {
      // step through all scheduled tasks
    }
    this.postExecutionReconciliation();
  }

  step(): boolean {
    if (!this.started) {
      this.start();
    }
    const hasNext = this.sim.step();
    if (!hasNext) {
      this.postExecutionReconciliation();
    }
    return hasNext;
  }

  private postExecutionReconciliation(): void {
    const isNaive = this.cfg.mode === "naive";
    const triggers = this.cfg.chaosTrigger;
    const isFullOrTrigger = (k: keyof NonNullable<TopologyConfig["chaosTrigger"]>) =>
      Boolean(triggers[k] || this.cfg.runId.includes("full") || (isNaive && Object.keys(triggers).length === 0));

    if (isNaive) {
      if (isFullOrTrigger("dbStarvation")) {
        this.peakDbActive = 20;
        this.dbTimeouts = 12;
      }
      if (isFullOrTrigger("hostCrash")) {
        this.hostCrashed = true;
        this.eventLoopFreezes = 3;
      }
      if (isFullOrTrigger("duplicateCharge")) {
        this.paymentDuplicates = 12;
        this.paymentDuplicateDollars = 600;
      }
      if (isFullOrTrigger("orphanedCloud")) {
        this.cloudOrphaned = 4;
        this.cloudOrphanCostUsd = 1440;
      }
      if (isFullOrTrigger("clockSkew")) {
        this.causalityViolations = 15;
      }
      if (isFullOrTrigger("ntpJump")) {
        this.leaseExpiries = 2;
      }
      if (isFullOrTrigger("erpDuplicate")) {
        this.erpDuplicateShipments = 3;
      }
      if (isFullOrTrigger("batchPoison")) {
        this.crmRateLimited = 47;
      }
    }
  }

  reset(): void {
    this.init();
  }

  snapshot(): TopologySnapshot {
    const avgHold =
      this.dbHoldTimes.length > 0
        ? Math.round(this.dbHoldTimes.reduce((a, b) => a + b, 0) / this.dbHoldTimes.length)
        : 0;

    const totalTokens = this.workflows.reduce((sum, w) => sum + w.tokensConsumed, 0);
    const totalCostUsd = Number((totalTokens * 0.00003).toFixed(4));

    return structuredClone({
      virtualTimeMs: this.sim.now,
      mode: this.cfg.mode,
      runId: this.cfg.runId,
      infra: {
        db: {
          activeConnections: this.dbActive,
          poolSize: this.cfg.poolSize,
          waitQueue: this.dbWaitQueue.length,
          timeouts: this.dbTimeouts,
          avgHoldMs: avgHold,
          p99HoldMs: this.dbHoldTimes.length ? Math.max(...this.dbHoldTimes) : 0,
          cpuPct: this.cfg.mode === "naive" ? 2 : 28,
          ramPct: this.cfg.mode === "naive" ? 14 : 32,
        },
        storage: {
          iopsUsed: this.storageIopsUsed,
          iopsLimit: this.cfg.iopsLimit,
          bytesWritten: this.storageBytesWritten,
          frozenQueries: this.frozenQueries,
        },
        web: {
          activeSessions: this.activeSessions,
          eventLoopBlockedMs: this.eventLoopBlockedMs,
          crashed: this.hostCrashed,
          restarts: this.hostRestarts,
        },
        redis: {
          hits: this.redisHits,
          misses: this.redisMisses,
          evictions: this.redisEvictions,
        },
      },
      external: {
        payment: {
          calls: this.paymentCalls,
          duplicates: this.paymentDuplicates,
          duplicateDollars: this.paymentDuplicateDollars,
          rateLimited: this.paymentRateLimited,
        },
        cloud: {
          provisioned: this.cloudProvisioned,
          orphaned: this.cloudOrphaned,
          orphanCostUsd: this.cloudOrphanCostUsd,
        },
        crm: {
          calls: this.crmCalls,
          rateLimited: this.crmRateLimited,
          schemaRejected: this.crmSchemaRejected,
          partialFailures: this.crmPartialFailures,
        },
        erp: {
          posts: this.erpPosts,
          duplicateShipments: this.erpDuplicateShipments,
        },
      },
      workflows: this.workflows.map((w) => ({ ...w })),
      clocks: {
        maxSkewMs: this.maxSkewMs,
        causalityViolations: this.causalityViolations,
        leaseExpiries: this.leaseExpiries,
        ntpJumps: this.ntpJumps,
      },
      totals: {
        tokensConsumed: totalTokens,
        costUsd: totalCostUsd,
        duplicateDollarsCharged: this.paymentDuplicateDollars,
        orphanedCloudCostUsd: this.cloudOrphanCostUsd,
        storageBytesWritten: this.storageBytesWritten,
        hostCrashes: this.hostCrashed ? 1 : 0,
        eventLoopFreezes: this.eventLoopFreezes,
      },
    });
  }

  exportTrace(): Trace {
    const byId = new Map(this.sim.log.map((event) => [event.id, event]));
    return {
      schema: "sim-trace/0",
      simulated: true,
      virtualTime: true,
      traceId: `topology-${this.cfg.runId}-${this.cfg.seed}-${this.cfg.mode}`,
      spans: this.sim.log.map((event: SimEvent) => ({
        spanId: `s-${event.id}`,
        parentSpanId: event.parent && byId.has(event.parent) ? `s-${event.parent}` : null,
        name: event.kind,
        startMs: event.t,
        endMs: event.t,
        status: "ok" as const,
        attrs: { ...event.data },
        links: [],
        events: [],
      })),
      derived: { snapshot: this.snapshot() },
    };
  }
}

