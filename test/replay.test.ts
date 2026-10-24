import test from "node:test";
import assert from "node:assert/strict";
import { MATRIX_PRESETS, MatrixScenario } from "../src/matrix-copy.ts";
import { createReplayHandle, deserializeHandle, replay, serializeHandle } from "../src/replay.ts";

test("createReplayHandle produces a valid handle", () => {
  const cfg = MATRIX_PRESETS.login_freeze_db_hog!;
  const handle = createReplayHandle(cfg);
  assert.equal(handle.version, "replay-v1");
  assert.equal(handle.seed, cfg.seed);
  assert.equal(handle.matrixConfig, cfg);
  assert.ok(handle.createdAt);
});

test("serialize → deserialize round-trips", () => {
  const cfg = MATRIX_PRESETS.double_charge_2ms_drop!;
  const handle = createReplayHandle(cfg);
  const json = serializeHandle(handle);
  const restored = deserializeHandle(json);
  assert.deepEqual(restored, handle);
});

test("replay() reproduces identical snapshot for same handle", () => {
  const cfg = MATRIX_PRESETS.login_freeze_db_hog!;
  const handle = createReplayHandle(cfg);
  const result1 = replay(handle);
  const result2 = replay(handle);
  assert.deepEqual(result1.snapshot, result2.snapshot);
  assert.deepEqual(result1.trace, result2.trace);
});

test("replay() matches a fresh run", () => {
  const cfg = MATRIX_PRESETS.login_freeze_db_hog!;
  const sc = new MatrixScenario(cfg);
  sc.run();
  const freshSnap = sc.snapshot();

  const handle = createReplayHandle(cfg);
  const replayed = replay(handle);
  assert.deepEqual(freshSnap, replayed.snapshot);
});

test("deserialize rejects malformed handles", () => {
  assert.throws(() => deserializeHandle('{"version":"wrong"}'));
  assert.throws(() => deserializeHandle('{"version":"replay-v1","seed":"not a number"}'));
  assert.throws(() => deserializeHandle('{"version":"replay-v1","seed":42,"matrixConfig":{"A":"invalid_dial"}}'));
});

test("Replay works for all 10 presets", () => {
  for (const [name, preset] of Object.entries(MATRIX_PRESETS)) {
    if (!preset) continue;
    const handle = createReplayHandle(preset);
    const r1 = replay(handle);
    const r2 = replay(handle);
    assert.deepEqual(r1.snapshot, r2.snapshot, `preset ${name} not replayable`);
  }
});