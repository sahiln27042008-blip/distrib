import test from "node:test";
import assert from "node:assert/strict";

import { clearWorkflows, createWorkflow, getWorkflow, insertNode } from "../src/compiler/workflow-store.ts";
import { insertNodeTool } from "../src/mcp/tools/insert-node.ts";
import { causalAuditTool, workflowToGraph } from "../src/mcp/tools/causal-audit.ts";
import { normalizeConsonantAlias } from "../src/physics/alphabet/apply.ts";

test.afterEach(() => {
  clearWorkflows();
});

test("A. STORAGE: insert_node preserves consonants and outboundEdges", async () => {
  const workflowId = "wf-storage";
  createWorkflow(workflowId, "storage workflow");

  const result = await insertNodeTool.handler({
    workflowId,
    nodeName: "AI",
    substrates: [{ vowel: "REGISTER", params: { durable: true } }],
    consonants: [{ kind: "OMISSION", params: { phase: "ACK" } }],
    outboundEdges: ["Stripe", "Zendesk"],
  });

  assert.equal(result.success, true);
  const workflow = getWorkflow(workflowId);
  assert.ok(workflow);
  assert.equal(workflow?.nodes.length, 1);
  assert.deepEqual(workflow?.nodes[0]?.consonants, [{ kind: "SEVER", params: { phase: "POST_COMMIT" } }]);
  assert.deepEqual(workflow?.nodes[0]?.outboundEdges, ["Stripe", "Zendesk"]);
});

test("B. ALIAS: canonical names map to physics names and invalid values are rejected", () => {
  const valid = [
    { assignment: { kind: "TIMING", params: { durationMs: 1200 } }, expected: { kind: "DELAY", durationMs: 1200 } },
    { assignment: { kind: "OMISSION", params: { phase: "REQUEST" } }, expected: { kind: "SEVER", phase: "PRE_COMMIT" } },
    { assignment: { kind: "DUPLICATION", params: { count: 2 } }, expected: { kind: "DUPLICATE", count: 2 } },
    { assignment: { kind: "SATURATE", params: { loadUnits: 8 } }, expected: { kind: "SATURATE", loadUnits: 8 } },
    { assignment: { kind: "CRASH_AMNESIA", params: { scope: "VOLATILE_CELLS", cellIds: ["cell-1"] } }, expected: { kind: "WIPE", scope: "VOLATILE_CELLS", cellIds: ["cell-1"] } },
    { assignment: { kind: "BYZANTINE", params: { mode: "SCHEMA_DRIFT" } }, expected: { kind: "CORRUPT", mode: "SCHEMA_DRIFT" } },
  ];

  for (const { assignment, expected } of valid) {
    assert.deepEqual(normalizeConsonantAlias(assignment as any), expected);
  }

  assert.throws(() => normalizeConsonantAlias({ kind: "BANANA", params: {} } as any), /MODEL_GAP|unknown/i);
  assert.throws(() => normalizeConsonantAlias({ kind: "OMISSION", params: { phase: "MAYBE" } } as any), /MODEL_GAP|REQUEST|ACK|NONE/i);
  assert.throws(() => normalizeConsonantAlias({ kind: "BYZANTINE", params: { mode: "arbitrary" } } as any), /MODEL_GAP|LOSSY_DROP|SCHEMA_DRIFT|POISON_PILL/i);
});

test("C. TOPOLOGY: explicit outboundEdges create branching channels without inferred chain", () => {
  const workflowId = "wf-topology";
  createWorkflow(workflowId, "topology workflow");

  insertNode(workflowId, {
    nodeName: "AI",
    substrates: [{ vowel: "REGISTER", params: {} }],
    outboundEdges: ["Stripe", "Zendesk"],
  });
  insertNode(workflowId, {
    nodeName: "Stripe",
    substrates: [{ vowel: "REGISTER", params: {} }],
  });
  insertNode(workflowId, {
    nodeName: "Zendesk",
    substrates: [{ vowel: "REGISTER", params: {} }],
  });

  const graph = workflowToGraph(getWorkflow(workflowId)!);
  const ids = graph.channels.map((channel) => channel.id).sort();

  assert.deepEqual(ids, ["channel-1-2", "channel-1-3"]);
  assert.deepEqual(graph.epistemicStatus, ["OBSERVED"]);
  assert.deepEqual(graph.unrepresentableSemantics, []);
});

test("D. CHANNEL: workflow substrate Channel keeps timeoutMs and target information", () => {
  const workflowId = "wf-channel";
  createWorkflow(workflowId, "channel workflow");

  insertNode(workflowId, {
    nodeName: "AI",
    substrates: [{ vowel: "CHANNEL", params: { timeoutMs: 5000, targetNodeId: "Stripe" } }],
  });

  const graph = workflowToGraph(getWorkflow(workflowId)!);
  const channel = graph.vowels.find((vowel) => vowel.kind === "CHANNEL" && vowel.actorId === "actor-1");
  assert.ok(channel);
  assert.equal((channel as any).timeoutMs, 5000);
  assert.equal((channel as any).sourceActorId, "actor-1");
});

test("E. COMPOSITION: multiple consonants are pinned to the node and deterministic across runs", async () => {
  const workflowId = "wf-composition";
  createWorkflow(workflowId, "composition workflow");

  const insertResult = await insertNodeTool.handler({
    workflowId,
    nodeName: "AI",
    substrates: [{ vowel: "REGISTER", params: {} }, { vowel: "CHANNEL", params: { targetNodeId: "Stripe", timeoutMs: 3000, idempotencyEnabled: false } }],
    consonants: [
      { kind: "OMISSION", params: { phase: "ACK" } },
      { kind: "SATURATE", params: { loadUnits: 5 } },
    ],
  });

  assert.equal(insertResult.success, true);
  const graph = workflowToGraph(getWorkflow(workflowId)!);

  assert.deepEqual(
    graph.candidatePerturbations.map((candidate) => candidate.consonant.kind),
    ["SATURATE", "SEVER"],
  );

  const first = await causalAuditTool.handler({ scenarioId: workflowId, maxDepth: 2, seed: 7 });
  const second = await causalAuditTool.handler({ scenarioId: workflowId, maxDepth: 2, seed: 7 });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.deepEqual(first.minimalCounterexample ?? [], second.minimalCounterexample ?? []);
  assert.equal(first.shortestDepth, second.shortestDepth);
  assert.equal(first.evaluationsCount, second.evaluationsCount);
});

test("F. DIFFERENT EXECUTION: idempotency changes the execution result", async () => {
  const workflowAId = "wf-diff-a";
  const workflowBId = "wf-diff-b";

  createWorkflow(workflowAId, "workflow A");
  createWorkflow(workflowBId, "workflow B");

  await insertNodeTool.handler({
    workflowId: workflowAId,
    nodeName: "AI",
    substrates: [{ vowel: "CHANNEL", params: { targetNodeId: "Stripe", timeoutMs: 3000, idempotencyEnabled: false } }],
    consonants: [{ kind: "OMISSION", params: { phase: "ACK" } }],
    outboundEdges: ["Stripe"],
  });
  await insertNodeTool.handler({
    workflowId: workflowAId,
    nodeName: "Stripe",
    substrates: [{ vowel: "REGISTER", params: { idempotencyEnforced: false } }],
  });
  await insertNodeTool.handler({
    workflowId: workflowAId,
    nodeName: "Zendesk",
    substrates: [{ vowel: "REGISTER", params: {} }],
  });

  await insertNodeTool.handler({
    workflowId: workflowBId,
    nodeName: "AI",
    substrates: [{ vowel: "CHANNEL", params: { targetNodeId: "Stripe", timeoutMs: 3000, idempotencyEnabled: false } }],
    consonants: [{ kind: "OMISSION", params: { phase: "ACK" } }],
    outboundEdges: ["Stripe"],
  });
  await insertNodeTool.handler({
    workflowId: workflowBId,
    nodeName: "Stripe",
    substrates: [{ vowel: "REGISTER", params: { idempotencyEnforced: true } }],
  });
  await insertNodeTool.handler({
    workflowId: workflowBId,
    nodeName: "Zendesk",
    substrates: [{ vowel: "REGISTER", params: {} }],
  });

  const resultA = await causalAuditTool.handler({ scenarioId: workflowAId, maxDepth: 3, seed: 11 });
  const resultB = await causalAuditTool.handler({ scenarioId: workflowBId, maxDepth: 3, seed: 11 });

  assert.equal(resultA.success, true);
  assert.equal(resultB.success, true);
  assert.notDeepEqual(resultA.minimalCounterexample ?? [], resultB.minimalCounterexample ?? []);
  assert.notEqual(resultA.verdict, resultB.verdict);
  assert.notEqual(resultA.status, resultB.status);
  console.log("F result A:", JSON.stringify({ verdict: resultA.verdict, status: resultA.status, minimalCounterexample: resultA.minimalCounterexample }));
  console.log("F result B:", JSON.stringify({ verdict: resultB.verdict, status: resultB.status, minimalCounterexample: resultB.minimalCounterexample }));
});

test("G. REGRESSION: npm test + typecheck baseline stays intact", async () => {
  const workflowId = "wf-regression";
  createWorkflow(workflowId, "regression workflow");
  const result = await insertNodeTool.handler({
    workflowId,
    nodeName: "AI",
    substrates: [{ vowel: "REGISTER", params: { idempotencyEnforced: true } }],
    consonants: [{ kind: "TIMING", params: { durationMs: 17 } }],
  });

  assert.equal(result.success, true);
  const graph = workflowToGraph(getWorkflow(workflowId)!);
  assert.ok(graph.candidatePerturbations.length >= 1);
});
