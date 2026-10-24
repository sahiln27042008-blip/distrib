import test from "node:test";
import assert from "node:assert/strict";
import { MATRIX_PRESETS, MatrixScenario } from "../src/matrix-copy.ts";

test("Single matrix config runs and produces non-zero measured values", () => {
  const cfg = MATRIX_PRESETS.login_freeze_db_hog!;
  const sc = new MatrixScenario(cfg);
  sc.run();
  const snap = sc.snapshot();

  assert.ok(snap.virtualTimeMs > 0);
  assert.ok(snap.economics.totalTokens >= 0);
  assert.ok(typeof snap.db.avgHoldMs === "number");
  assert.ok(!Number.isNaN(snap.db.avgHoldMs));
});
