import test from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../../src/kernel.ts";
import { exportTrace } from "../../src/trace.ts";
import { MockPgPool, type PoolDialConfig, type PoolWaiter } from "../../src/physics/mock-pg-pool.ts";

// Frozen copy of the original chaos.ts MockPgPool, used as the parity reference.
class ReferencePool {
  readonly capacity: number;
  readonly queueCapacity: number;
  activeConnections = 0;
  peakActiveConnections = 0;
  poolAcquisitionTimeouts = 0;
  totalHoldMs = 0;
  readonly waiting: PoolWaiter[] = [];
  readonly active = new Map<string, PoolWaiter>();
  constructor(capacity: number, queueCapacity: number) {
    this.capacity = capacity;
    this.queueCapacity = queueCapacity;
  }
  acquire(w: PoolWaiter): "acquired" | "queued" | "full" {
    if (this.activeConnections < this.capacity) {
      this.activate(w);
      return "acquired";
    }
    if (this.waiting.length >= this.queueCapacity) return "full";
    this.waiting.push(w);
    return "queued";
  }
  activate(w: PoolWaiter, now: number = w.requestedAt): void {
    w.active = true;
    w.acquiredAt = now;
    this.active.set(w.token, w);
    this.activeConnections += 1;
    this.peakActiveConnections = Math.max(this.peakActiveConnections, this.activeConnections);
  }
  removeWaiting(w: PoolWaiter): boolean {
    const i = this.waiting.indexOf(w);
    if (i < 0) return false;
    this.waiting.splice(i, 1);
    return true;
  }
  release(w: PoolWaiter, now: number): number {
    if (!this.active.delete(w.token)) return 0;
    w.active = false;
    this.activeConnections -= 1;
    const held = now - (w.acquiredAt ?? w.requestedAt);
    this.totalHoldMs += held;
    return held;
  }
}

const mk = (token: string, requestedAt = 0): PoolWaiter => ({ token, requestedAt, active: false });

interface PoolLike {
  acquire(w: PoolWaiter): "acquired" | "queued" | "full";
  activate(w: PoolWaiter, now?: number): void;
  removeWaiting(w: PoolWaiter): boolean;
  release(w: PoolWaiter, now: number): number;
  activeConnections: number;
  peakActiveConnections: number;
  poolAcquisitionTimeouts: number;
  totalHoldMs: number;
  waiting: PoolWaiter[];
  active: Map<string, PoolWaiter>;
}

function state(p: PoolLike) {
  return {
    activeConnections: p.activeConnections,
    peakActiveConnections: p.peakActiveConnections,
    poolAcquisitionTimeouts: p.poolAcquisitionTimeouts,
    totalHoldMs: p.totalHoldMs,
    waiting: p.waiting.map((w) => w.token),
    active: [...p.active.keys()],
  };
}

// One acquire -> hold -> release cycle in virtual time.
function cycle(sim: Sim, pool: MockPgPool, token: string, defaultHoldMs = 100): number {
  const w = mk(token, sim.now);
  assert.equal(pool.acquire(w), "acquired");
  let held = -1;
  sim.at(pool.holdFor(defaultHoldMs), `release:${token}`, () => {
    held = pool.release(w, sim.now);
  });
  while (sim.step());
  return held;
}

test("default constructor matches original MockPgPool semantics", () => {
  const run = (p: PoolLike) => {
    const trace: unknown[] = [];
    const [a, b, c, d, e] = [mk("a", 0), mk("b", 5), mk("c", 10), mk("d", 15), mk("e", 20)] as const;
    trace.push(p.acquire(a), p.acquire(b), p.acquire(c), p.acquire(d), p.acquire(e));
    trace.push(state(p));
    trace.push(p.release(a, 50));
    trace.push(p.removeWaiting(d), p.removeWaiting(d));
    const next = p.waiting.shift()!;
    p.activate(next, 60);
    trace.push(state(p));
    trace.push(p.release(b, 90), p.release(b, 95), p.release(c, 120));
    trace.push(state(p));
    return trace;
  };
  const ref = run(new ReferencePool(2, 2) as PoolLike);
  assert.deepEqual(run(new MockPgPool(2, 2)), ref);
  assert.deepEqual(run(new MockPgPool(2, 2, {})), ref);
  assert.deepEqual(run(new MockPgPool(2, 2, { writeAmpBytes: 1 })), ref);
  const p = new MockPgPool(2, 2);
  assert.equal(p.holdFor(123), 123);
  assert.equal(p.bytesWritten, 0);
  assert.equal(p.frozenQueries, 0);
});

test("zero_hold_2ms: avgHoldMs ~ 2 after 10 cycles", () => {
  const sim = new Sim(1);
  const pool = new MockPgPool(2, 2, { holdMode: "zero_hold_2ms" });
  for (let i = 0; i < 10; i++) cycle(sim, pool, `t${i}`);
  assert.ok(Math.abs(pool.getStats().avgHoldMs - 2) < 0.001);
  assert.equal(pool.getStats().p99HoldMs, 2);
});

test("stream_hog_30s: avgHoldMs > 28000 after 1 cycle", () => {
  const sim = new Sim(1);
  const pool = new MockPgPool(2, 2, { holdMode: "stream_hog_30s" });
  cycle(sim, pool, "t0");
  assert.ok(pool.getStats().avgHoldMs > 28000);
  assert.equal(pool.getStats().avgHoldMs, 28450);
});

test("write_amp_15mb: bytesWritten and db.write span", () => {
  const sim = new Sim(1);
  const pool = new MockPgPool(2, 2, { holdMode: "write_amp_15mb" });
  cycle(sim, pool, "t0");
  assert.equal(pool.getStats().bytesWritten, 15_000_000);
  pool.emitTraceSpans(sim);
  const ev = sim.log.filter((e) => e.kind === "db.write");
  assert.equal(ev.length, 1);
  assert.equal(ev[0]!.data.payload_size, 15000000);
  assert.equal(ev[0]!.data.storage_class, "primary");
  assert.equal(ev[0]!.data.offloaded, false);
  assert.equal(ev[0]!.data.step_type, "storage_write");
  const span = exportTrace(sim.log, "t", {}).spans.find((s) => s.name === "db.agent_state.write")!;
  assert.equal(span.attrs.payload_size, 15000000);
  assert.equal(span.attrs.storage_class, "primary");
  assert.equal(span.attrs.offloaded, false);
});

test("write_amp_15mb: writeAmpBytes override and cumulative bytes", () => {
  const sim = new Sim(1);
  const pool = new MockPgPool(2, 2, { holdMode: "write_amp_15mb", writeAmpBytes: 1000 });
  cycle(sim, pool, "a");
  cycle(sim, pool, "b");
  assert.equal(pool.bytesWritten, 2000);
  pool.emitTraceSpans(sim);
  assert.equal(sim.log.filter((e) => e.kind === "db.write")[0]!.data.payload_size, 2000);
});

test("emitTraceSpans emits nothing when no bytes written", () => {
  const sim = new Sim(1);
  const pool = new MockPgPool(2, 2, { holdMode: "stream_hog_30s" });
  cycle(sim, pool, "t0");
  pool.emitTraceSpans(sim);
  assert.equal(sim.log.length, 0);
});

test("hydration_freeze_4s: avgHoldMs ~ 4000 after 1 cycle", () => {
  const sim = new Sim(1);
  const pool = new MockPgPool(2, 2, { holdMode: "hydration_freeze_4s" });
  cycle(sim, pool, "t0");
  assert.ok(Math.abs(pool.getStats().avgHoldMs - 4000) < 0.001);
});

test("in_doubt_zombie_tx: frozenQueries > 0 after 1 cycle", () => {
  const sim = new Sim(1);
  const pool = new MockPgPool(2, 2, { holdMode: "in_doubt_zombie_tx" });
  cycle(sim, pool, "t0");
  assert.ok(pool.getStats().frozenQueries > 0);
  assert.equal(pool.getStats().avgHoldMs, 30000);
  assert.equal(pool.getStats().bytesWritten, 0);
});

test("p99HoldMs uses nearest-rank over per-release holds", () => {
  const pool = new MockPgPool(1, 1);
  for (let i = 1; i <= 100; i++) {
    const w = mk(`w${i}`, 0);
    pool.acquire(w);
    pool.release(w, i);
  }
  assert.equal(pool.getStats().p99HoldMs, 99);
});

test("determinism: same config + seed gives deepEqual stats", () => {
  const configs: Array<PoolDialConfig | undefined> = [
    undefined,
    { holdMode: "zero_hold_2ms" },
    { holdMode: "write_amp_15mb" },
    { holdMode: "in_doubt_zombie_tx" },
  ];
  for (const dial of configs) {
    const runOnce = () => {
      const sim = new Sim(42);
      const pool = new MockPgPool(2, 3, dial);
      for (let i = 0; i < 6; i++) cycle(sim, pool, `t${i}`, sim.rng.int(10, 200));
      pool.emitTraceSpans(sim);
      return { stats: pool.getStats(), log: sim.log };
    };
    assert.deepEqual(runOnce(), runOnce());
  }
});
