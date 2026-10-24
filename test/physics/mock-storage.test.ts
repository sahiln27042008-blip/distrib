import test from "node:test";
import assert from "node:assert/strict";

import { MockStorage, type WriteAmpMode } from "../../src/physics/mock-storage.ts";
import { Sim } from "../../src/kernel.ts";

test("default constructor: checkpoint adds 136 bytes, state adds 15_000_000", () => {
  const storage = new MockStorage();
  assert.equal(storage.writeCheckpoint(), 136);
  assert.equal(storage.getStats().bytesWritten, 136);
  assert.equal(storage.writeState(), 15_000_000);
  const stats = storage.getStats();
  assert.equal(stats.bytesWritten, 15_000_136);
  assert.equal(stats.checkpointsWritten, 1);
  assert.equal(stats.checkpointBytes, 136);
  assert.equal(stats.frozenQueries, 0);
});

test("zero_hold_2ms writes 4096-byte state", () => {
  const storage = new MockStorage({ writeAmpMode: "zero_hold_2ms" });
  storage.writeState();
  assert.equal(storage.getStats().bytesWritten, 4096);
});

test("write_amp_15mb writes 15_000_000-byte state", () => {
  const storage = new MockStorage({ writeAmpMode: "write_amp_15mb" });
  storage.writeState();
  assert.equal(storage.getStats().bytesWritten, 15_000_000);
});

test("in_doubt_zombie_tx increments frozenQueries per writeState only", () => {
  const storage = new MockStorage({ writeAmpMode: "in_doubt_zombie_tx" });
  storage.writeState();
  storage.writeState();
  storage.writeState();
  storage.writeCheckpoint();
  assert.equal(storage.getStats().frozenQueries, 3);
  const other = new MockStorage({ writeAmpMode: "write_amp_15mb" });
  other.writeState();
  assert.equal(other.getStats().frozenQueries, 0);
});

test("dial overrides for checkpoint and state sizes apply", () => {
  const storage = new MockStorage({ compactCheckpointBytes: 200, naiveStateWriteBytes: 1_000 });
  storage.writeCheckpoint();
  storage.writeState();
  assert.equal(storage.getStats().bytesWritten, 1_200);
  assert.throws(() => new MockStorage({ compactCheckpointBytes: 0 }), RangeError);
});

test("hold time reflects mode", () => {
  const fast = new MockStorage({ writeAmpMode: "zero_hold_2ms" });
  const hog = new MockStorage({ writeAmpMode: "stream_hog_30s" });
  fast.writeState();
  hog.writeState();
  assert.ok(fast.getStats().maxHoldMs < 100);
  assert.ok(hog.getStats().maxHoldMs >= 30_000);
});

test("recordReplay accumulates stepsReplayed and tokensWasted", () => {
  const storage = new MockStorage();
  storage.recordReplay(8, 6_000);
  storage.recordReplay(2, 1_000);
  const stats = storage.getStats();
  assert.equal(stats.stepsReplayed, 10);
  assert.equal(stats.tokensWasted, 50_000);
  assert.throws(() => storage.recordReplay(-1, 10), RangeError);
});

test("emitTraceSpans emits storage_write with payload_size, storage_class, offloaded", () => {
  const storage = new MockStorage({ writeAmpMode: "write_amp_15mb" });
  storage.writeState();
  const sim = new Sim(1);
  const parent = sim.emit("root", "c1");
  storage.emitTraceSpans(sim, parent);
  const writes = sim.log.filter((event) => event.kind === "storage_write");
  assert.equal(writes.length, 1);
  const data = writes[0]!.data;
  assert.equal(writes[0]!.parent, parent);
  assert.equal(data.step_type, "storage_write");
  assert.ok((data.payload_size as number) > 0);
  assert.equal(typeof data.storage_class, "string");
  assert.equal(typeof data.offloaded, "boolean");
});

test("write_amp_15mb span triggers R11 shape: 15MB, primary, not offloaded", () => {
  const storage = new MockStorage({ writeAmpMode: "write_amp_15mb" });
  storage.writeState();
  const sim = new Sim(1);
  storage.emitTraceSpans(sim);
  const data = sim.log[0]!.data;
  assert.equal(data.payload_size, 15_000_000);
  assert.equal(data.storage_class, "primary");
  assert.equal(data.offloaded, false);
});

test("compact checkpoint span is object-class and offloaded; zero_hold state is not R11-shaped", () => {
  const storage = new MockStorage({ writeAmpMode: "zero_hold_2ms" });
  storage.writeCheckpoint();
  storage.writeState();
  const sim = new Sim(1);
  storage.emitTraceSpans(sim);
  const [checkpoint, state] = sim.log.map((event) => event.data);
  assert.equal(checkpoint!.payload_size, 136);
  assert.equal(checkpoint!.storage_class, "object");
  assert.equal(checkpoint!.offloaded, true);
  assert.equal(state!.payload_size, 4096);
  assert.equal(state!.storage_class, "external");
  assert.equal(state!.offloaded, true);
});

test("same config and seed produce deepEqual stats", () => {
  const modes: Array<WriteAmpMode | undefined> = [
    undefined,
    "zero_hold_2ms",
    "stream_hog_30s",
    "write_amp_15mb",
    "hydration_freeze_4s",
    "in_doubt_zombie_tx",
  ];
  for (const writeAmpMode of modes) {
    const run = () => {
      const storage = new MockStorage({ writeAmpMode, seed: 42 });
      for (let index = 0; index < 5; index++) {
        storage.writeCheckpoint();
        storage.writeState();
      }
      storage.recordReplay(3, 100);
      return storage.getStats();
    };
    assert.deepEqual(run(), run());
  }
});
