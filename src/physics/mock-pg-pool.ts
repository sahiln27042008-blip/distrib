import type { Sim } from "../kernel.ts";

export type HoldMode =
  | "zero_hold_2ms"
  | "stream_hog_30s"
  | "write_amp_15mb"
  | "hydration_freeze_4s"
  | "in_doubt_zombie_tx";

export interface PoolDialConfig {
  holdMode?: HoldMode;
  writeAmpBytes?: number;
}

// Structural waiter: compatible with chaos.ts's Waiter without importing it.
export interface PoolWaiter {
  token: string;
  requestedAt: number;
  acquiredAt?: number;
  active: boolean;
  workflow?: unknown;
}

export interface PoolStats {
  capacity: number;
  queueCapacity: number;
  activeConnections: number;
  peakActiveConnections: number;
  poolAcquisitionTimeouts: number;
  totalHoldMs: number;
  avgHoldMs: number;
  p99HoldMs: number;
  bytesWritten: number;
  frozenQueries: number;
}

const DEFAULT_WRITE_AMP_BYTES = 15_000_000;
const HOLD_MS: Partial<Record<HoldMode, number>> = {
  zero_hold_2ms: 2,
  stream_hog_30s: 28450,
  hydration_freeze_4s: 4000,
  in_doubt_zombie_tx: 30000,
};

export class MockPgPool<W extends PoolWaiter = PoolWaiter> {
  readonly capacity: number;
  readonly queueCapacity: number;
  readonly dialConfig: PoolDialConfig | undefined;
  activeConnections = 0;
  peakActiveConnections = 0;
  poolAcquisitionTimeouts = 0;
  totalHoldMs = 0;
  bytesWritten = 0;
  frozenQueries = 0;
  readonly holdSamples: number[] = [];
  readonly waiting: W[] = [];
  readonly active = new Map<string, W>();

  constructor(capacity: number, queueCapacity: number, dialConfig?: PoolDialConfig) {
    this.capacity = capacity;
    this.queueCapacity = queueCapacity;
    this.dialConfig = dialConfig;
  }

  acquire(waiter: W): "acquired" | "queued" | "full" {
    if (this.activeConnections < this.capacity) {
      this.activate(waiter);
      return "acquired";
    }
    if (this.waiting.length >= this.queueCapacity) return "full";
    this.waiting.push(waiter);
    return "queued";
  }

  activate(waiter: W, now: number = waiter.requestedAt): void {
    waiter.active = true;
    waiter.acquiredAt = now;
    this.active.set(waiter.token, waiter);
    this.activeConnections += 1;
    this.peakActiveConnections = Math.max(this.peakActiveConnections, this.activeConnections);
    const mode = this.dialConfig?.holdMode;
    if (mode === "write_amp_15mb") this.bytesWritten += this.dialConfig?.writeAmpBytes ?? DEFAULT_WRITE_AMP_BYTES;
    else if (mode === "in_doubt_zombie_tx") this.frozenQueries += 1;
  }

  removeWaiting(waiter: W): boolean {
    const index = this.waiting.indexOf(waiter);
    if (index < 0) return false;
    this.waiting.splice(index, 1);
    return true;
  }

  release(waiter: W, now: number): number {
    if (!this.active.delete(waiter.token)) return 0;
    waiter.active = false;
    this.activeConnections -= 1;
    const heldMs = now - (waiter.acquiredAt ?? waiter.requestedAt);
    this.totalHoldMs += heldMs;
    this.holdSamples.push(heldMs);
    return heldMs;
  }

  // Hold duration the caller should schedule release after. Identity when no holdMode is set.
  holdFor(defaultMs: number): number {
    const mode = this.dialConfig?.holdMode;
    if (mode === undefined) return defaultMs;
    return HOLD_MS[mode] ?? defaultMs;
  }

  get avgHoldMs(): number {
    return this.holdSamples.length === 0 ? 0 : this.totalHoldMs / this.holdSamples.length;
  }

  // Nearest-rank p99 over per-release hold times.
  get p99HoldMs(): number {
    if (this.holdSamples.length === 0) return 0;
    const sorted = [...this.holdSamples].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(0.99 * sorted.length) - 1)]!;
  }

  getStats(): PoolStats {
    return {
      capacity: this.capacity,
      queueCapacity: this.queueCapacity,
      activeConnections: this.activeConnections,
      peakActiveConnections: this.peakActiveConnections,
      poolAcquisitionTimeouts: this.poolAcquisitionTimeouts,
      totalHoldMs: this.totalHoldMs,
      avgHoldMs: this.avgHoldMs,
      p99HoldMs: this.p99HoldMs,
      bytesWritten: this.bytesWritten,
      frozenQueries: this.frozenQueries,
    };
  }

  // Feeds auditor rule R11: one db.write event (exported as a span) with cumulative bytesWritten.
  emitTraceSpans(sim: Sim, parentEventId?: string): void {
    if (this.bytesWritten <= 0) return;
    sim.emit(
      "db.write",
      "mock-pg-pool",
      {
        table: "agent_state",
        op: "write",
        step_type: "storage_write",
        payload_size: this.bytesWritten,
        storage_class: "primary",
        offloaded: false,
      },
      parentEventId,
    );
  }
}
