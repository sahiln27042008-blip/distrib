import test from "node:test";
import assert from "node:assert/strict";
import type { MatrixConfig } from "../../src/matrix-copy.ts";
import { MATRIX_PRESETS } from "../../src/matrix-copy.ts";
import { selectPhysics } from "../../src/scientist/physics-selector.ts";

const CONFIG: MatrixConfig = MATRIX_PRESETS.double_charge_2ms_drop!;

test("selectPhysics chooses payment physics for a Stripe architecture", async () => {
  const result = await selectPhysics(CONFIG, "A Stripe payment agent retries charges after lost responses.");
  const ids = result.selected.map((selection) => selection.primitiveId);
  assert.ok(ids.includes("payment.idempotency"));
  assert.ok(ids.includes("transaction.partial_commit"));
});

test("selectPhysics chooses worker restart physics", async () => {
  const result = await selectPhysics(CONFIG, "Background workers restart and lose in-memory state.");
  assert.ok(result.selected.some((selection) => selection.primitiveId === "worker.state_loss"));
});

test("selectPhysics chooses duplicate delivery physics for queues", async () => {
  const result = await selectPhysics(CONFIG, "Kafka queue with at-least-once message delivery.");
  assert.ok(result.selected.some((selection) => selection.primitiveId === "queue.duplicate_delivery"));
});

test("selectPhysics chooses consistency physics for a distributed database", async () => {
  const result = await selectPhysics(CONFIG, "Distributed database with replication lag and eventual consistency.");
  assert.ok(result.selected.some((selection) => selection.primitiveId === "consistency.eventual"));
});

test("selections include bounded relevance and reasons", async () => {
  const result = await selectPhysics(CONFIG, "Stripe payment service");
  assert.ok(result.selected.length > 0);
  for (const selection of result.selected) {
    assert.ok(selection.relevance >= 0 && selection.relevance <= 1);
    assert.ok(selection.reason.length > 0);
  }
});

test("unrecognized custom architecture selects no default matrix physics", async () => {
  const result = await selectPhysics(CONFIG, "A custom graph-processing appliance with no listed components.");
  assert.deepEqual(result.selected, []);
});