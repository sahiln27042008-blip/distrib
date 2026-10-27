import test from "node:test";
import assert from "node:assert/strict";
import {
  createPhysicsRegistry,
  getGlobalRegistry,
} from "../../src/physics/registry.ts";
import { paymentIdempotencyPrimitive } from "../../src/physics/registry-adapters.ts";

test("Registry registers and retrieves primitives by ID", () => {
  const reg = createPhysicsRegistry();
  reg.register(paymentIdempotencyPrimitive);

  const retrieved = reg.get("payment.idempotency");
  assert.ok(retrieved);
  assert.equal(retrieved.id, "payment.idempotency");
  assert.equal(retrieved.category, "payment");
});

test("Registry list returns all registered primitives", () => {
  const reg = getGlobalRegistry();
  const primitives = reg.list();
  assert.equal(primitives.length, 12);

  const ids = primitives.map((p) => p.id);
  assert.ok(ids.includes("payment.idempotency"));
  assert.ok(ids.includes("transaction.partial_commit"));
  assert.ok(ids.includes("consistency.eventual"));
  assert.ok(ids.includes("queue.duplicate_delivery"));
  assert.ok(ids.includes("tool.partial_success"));
  assert.ok(ids.includes("worker.state_loss"));
  assert.ok(ids.includes("universal.causal_alphabet"));
});

test("findApplicable returns only relevant primitives for a payment architecture", () => {
  const reg = getGlobalRegistry();
  const world = {
    actors: [
      {
        kind: "payment_service",
        name: "Stripe Payment Gateway",
        contract: { guarantees: ["Idempotency keys supported"] },
      },
    ],
  };

  const applicable = reg.findApplicable(world);
  const ids = applicable.map((p) => p.id);

  assert.ok(ids.includes("payment.idempotency"));
  assert.ok(ids.includes("transaction.partial_commit"));
  assert.ok(!ids.includes("queue.duplicate_delivery"));
  assert.ok(!ids.includes("consistency.eventual"));
  assert.ok(!ids.includes("worker.state_loss"));
  assert.ok(!ids.includes("tool.batch"));
});

test("findApplicable returns only relevant primitives for a queue architecture", () => {
  const reg = getGlobalRegistry();
  const world = {
    actors: [
      {
        kind: "queue",
        name: "Order Processing SQS Queue",
      },
    ],
  };

  // Exclude universal primitives to assert dial-specific applicability
  const applicable = reg.findApplicable(world).filter((p) => p.id !== "universal.causal_alphabet");
  const ids = applicable.map((p) => p.id);

  assert.equal(ids.length, 1);
  assert.equal(ids[0], "queue.duplicate_delivery");
});

test("findApplicable returns empty for unknown architecture", () => {
  const reg = getGlobalRegistry();
  const world = {
    actors: [
      {
        kind: "iot_sensor",
        name: "Temperature Sensor DHT22",
      },
    ],
  };

  // Exclude universal primitives to assert dial-specific applicability
  const applicable = reg.findApplicable(world).filter((p) => p.id !== "universal.causal_alphabet");
  assert.equal(applicable.length, 0);
});

test("Existing 6 dial physics are wrapped as registry primitives", () => {
  const reg = getGlobalRegistry();
  const expectedAdapters = [
    "db.hold_and_write_amp",
    "payment.idempotency",
    "process.isolation",
    "tool.batch",
    "llm.context",
    "storage.write",
  ];

  for (const id of expectedAdapters) {
    const primitive = reg.get(id);
    assert.ok(primitive, `Expected adapter ${id} to be registered`);
    assert.equal(primitive.id, id);
    assert.ok(typeof primitive.execute === "function");
    assert.ok(typeof primitive.configure === "function");
    assert.ok(typeof primitive.generateInterventions === "function");
    assert.ok(Array.isArray(primitive.getEffects()));
  }
});

test("Registry IDs are stable and deterministic", () => {
  const reg1 = getGlobalRegistry();
  const ids1 = reg1.list().map((p) => p.id);

  const reg2 = getGlobalRegistry();
  const ids2 = reg2.list().map((p) => p.id);

  assert.deepEqual(ids1, ids2);
  assert.equal(ids1.length, 12);
});

test("Registering duplicate ID throws error", () => {
  const reg = createPhysicsRegistry();
  reg.register(paymentIdempotencyPrimitive);

  assert.throws(
    () => reg.register(paymentIdempotencyPrimitive),
    /already registered/,
  );
});

