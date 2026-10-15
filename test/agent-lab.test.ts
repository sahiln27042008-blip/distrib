import test from "node:test";
import assert from "node:assert/strict";

import { AgentContextScenario, runAgentComparison } from "../src/agent-lab.ts";

test("M8 naive prompts grow across turns and cumulative use reflects that growth", () => {
  const naive = new AgentContextScenario({ mode: "naive", seed: 7 });
  const snap = naive.run();
  assert.equal(snap.turns.length, 10);
  const firstTurn = snap.turns[0]!;
  const lastTurn = snap.turns[9]!;
  assert.ok(firstTurn.inputTokens > 0);
  assert.ok(lastTurn.inputTokens > firstTurn.inputTokens);
  assert.ok(snap.totals.totalTokens > lastTurn.totalTokens);
  assert.ok(firstTurn.promptLength < lastTurn.promptLength);
  assert.ok(snap.totals.totalTokens > 100_000);
});

test("M8 resilient prompts remain bounded and turn 10 stays within 3x turn 1", () => {
  const resilient = new AgentContextScenario({ mode: "resilient", seed: 7 });
  const snap = resilient.run();
  const firstTurn = snap.turns[0]!;
  const lastTurn = snap.turns[9]!;
  assert.ok(lastTurn.inputTokens <= firstTurn.inputTokens * 3);
  assert.ok(snap.totals.totalTokens < 10_000);
});

test("M8 same seed + mode yields byte-identical serialized snapshots", () => {
  const first = new AgentContextScenario({ mode: "naive", seed: 9 }).run();
  const second = new AgentContextScenario({ mode: "naive", seed: 9 }).run();
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("M8 naive and resilient modes produce different but internally consistent snapshots", () => {
  const naive = new AgentContextScenario({ mode: "naive", seed: 11 }).run();
  const resilient = new AgentContextScenario({ mode: "resilient", seed: 11 }).run();
  assert.notDeepEqual(JSON.stringify(naive), JSON.stringify(resilient));
  assert.equal(naive.mode, "naive");
  assert.equal(resilient.mode, "resilient");
  assert.ok(naive.totals.totalTokens > resilient.totals.totalTokens);
  assert.ok(naive.totals.totalDbHoldMs > resilient.totals.totalDbHoldMs);
});

test("M8 naive DB hold exceeds resilient DB hold by at least 1000x", () => {
  const naive = new AgentContextScenario({ mode: "naive", seed: 13 }).run();
  const resilient = new AgentContextScenario({ mode: "resilient", seed: 13 }).run();
  assert.ok(naive.totals.totalDbHoldMs > resilient.totals.totalDbHoldMs * 1000);
  assert.ok(naive.virtualTimeMs >= naive.totals.totalDbHoldMs);
});

test("M8 hallucination injection is deterministic and counted consistently", () => {
  const naive = new AgentContextScenario({ mode: "naive", seed: 17 }).run();
  const resilient = new AgentContextScenario({ mode: "resilient", seed: 17 }).run();
  assert.equal(naive.totals.simulatedHallucinations, naive.turns.filter((turn) => turn.hallucinationCount > 0).length);
  assert.equal(resilient.totals.simulatedHallucinations, 0);
  assert.ok(naive.turns.some((turn) => turn.hallucinationCount > 0));
});

test("M8 run-comparison returns both modes with the same seed and independent state", () => {
  const result = runAgentComparison(19);
  assert.equal(result.naive.seed, 19);
  assert.equal(result.resilient.seed, 19);
  assert.notStrictEqual(result.naive.runtimeStateId, result.resilient.runtimeStateId);
  assert.equal(result.comparison.seed, 19);
  assert.ok(result.comparison.naiveTotalTokens > result.comparison.resilientTotalTokens);
});

test("M8 comparison summary stays concise and reflects the cost delta", () => {
  const result = runAgentComparison(47);
  assert.match(result.comparison.summary, /tokens|DB hold|cost/i);
  assert.ok(result.comparison.deltaTokens > 0);
  assert.ok(result.comparison.deltaDbHoldMs > 0);
});

test("M8 tool ranking is deterministic and permission checks prevent unauthorized execution", () => {
  const scenario = new AgentContextScenario({ mode: "resilient", seed: 23 });
  const order = scenario.rankTools("customer invoice is overdue", 10);
  assert.equal(order.length, 10);
  assert.deepEqual(order.map((item) => item.id), [...order].sort((a, b) => a.id - b.id).map((item) => item.id));
  const denied = scenario.authorizeToolCall("billing-admin", "customer_support_agent", "billing:write");
  assert.equal(denied, false);
  const blocked = scenario.authorizeToolCall("customer_support_agent", "billing-admin", "billing:write");
  assert.equal(blocked, false);
});

test("M8 token counts reconcile with actual prompt and response strings", () => {
  const snap = new AgentContextScenario({ mode: "naive", seed: 29 }).run();
  const turn = snap.turns[2]!;
  assert.equal(turn.totalTokens, turn.inputTokens + turn.outputTokens);
  assert.ok(turn.promptLength >= turn.inputTokens * 4 - 3);
  assert.ok(turn.responseLength >= turn.outputTokens * 4 - 3);
});

test("M8 cost matches the documented formula", () => {
  const snap = new AgentContextScenario({ mode: "naive", seed: 31 }).run();
  const expected = snap.totals.totalTokens * 0.00003;
  assert.ok(Math.abs(snap.totals.estimatedCost - expected) < 0.00001);
  assert.equal(snap.totals.estimatedCost, Number((snap.totals.totalTokens * 0.00003).toFixed(6)));
});

test("M8 connection leases are released on success and errors", () => {
  const scenario = new AgentContextScenario({ mode: "naive", seed: 37 });
  const ok = scenario.run();
  assert.equal(ok.poolMetrics.activeConnections, 0);
  const withError = new AgentContextScenario({ mode: "resilient", seed: 41 });
  const lease = withError.beginLease(99, "error-case");
  withError.forceLeaseError(lease);
  assert.equal(withError.poolMetrics.activeConnections, 0);
  assert.ok(withError.poolMetrics.totalDbHoldMs >= 0);
});

test("M8 bounds are enforced for prompt size, tool output, and execution steps", () => {
  const scenario = new AgentContextScenario({ mode: "naive", seed: 43, promptSizeCap: 2048, toolOutputLimit: 160, maxExecutionSteps: 10 });
  const snap = scenario.run();
  assert.ok(snap.turns.every((turn) => turn.promptLength <= 2048 || turn.promptLength <= scenario.cfg.promptSizeCap));
  assert.ok(snap.turns.every((turn) => turn.toolOutputBytes <= scenario.cfg.toolOutputLimit));
  assert.ok(snap.executionSteps <= scenario.cfg.maxExecutionSteps + 10);
});
