import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildWorldModel,
  buildWorldState,
  createWorldState,
  addActor,
  getActor,
  recordOperation,
  recordLostAcknowledgment,
  createBeliefState,
  recordBelievedOperation,
  recordUncertainOperation,
  recordHallucinatedOperation,
  getDivergence,
  transitionOperation,
  PAYMENT_SERVICE_CONTRACT,
  LEGACY_PAYMENT_CONTRACT,
  DATABASE_CONTRACT,
  type Actor,
  type Operation,
} from "../../src/world-model/index.ts";
import type { MatrixConfig } from "../../src/matrix-copy.ts";

const BASE_CFG: MatrixConfig = {
  seed: 42,
  runId: "wm-test",
  A: "A2_mixed_saas",
  B: "B1_zero_hold_2ms",
  C: "C1_clean_20ms",
  D: "D5_cqrs_duckdb_blackboard_o1",
  E: "E4_state_leases_ipc_worker",
  F: "F3_resilient_invariant_runtime",
  humanUsers: 100,
  concurrentAgents: 5,
  dbPoolSize: 10,
  workflowSteps: 5,
  saasPriceUsd: 20,
  ticketValueUsd: 5,
};

test("buildWorldModel returns 7 actors for any config", () => {
  const { actors, contracts } = buildWorldModel(BASE_CFG);
  assert.equal(actors.length, 7);
  assert.equal(contracts.length, 7);

  const actorIds = actors.map((a) => a.id).sort();
  assert.deepEqual(actorIds, [
    "agent",
    "database",
    "llm",
    "payment",
    "supervisor",
    "storage",
    "tools",
  ].sort());

  const kinds = actors.map((a) => a.kind).sort();
  assert.deepEqual(kinds, [
    "agent",
    "database",
    "llm",
    "payment_service",
    "process_supervisor",
    "storage",
    "tool_gateway",
  ].sort());
});

test("C5 config produces payment actor with LEGACY_PAYMENT_CONTRACT", () => {
  const cfg: MatrixConfig = {
    ...BASE_CFG,
    C: "C5_legacy_erp_no_idem",
  };
  const { actors } = buildWorldModel(cfg);
  const paymentActor = actors.find((a) => a.id === "payment");
  assert.ok(paymentActor);
  assert.equal(paymentActor.name, "Legacy Payment API");
  assert.deepEqual(paymentActor.contract, LEGACY_PAYMENT_CONTRACT);
  assert.ok(
    paymentActor.contract.guarantees.includes("No idempotency guarantees")
  );
  assert.ok(
    paymentActor.contract.failureModes.includes(
      "Duplicate charge on retry (always, no dedup)"
    )
  );
});

test("C1 config produces payment actor with PAYMENT_SERVICE_CONTRACT", () => {
  const cfg: MatrixConfig = {
    ...BASE_CFG,
    C: "C1_clean_20ms",
  };
  const { actors } = buildWorldModel(cfg);
  const paymentActor = actors.find((a) => a.id === "payment");
  assert.ok(paymentActor);
  assert.equal(paymentActor.name, "Stripe Payment API");
  assert.deepEqual(paymentActor.contract, PAYMENT_SERVICE_CONTRACT);
  assert.ok(
    paymentActor.contract.guarantees.includes(
      "Accepts idempotency key for deduplication"
    )
  );
  assert.ok(
    paymentActor.contract.failureModes.includes(
      "Duplicate charge without idempotency key"
    )
  );
});

test("E1 config produces supervisor with host-crash failure mode", () => {
  const cfg: MatrixConfig = {
    ...BASE_CFG,
    E: "E1_god_mode_main_thread",
  };
  const { actors } = buildWorldModel(cfg);
  const supervisor = actors.find((a) => a.id === "supervisor");
  assert.ok(supervisor);
  assert.deepEqual(supervisor.contract.failureModes, [
    "Tool SIGSEGV crashes host",
  ]);
  assert.deepEqual(supervisor.contract.guarantees, ["No isolation guarantees"]);
});

test("E4 config produces supervisor with contained-crash failure mode", () => {
  const cfg: MatrixConfig = {
    ...BASE_CFG,
    E: "E4_state_leases_ipc_worker",
  };
  const { actors } = buildWorldModel(cfg);
  const supervisor = actors.find((a) => a.id === "supervisor");
  assert.ok(supervisor);
  assert.deepEqual(supervisor.contract.failureModes, [
    "Tool SIGSEGV crashes worker (contained)",
  ]);
  assert.deepEqual(supervisor.contract.guarantees, [
    "IPC isolation",
    "State leases with expiry",
  ]);
});

test("WorldState tracks committed operations", () => {
  const state = createWorldState();
  assert.equal(state.operations.length, 0);
  assert.equal(state.committedOperations.length, 0);

  const reqOp: Operation = {
    id: "op-1",
    actorId: "payment",
    kind: "charge",
    lifecycle: "requested",
    input: { amount: 50 },
    timestamp: 10,
  };
  recordOperation(state, reqOp);
  assert.equal(state.operations.length, 1);
  assert.equal(state.committedOperations.length, 0);

  const commitOp: Operation = {
    id: "op-2",
    actorId: "payment",
    kind: "charge",
    lifecycle: "committed",
    input: { amount: 100 },
    output: { receiptId: "rec_123" },
    timestamp: 25,
    sideEffect: true,
  };
  recordOperation(state, commitOp);
  assert.equal(state.operations.length, 2);
  assert.equal(state.committedOperations.length, 1);
  assert.equal(state.committedOperations[0]?.id, "op-2");
});

test("BeliefState tracks uncertain operations", () => {
  const belief = createBeliefState();
  assert.equal(belief.uncertainOperations.size, 0);

  recordUncertainOperation(belief, "op-timeout-99");
  assert.equal(belief.uncertainOperations.size, 1);
  assert.ok(belief.uncertainOperations.has("op-timeout-99"));
  assert.ok(!belief.uncertainOperations.has("op-unknown"));

  // Also verify hallucinated operations
  const hallucinated: Operation = {
    id: "op-hallucinated",
    actorId: "agent",
    kind: "write",
    lifecycle: "committed",
    timestamp: 50,
  };
  recordHallucinatedOperation(belief, hallucinated);
  assert.equal(belief.hallucinatedOperations.length, 1);
  assert.equal(belief.hallucinatedOperations[0]?.id, "op-hallucinated");
});

test("getDivergence returns committed-but-not-believed operations", () => {
  const world = createWorldState();
  const belief = createBeliefState();

  const op1: Operation = {
    id: "op-ack",
    actorId: "payment",
    kind: "charge",
    lifecycle: "committed",
    timestamp: 100,
  };
  const op2: Operation = {
    id: "op-uncertain",
    actorId: "payment",
    kind: "charge",
    lifecycle: "committed",
    timestamp: 105,
  };
  const op3: Operation = {
    id: "op-lost",
    actorId: "payment",
    kind: "charge",
    lifecycle: "committed",
    timestamp: 110,
  };

  recordOperation(world, op1);
  recordOperation(world, op2);
  recordOperation(world, op3);

  // Agent knows op1 succeeded
  recordBelievedOperation(belief, op1);
  // Agent is uncertain about op2 (e.g. timed out waiting for ack)
  recordUncertainOperation(belief, op2.id);
  // Agent has no belief about op3 (completely dropped/unaware)

  const divergence = getDivergence(world, belief);
  assert.equal(divergence.length, 1);
  assert.equal(divergence[0]?.id, "op-lost");
});

test("Operation lifecycle transitions: requested → accepted → committed → acknowledged", () => {
  let op: Operation = {
    id: "op-lifecycle-1",
    actorId: "payment",
    kind: "charge",
    lifecycle: "requested",
    input: { amount: 75, customer: "cust_1" },
    timestamp: 100,
    sideEffect: true,
    idempotencyKey: "idem_abc",
  };
  assert.equal(op.lifecycle, "requested");

  op = transitionOperation(op, "accepted", { timestamp: 102 });
  assert.equal(op.lifecycle, "accepted");
  assert.equal(op.timestamp, 102);

  op = transitionOperation(op, "executing", { timestamp: 105 });
  assert.equal(op.lifecycle, "executing");

  op = transitionOperation(op, "committed", {
    timestamp: 120,
    output: { chargeId: "ch_999", status: "succeeded" },
  });
  assert.equal(op.lifecycle, "committed");
  assert.deepEqual(op.output, { chargeId: "ch_999", status: "succeeded" });

  op = transitionOperation(op, "acknowledged", { timestamp: 125 });
  assert.equal(op.lifecycle, "acknowledged");
  assert.equal(op.idempotencyKey, "idem_abc");
});

test("Operation lifecycle: committed but NOT acknowledged = lost response", () => {
  const world = createWorldState();
  const belief = createBeliefState();

  const chargeOp: Operation = {
    id: "charge-lost-ack",
    actorId: "payment",
    kind: "charge",
    lifecycle: "committed",
    input: { amount: 500 },
    output: { chargeId: "ch_real_1" },
    timestamp: 200,
    sideEffect: true,
    idempotencyKey: null, // legacy API
  };

  recordOperation(world, chargeOp);
  recordLostAcknowledgment(world, chargeOp);

  // World recorded the commit and lost ack
  assert.equal(world.committedOperations.length, 1);
  assert.equal(world.lostAcknowledgments.length, 1);
  assert.equal(world.lostAcknowledgments[0]?.id, "charge-lost-ack");

  // In the agent's view, it never received the ack
  const unacknowledged = getDivergence(world, belief);
  assert.equal(unacknowledged.length, 1);
  assert.equal(unacknowledged[0]?.id, "charge-lost-ack");
});

test("buildWorldState helper initializes state with all 7 actors", () => {
  const state = buildWorldState(BASE_CFG);
  assert.equal(state.actors.size, 7);
  assert.ok(getActor(state, "database"));
  assert.equal(getActor(state, "database")?.contract, DATABASE_CONTRACT);
  assert.equal(getActor(state, "nonexistent"), undefined);
});

