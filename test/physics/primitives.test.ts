import test from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../../src/kernel.ts";
import {
  partialCommitPrimitive,
  eventualConsistencyPrimitive,
  queueDuplicateDeliveryPrimitive,
  toolPartialSuccessPrimitive,
  workerStateLossPrimitive,
  NEW_PRIMITIVES,
} from "../../src/physics/primitives/index.ts";

test("partial_commit produces committed + ack_lost + retry events", () => {
  const sim = new Sim(12345);
  const intervention = partialCommitPrimitive.generateInterventions({
    actors: [],
  })[0]!;
  const events = partialCommitPrimitive.execute(sim, intervention, {
    amount: 75,
  });

  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes("transaction.commit"));
  assert.ok(kinds.includes("transaction.ack_lost"));
  assert.ok(kinds.includes("transaction.retry"));

  const commitEv = events.find((e) => e.kind === "transaction.commit");
  assert.equal(commitEv?.data.committed, true);
  assert.equal(commitEv?.data.amount, 75);

  const ackLostEv = events.find((e) => e.kind === "transaction.ack_lost");
  assert.equal(ackLostEv?.data.agentBelief, "unknown");

  const retryEv = events.find((e) => e.kind === "transaction.retry");
  assert.equal(retryEv?.data.duplicateChargeRisk, true);
});

test("partial_commit is deterministic (same seed = same events)", () => {
  const sim1 = new Sim(42);
  const sim2 = new Sim(42);
  const intervention = partialCommitPrimitive.generateInterventions({
    actors: [],
  })[0]!;

  const events1 = partialCommitPrimitive.execute(sim1, intervention, {
    corr: "tx-test",
    amount: 100,
  });
  const events2 = partialCommitPrimitive.execute(sim2, intervention, {
    corr: "tx-test",
    amount: 100,
  });

  assert.deepEqual(events1, events2);
});

test("eventual_consistency produces stale_read + converge events", () => {
  const sim = new Sim(12345);
  const intervention = eventualConsistencyPrimitive.generateInterventions({
    actors: [],
  })[0]!;
  const events = eventualConsistencyPrimitive.execute(sim, intervention, {
    lagMs: 40,
  });

  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes("stale_read"));
  assert.ok(kinds.includes("replication_lag"));
  assert.ok(kinds.includes("eventual_converge"));

  const staleEv = events.find((e) => e.kind === "stale_read");
  assert.equal(staleEv?.data.version, 1);

  const convergeEv = events.find((e) => e.kind === "eventual_converge");
  assert.equal(convergeEv?.data.convergedVersion, 2);
  assert.equal(convergeEv?.data.consistent, true);
});

test("queue_duplicate_delivery produces deliver + redeliver events", () => {
  const sim = new Sim(12345);
  const intervention = queueDuplicateDeliveryPrimitive.generateInterventions({
    actors: [],
  })[0]!;
  const events = queueDuplicateDeliveryPrimitive.execute(sim, intervention, {});

  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes("queue.deliver"));
  assert.ok(kinds.includes("queue.redeliver"));
  assert.ok(kinds.includes("consumer.process"));

  const redeliver = events.find((e) => e.kind === "queue.redeliver");
  assert.equal(redeliver?.data.deliveryAttempt, 2);
});

test("tool_partial_success produces partial_success events", () => {
  const sim = new Sim(12345);
  const intervention = toolPartialSuccessPrimitive.generateInterventions({
    actors: [],
  })[0]!;
  const events = toolPartialSuccessPrimitive.execute(sim, intervention, {
    totalItems: 10,
    succeededItems: 7,
  });

  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes("tool.partial_success"));
  assert.ok(kinds.includes("tool.inconsistent_state"));

  const ps = events.find((e) => e.kind === "tool.partial_success");
  assert.equal(ps?.data.totalItems, 10);
  assert.equal(ps?.data.succeededItems, 7);
  assert.equal(ps?.data.failedItems, 3);
});

test("worker_state_loss produces crash + restart + reconstruct events", () => {
  const sim = new Sim(12345);
  const intervention = workerStateLossPrimitive.generateInterventions({
    actors: [],
  })[0]!;
  const events = workerStateLossPrimitive.execute(sim, intervention, {});

  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes("worker.crash"));
  assert.ok(kinds.includes("worker.restart"));
  assert.ok(kinds.includes("state.reconstruct"));

  const crash = events.find((e) => e.kind === "worker.crash");
  assert.equal(crash?.data.inMemoryStateLost, true);

  const reconstruct = events.find((e) => e.kind === "state.reconstruct");
  assert.equal(reconstruct?.data.checkpointMissing, true);
});

test("All 5 new primitives are deterministic", () => {
  for (const primitive of NEW_PRIMITIVES) {
    const sim1 = new Sim(999);
    const sim2 = new Sim(999);
    const intervention = primitive.generateInterventions({ actors: [] })[0]!;

    const events1 = primitive.execute(sim1, intervention, { corr: "det-test" });
    const events2 = primitive.execute(sim2, intervention, { corr: "det-test" });

    assert.deepEqual(
      events1,
      events2,
      `Primitive ${primitive.id} is not deterministic`,
    );
  }
});

test("All 5 new primitives produce trace spans with attrs", () => {
  for (const primitive of NEW_PRIMITIVES) {
    const sim = new Sim(555);
    const intervention = primitive.generateInterventions({ actors: [] })[0]!;
    const events = primitive.execute(sim, intervention, {});

    assert.ok(primitive.toSpans, `${primitive.id} missing toSpans`);
    const spans = primitive.toSpans!(events);
    assert.ok(spans.length > 0, `${primitive.id} produced 0 spans`);

    for (const span of spans) {
      assert.ok(span.spanId, `Span missing spanId`);
      assert.ok(span.name, `Span missing name`);
      assert.ok(
        span.attrs && Object.keys(span.attrs).length > 0,
        `Span for ${span.name} missing attrs`,
      );
    }
  }
});

test("partial_commit applies to payment_service architectures", () => {
  assert.equal(
    partialCommitPrimitive.appliesTo({
      actors: [
        {
          kind: "payment_service",
          name: "Stripe",
        },
      ],
    }),
    true,
  );
  assert.equal(
    partialCommitPrimitive.appliesTo({
      actors: [
        {
          kind: "external_api",
          name: "ThirdPartyAPI",
        },
      ],
    }),
    true,
  );
  assert.equal(
    partialCommitPrimitive.appliesTo({
      actors: [
        {
          kind: "queue",
          name: "QueueOnly",
        },
      ],
    }),
    false,
  );
});

test("eventual_consistency applies to database architectures", () => {
  assert.equal(
    eventualConsistencyPrimitive.appliesTo({
      actors: [
        {
          kind: "database",
          name: "Distributed ClickHouse",
          contract: { guarantees: ["Eventual consistency across replicas"] },
        },
      ],
    }),
    true,
  );
  assert.equal(
    eventualConsistencyPrimitive.appliesTo({
      actors: [
        {
          kind: "database",
          name: "Generic Database",
        },
      ],
    }),
    true,
  );
  assert.equal(
    eventualConsistencyPrimitive.appliesTo({
      actors: [
        {
          kind: "payment_service",
          name: "PaymentOnly",
        },
      ],
    }),
    false,
  );
});

test("queue_duplicate_delivery applies to queue architectures", () => {
  assert.equal(
    queueDuplicateDeliveryPrimitive.appliesTo({
      actors: [
        {
          kind: "queue",
          name: "Kafka Topic",
        },
      ],
    }),
    true,
  );
  assert.equal(
    queueDuplicateDeliveryPrimitive.appliesTo({
      actors: [
        {
          kind: "database",
          name: "Postgres",
        },
      ],
    }),
    false,
  );
});

test("worker_state_loss applies to worker/agent architectures", () => {
  assert.equal(
    workerStateLossPrimitive.appliesTo({
      actors: [
        {
          kind: "worker",
          name: "Background Worker",
        },
      ],
    }),
    true,
  );
  assert.equal(
    workerStateLossPrimitive.appliesTo({
      actors: [
        {
          kind: "agent",
          name: "Autonomous Agent",
        },
      ],
    }),
    true,
  );
  assert.equal(
    workerStateLossPrimitive.appliesTo({
      actors: [
        {
          kind: "storage",
          name: "S3",
        },
      ],
    }),
    false,
  );
});

