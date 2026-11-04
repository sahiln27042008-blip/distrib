import test from "node:test";
import assert from "node:assert/strict";

import { createWorkflowTool } from "../src/mcp/tools/create-workflow.ts";
import { insertNodeTool } from "../src/mcp/tools/insert-node.ts";
import { auditWorkflowReliability, workflowToCompiledGraph } from "../src/mcp/tools/workflow-tools.ts";
import { getWorkflow } from "../src/compiler/workflow-store.ts";

const WORKFLOW_ID = "test-pipeline";

test("atomic chord builder and deterministic audit", async () => {
  const unknownA = await auditWorkflowReliability({ workflowId: "det", seed: 42817, maxDepth: 2 });
  const unknownB = await auditWorkflowReliability({ workflowId: "det2", seed: 42817, maxDepth: 2 });
  assert.deepEqual(unknownA, unknownB);

  const created = await createWorkflowTool.handler({
    workflowId: WORKFLOW_ID,
    name: "Test Pipeline",
    description: "Deterministic reliability smoke test for atomic chord workflow construction.",
  });
  assert.equal(created.success, true);

  const inserted = await insertNodeTool.handler({
    workflowId: WORKFLOW_ID,
    nodeId: "postgres_pool",
    name: "Postgres Pool",
    vowels: {
      LEASE: { poolCapacity: 20, timeoutMs: 5000, arrivalRate: 0.25 },
      REGISTER: { durable: true, schema: "orders" },
    },
  });
  assert.equal(inserted.success, true);

  await insertNodeTool.handler({
    workflowId: WORKFLOW_ID,
    nodeId: "client_ingress",
    name: "Client Ingress",
    vowels: {
      CHANNEL: { targetNodeId: "postgres_pool", idempotencyKey: false, timeoutMs: 5000 },
    },
  });

  await insertNodeTool.handler({
    workflowId: WORKFLOW_ID,
    nodeId: "llm_streamer",
    name: "LLM Streamer",
    vowels: {
      LOG: { maxTokens: 1000, retentionMs: 60_000 },
    },
    consonants: {
      TIMING: 30_000,
    },
  });

  await insertNodeTool.handler({
    workflowId: WORKFLOW_ID,
    nodeId: "payment_gateway",
    name: "Payment Gateway",
    vowels: {
      CHANNEL: { targetNodeId: "client_ingress", idempotencyKey: false, timeoutMs: 9000 },
    },
    consonants: {
      OMISSION: "ACK",
    },
  });

  const storedWorkflow = getWorkflow(WORKFLOW_ID);
  assert.ok(storedWorkflow);
  const compiledGraph = workflowToCompiledGraph(storedWorkflow);
  assert.ok(compiledGraph.candidatePerturbations.some((candidate) =>
    candidate.consonant.kind === "DELAY" &&
    candidate.consonant.durationMs === 30_000 &&
    candidate.targetId === "vowel-3-1"
  ));

  const result1 = await auditWorkflowReliability({ workflowId: WORKFLOW_ID, seed: 42817, maxDepth: 2 });
  const result2 = await auditWorkflowReliability({ workflowId: WORKFLOW_ID, seed: 42817, maxDepth: 2 });

  assert.equal(result1.success, true);
  assert.ok(Number.isFinite(result1.bfsDurationMs));
  assert.deepEqual(
    result1.violatedInvariants.map((entry: any) => entry.id).sort(),
    [...result1.baseline.violatedInvariants].sort(),
  );
  assert.equal(result1.counterexample !== null, result1.baseline.status === "FAILURE_FOUND");
  assert.equal(result1.gate, "BLOCKED");
  assert.ok(result1.affectedNodes.includes("llm_streamer"));
  assert.ok(result1.affectedNodes.includes("payment_gateway"));
  assert.equal(result1.workflowId, result2.workflowId);
  assert.equal(result1.baseline.status, result2.baseline.status);
  assert.deepEqual(result1.baseline.violatedInvariants, result2.baseline.violatedInvariants);
  assert.deepEqual(result1.violatedInvariants, result2.violatedInvariants);
  assert.equal(result1.gate, result2.gate);
});
