import test from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../../src/kernel.ts";
import { MockToolGateway, type BatchPolicy } from "../../src/physics/mock-tool-gateway.ts";

test("default constructor keeps old gateway fields", () => {
  const gw = new MockToolGateway();
  assert.equal(gw.totalItems, 50);
  assert.equal(gw.poisonItem, 27);
  assert.deepEqual([...gw.malformedUtf8], [0xc3, 0x28]);
  assert.equal(gw.validatesPoison(), true);
});

test("default constructor matches old harness: naive aborts 49, resilient unrolls", () => {
  const naive = new MockToolGateway();
  naive.executeBatch(new Sim(1), "naive");
  assert.equal(naive.batchItemsFailed, 1);
  assert.equal(naive.innocentBatchTasksAborted, 49);
  assert.equal(naive.batchItemsSucceeded, 0);

  const resilient = new MockToolGateway({});
  resilient.executeBatch(new Sim(1));
  assert.equal(resilient.batchItemsSucceeded, 49);
  assert.equal(resilient.batchItemsFailed, 1);
  assert.equal(resilient.innocentBatchTasksAborted, 0);
});

test("clean: all 50 succeed", () => {
  const gw = new MockToolGateway({ batchPolicy: "clean" });
  gw.executeBatch(new Sim(1));
  const s = gw.getStats();
  assert.equal(s.batchItemsSucceeded, 50);
  assert.equal(s.batchItemsFailed, 0);
  assert.equal(s.innocentBatchTasksAborted, 0);
});

test("poison_pill poisonIndex=27: only poison item fails, no innocents aborted", () => {
  const gw = new MockToolGateway({ batchPolicy: "poison_pill", poisonIndex: 27 });
  const res = gw.executeBatch(new Sim(1));
  const s = gw.getStats();
  assert.equal(s.batchItemsFailed, 1);
  assert.equal(s.batchItemsSucceeded, 49);
  assert.equal(s.innocentBatchTasksAborted, 0);
  assert.equal(res.find((r) => r.status === "failed")!.item, 27);
});

test("poison_pill default poison index is 27; custom index honored", () => {
  assert.equal(new MockToolGateway({ batchPolicy: "poison_pill" }).poisonItem, 27);
  const gw = new MockToolGateway({ batchPolicy: "poison_pill", poisonIndex: 3 });
  const res = gw.executeBatch(new Sim(1));
  assert.equal(res.find((r) => r.status === "failed")!.item, 3);
});

test("socket_drop: mid-batch drop aborts remaining items", () => {
  const gw = new MockToolGateway({ batchPolicy: "socket_drop" });
  gw.executeBatch(new Sim(1));
  const s = gw.getStats();
  assert.equal(s.batchItemsFailed, 1);
  assert.equal(s.batchItemsSucceeded, 24);
  assert.equal(s.innocentBatchTasksAborted, 25);
});

test("rate_limit: intermittent 429 failures, seeded", () => {
  const gw = new MockToolGateway({ batchPolicy: "rate_limit" });
  gw.executeBatch(new Sim(7));
  const s = gw.getStats();
  assert.ok(s.batchItemsFailed > 0 && s.batchItemsFailed < 50);
  assert.equal(s.batchItemsSucceeded + s.batchItemsFailed, 50);
  assert.equal(s.innocentBatchTasksAborted, 0);
});

test("legacy_no_idem: no dedup, retried items accepted", () => {
  const gw = new MockToolGateway({ batchPolicy: "legacy_no_idem" });
  const sim = new Sim(1);
  gw.executeBatch(sim);
  gw.executeBatch(sim); // retry
  const s = gw.getStats();
  assert.equal(s.batchItemsSucceeded, 100);
  assert.equal(s.duplicateItemsAccepted, 50);
  assert.equal(s.duplicateItemsRejected, 0);
});

test("idempotent policy rejects retried items", () => {
  const gw = new MockToolGateway({ batchPolicy: "clean" });
  const sim = new Sim(1);
  gw.executeBatch(sim);
  gw.executeBatch(sim);
  const s = gw.getStats();
  assert.equal(s.batchItemsSucceeded, 50);
  assert.equal(s.duplicateItemsRejected, 50);
});

test("emitTraceSpans emits batch.item.* with policy attr, once", () => {
  const gw = new MockToolGateway({ batchPolicy: "poison_pill" });
  const sim = new Sim(1);
  gw.executeBatch(sim);
  gw.emitTraceSpans(sim, "e0");
  gw.emitTraceSpans(sim, "e0");
  const items = sim.log.filter((e) => e.kind.startsWith("batch.item."));
  assert.equal(items.length, 50);
  assert.equal(sim.log.filter((e) => e.kind === "batch.item.failed").length, 1);
  assert.equal(items[0]!.data.batch_policy, "poison_pill");
});

test("determinism: same config + seed gives deepEqual stats", () => {
  const policies: BatchPolicy[] = ["clean", "socket_drop", "rate_limit", "poison_pill", "legacy_no_idem"];
  for (const batchPolicy of policies) {
    const run = (): unknown => {
      const gw = new MockToolGateway({ batchPolicy });
      const sim = new Sim(42);
      gw.executeBatch(sim);
      gw.emitTraceSpans(sim);
      return { stats: gw.getStats(), log: sim.log };
    };
    assert.deepEqual(run(), run(), batchPolicy);
  }
});
