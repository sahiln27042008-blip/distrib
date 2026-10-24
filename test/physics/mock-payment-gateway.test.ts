import test from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../../src/kernel.ts";
import { exportTrace } from "../../src/trace.ts";
import { MockPaymentGateway } from "../../src/physics/mock-payment-gateway.ts";

// Verbatim copy of the pre-extraction class from src/chaos.ts, used as the identity oracle.
class LegacyGateway {
  readonly receipts = new Map<string, { receiptId: string; amountDollars: number }>();
  accept(key: string, amountDollars: number, candidateReceiptId: string): { receiptId: string; replayed: boolean } {
    const prior = this.receipts.get(key);
    if (prior) return { receiptId: prior.receiptId, replayed: true };
    this.receipts.set(key, { receiptId: candidateReceiptId, amountDollars });
    return { receiptId: candidateReceiptId, replayed: false };
  }
  reset(): void {
    this.receipts.clear();
  }
}

const PAYLOAD = { tenantId: "T-88121", amountDollars: 50 };

test("default constructor behaves identically to the legacy class", () => {
  const legacy = new LegacyGateway();
  const next = new MockPaymentGateway();
  const ops: Array<[string, number, string]> = [
    ["k1", 50, "r1"],
    ["k1", 50, "r2"],
    ["k2", 75, "r3"],
    ["k2", 75, "r4"],
    ["k3", 10, "r5"],
  ];
  for (const [k, amt, rid] of ops) assert.deepEqual(next.accept(k, amt, rid), legacy.accept(k, amt, rid));
  assert.deepEqual([...next.receipts], [...legacy.receipts]);
  next.reset();
  legacy.reset();
  assert.deepEqual([...next.receipts], [...legacy.receipts]);
  // dialConfig with idempotencyPolicy undefined is also identical.
  const empty = new MockPaymentGateway({});
  const legacy2 = new LegacyGateway();
  for (const [k, amt, rid] of ops) assert.deepEqual(empty.accept(k, amt, rid), legacy2.accept(k, amt, rid));
});

test("clean: reused key dedups, no duplicate dollars", () => {
  const g = new MockPaymentGateway({ idempotencyPolicy: "clean" });
  const a = g.accept("key-1", 50, "r1", { payload: PAYLOAD });
  const b = g.accept("key-1", 50, "r2", { payload: PAYLOAD });
  assert.equal(a.replayed, false);
  assert.equal(b.replayed, true);
  assert.equal(b.receiptId, "r1");
  const s = g.getStats();
  assert.equal(s.duplicateDollarsCharged, 0);
  assert.equal(s.paymentAcceptedCharges, 1);
  assert.equal(s.attemptCount, 2);
});

test("legacy_no_idem: null key retry creates a duplicate charge", () => {
  const g = new MockPaymentGateway({ idempotencyPolicy: "legacy_no_idem" });
  const a = g.accept(null, 50, "r1", { payload: PAYLOAD });
  const b = g.accept(null, 50, "r2", { payload: PAYLOAD });
  assert.equal(a.replayed, false);
  assert.equal(b.replayed, false);
  const s = g.getStats();
  assert.equal(s.paymentAcceptedCharges, 2);
  assert.equal(s.duplicateDollarsCharged, 50);
  assert.ok(s.duplicateDollarsCharged > 0);
});

test("socket_drop: first attempt ECONNRESET, retry succeeds with one charge", () => {
  const g = new MockPaymentGateway({ idempotencyPolicy: "socket_drop" });
  const first = g.accept("key-1", 50, "r1", { payload: PAYLOAD });
  assert.equal(first.error, "ECONNRESET");
  const second = g.accept("key-1", 50, "r2", { payload: PAYLOAD });
  assert.equal(second.error, undefined);
  assert.equal(second.replayed, true);
  assert.equal(second.receiptId, "r1");
  const s = g.getStats();
  assert.equal(s.attemptCount, 2);
  assert.equal(s.paymentAcceptedCharges, 1);
  assert.equal(s.connectionResets, 1);
  assert.equal(s.duplicateDollarsCharged, 0);
});

test("socket_drop: retry with a fresh key double-charges", () => {
  const g = new MockPaymentGateway({ idempotencyPolicy: "socket_drop" });
  g.accept("attempt-1", 50, "r1", { payload: PAYLOAD });
  g.accept("attempt-2", 50, "r2", { payload: PAYLOAD });
  const s = g.getStats();
  assert.equal(s.paymentAcceptedCharges, 2);
  assert.equal(s.duplicateDollarsCharged, 50);
});

test("rate_limit: seeded 429 brownout is intermittent and deterministic", () => {
  const run = (seed: number) => {
    const g = new MockPaymentGateway({ idempotencyPolicy: "rate_limit", seed });
    const errors: Array<string | undefined> = [];
    for (let i = 0; i < 20; i++) errors.push(g.accept(`k${i}`, 10, `r${i}`, { payload: { i } }).error);
    return { errors, stats: g.getStats() };
  };
  const a = run(7);
  assert.ok(a.stats.rateLimited > 0, "some attempts rate limited");
  assert.ok(a.stats.paymentAcceptedCharges > 0, "some attempts accepted");
  assert.equal(a.stats.rateLimited + a.stats.paymentAcceptedCharges, 20);
  assert.ok(a.errors.includes("429"));
  assert.deepEqual(run(7), a);
});

test("poison_pill: poisonIndex item fails, others succeed", () => {
  const g = new MockPaymentGateway({ idempotencyPolicy: "poison_pill" });
  assert.equal(g.poisonIndex, 27);
  assert.equal(g.totalItems, 50);
  const results = [];
  for (let i = 0; i < g.totalItems; i++) results.push(g.accept(`k${i}`, 5, `r${i}`, { payload: { i }, itemIndex: i }));
  assert.equal(results[27]!.error, "poison_pill");
  assert.equal(results.filter((r) => r.error).length, 1);
  const s = g.getStats();
  assert.equal(s.batchItemsFailed, 1);
  assert.equal(s.batchItemsSucceeded, 49);
  assert.equal(s.paymentAcceptedCharges, 49);

  const custom = new MockPaymentGateway({ idempotencyPolicy: "poison_pill", poisonIndex: 2, totalItems: 5 });
  for (let i = 0; i < 5; i++) custom.accept(`k${i}`, 5, `r${i}`, { payload: { i }, itemIndex: i });
  assert.equal(custom.getStats().batchItemsFailed, 1);
  assert.equal(custom.getStats().batchItemsSucceeded, 4);
});

test("emitTraceSpans: payment.attempt.sent carries auditor attrs and retry link", () => {
  const sim = new Sim(1);
  const g = new MockPaymentGateway({ idempotencyPolicy: "socket_drop" });
  g.accept("key-1", 50, "r1", { payload: PAYLOAD });
  g.accept("key-1", 50, "r2", { payload: PAYLOAD });
  g.emitTraceSpans(sim);
  g.emitTraceSpans(sim); // idempotent: no re-emit
  const sent = sim.log.filter((e) => e.kind === "payment.attempt.sent");
  assert.equal(sent.length, 2);
  const [first, retry] = sent as [(typeof sent)[number], (typeof sent)[number]];
  assert.equal(first.data.side_effect, "POST");
  assert.match(String(first.data.body_hash), /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.data.idempotency_key, "key-1");
  assert.equal(first.data.retry_count, 0);
  assert.equal("attempt_of" in first.data, false);
  assert.equal(retry.data.retry_count, 1);
  assert.equal(retry.data.attempt_of, first.id);
  assert.equal(retry.data.retryOf, first.id);
  assert.equal(retry.data.body_hash, first.data.body_hash);

  const trace = exportTrace(sim.log, "t", {});
  const spans = trace.spans.filter((s) => s.name === "payment.attempt");
  assert.equal(spans.length, 2);
  assert.deepEqual(spans[1]!.links, [{ type: "retry_of", spanId: spans[0]!.spanId }]);
  assert.equal(spans[1]!.attrs.attempt_of, first.id);
});

test("emitTraceSpans: legacy_no_idem emits null idempotency_key and honors parent", () => {
  const sim = new Sim(1);
  const root = sim.emit("request.received", "c1");
  const g = new MockPaymentGateway({ idempotencyPolicy: "legacy_no_idem" });
  g.accept(null, 50, "r1", { payload: PAYLOAD });
  g.emitTraceSpans(sim, root);
  const ev = sim.log.find((e) => e.kind === "payment.attempt.sent")!;
  assert.equal(ev.data.idempotency_key, null);
  assert.equal(ev.data.side_effect, "POST");
  assert.equal(ev.parent, root);
});

test("determinism: same dialConfig and seed give deepEqual stats and trace", () => {
  const drive = () => {
    const sim = new Sim(42);
    const g = new MockPaymentGateway({ idempotencyPolicy: "rate_limit", seed: 42 });
    for (let i = 0; i < 12; i++) g.accept(i % 3 === 0 ? null : `k${i}`, 10 + i, `r${i}`, { payload: { n: i % 4 } });
    g.emitTraceSpans(sim);
    return { stats: g.getStats(), log: sim.log, receipts: [...g.receipts] };
  };
  assert.deepEqual(drive(), drive());
});

test("reset restores a fresh gateway", () => {
  const g = new MockPaymentGateway({ idempotencyPolicy: "rate_limit", seed: 3 });
  const first = [0, 1, 2, 3, 4].map((i) => g.accept(`k${i}`, 5, `r${i}`).error);
  g.reset();
  assert.equal(g.getStats().attemptCount, 0);
  assert.equal(g.receipts.size, 0);
  const second = [0, 1, 2, 3, 4].map((i) => g.accept(`k${i}`, 5, `r${i}`).error);
  assert.deepEqual(second, first);
});
