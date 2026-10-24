import test from "node:test";
import assert from "node:assert/strict";
import { MatrixScenario, MATRIX_PRESETS } from "../src/matrix-copy.ts";

test("Same config and seed produce deep-equal snapshots", () => {
  const config = MATRIX_PRESETS.login_freeze_db_hog!;
  const first = new MatrixScenario(config);
  first.run();
  const second = new MatrixScenario(config);
  second.run();
  assert.deepEqual(first.snapshot(), second.snapshot());
});

test("Same config with different seeds produces different snapshots", () => {
  const config = MATRIX_PRESETS.login_freeze_db_hog!;
  const first = new MatrixScenario({ ...config, seed: 42 });
  first.run();
  const second = new MatrixScenario({ ...config, seed: 43 });
  second.run();
  assert.notDeepEqual(first.snapshot(), second.snapshot());
});

test("Reset and rerun with same config produces identical snapshot", () => {
  const scenario = new MatrixScenario(MATRIX_PRESETS.double_charge_2ms_drop!);
  scenario.run();
  const first = scenario.snapshot();
  scenario.reset();
  scenario.run();
  assert.deepEqual(first, scenario.snapshot());
});

test("Determinism holds across all 10 presets", () => {
  for (const [name, preset] of Object.entries(MATRIX_PRESETS)) {
    const first = new MatrixScenario(preset);
    first.run();
    const second = new MatrixScenario(preset);
    second.run();
    assert.deepEqual(first.snapshot(), second.snapshot(), `preset ${name} not deterministic`);
  }
});
