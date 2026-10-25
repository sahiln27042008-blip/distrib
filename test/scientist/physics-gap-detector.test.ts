import test from "node:test";
import assert from "node:assert/strict";
import type { MatrixConfig } from "../../src/matrix-copy.ts";
import { MATRIX_PRESETS } from "../../src/matrix-copy.ts";
import { detectPhysicsGaps } from "../../src/scientist/physics-gap-detector.ts";
import { selectPhysics } from "../../src/scientist/physics-selector.ts";

const CONFIG: MatrixConfig = MATRIX_PRESETS.double_charge_2ms_drop!;

test("gap detector reports distributed bounded consumers", async () => {
  const description = "Distributed database with replication lag and a bounded consumer with a hardcoded array limit.";
  const selection = await selectPhysics(CONFIG, description);
  const result = detectPhysicsGaps(CONFIG, selection.selected, description);
  assert.equal(result.hasGap, true);
  assert.ok(result.missingMechanisms.some((gap) => gap.description.includes("capacity limit")));
});

test("standard SaaS architecture has no unmodeled gaps", () => {
  const result = detectPhysicsGaps(CONFIG, [], "Standard SaaS payment workflow using Stripe and Postgres.");
  assert.equal(result.hasGap, false);
});

test("gap detector reports missing consensus physics", () => {
  const result = detectPhysicsGaps(CONFIG, [], "A multi-agent coordinator uses consensus to assign work.");
  assert.equal(result.hasGap, true);
  assert.ok(result.missingMechanisms.some((gap) => gap.description.includes("consensus")));
});

test("gap detector lists unique registered categories", () => {
  const result = detectPhysicsGaps(CONFIG, []);
  assert.ok(result.availableCategories.length > 0);
  assert.equal(new Set(result.availableCategories).size, result.availableCategories.length);
});