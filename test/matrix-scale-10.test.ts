import test from "node:test";
import assert from "node:assert/strict";
import { MATRIX_PRESETS, MatrixScenario, type MatrixConfig } from "../src/matrix-copy.ts";

test("10 matrix configs all run successfully and deterministically", () => {
  const presets = Object.values(MATRIX_PRESETS).filter(Boolean) as MatrixConfig[];
  assert.ok(presets.length >= 10, `expected at least 10 presets, got ${presets.length}`);

  for (let i = 0; i < 10; i++) {
    const cfg = presets[i];
    const sc1 = new MatrixScenario(cfg);
    sc1.run();
    const snap1 = sc1.snapshot();

    const sc2 = new MatrixScenario(cfg);
    sc2.run();
    const snap2 = sc2.snapshot();

    assert.deepEqual(snap1, snap2, `preset ${cfg.runId} not deterministic on repeat run`);
    assert.ok(snap1.virtualTimeMs > 0, `preset ${cfg.runId} produced virtualTimeMs=0`);
  }
});
