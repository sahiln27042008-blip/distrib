// enterpriseee/enterprise-simulator/test/mcp/forward-reference-audit.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { createWorkflow, insertNode, clearWorkflows, connectNodes, updateNode } from "../../src/compiler/workflow-store.ts";
import { workflowToGraph, auditWorkflowReliabilityTool } from "../../src/mcp/tools/causal-audit.ts";

test("Forward reference acceptance test: audit succeeds on partial graph without throwing", async () => {
  clearWorkflows();

  // 1. Create a workflow
  const wf = createWorkflow("wf-fwd-test", "Forward Reference Test Workflow");

  // 2. Insert Node A with forward reference to "Node B" which does not exist yet
  insertNode(wf.id, {
    nodeName: "Node A",
    nodeDescription: "Streaming LLM Agent Orchestrator",
    substrates: [
      { vowel: "REGISTER", params: { volatility: "VOLATILE" } },
      { vowel: "LOG", params: { retention: 30 } },
    ],
    consonants: [
      { kind: "DELAY", params: { durationMs: 500 } },
    ],
    outboundEdges: ["Node B"],
  });

  // 3. Convert to graph and assert it does NOT throw
  const graphPartial = workflowToGraph(wf);
  assert.ok(graphPartial, "Graph should compile successfully");
  assert.equal(graphPartial.actors.length, 1, "Should have 1 actor for Node A");
  assert.ok(graphPartial.epistemicStatus.includes("INFERRED"), "Epistemic status must include INFERRED");
  assert.ok(
    graphPartial.unrepresentableSemantics.some((s) => s.includes("unresolved outbound edges") && s.includes("Node B")),
    "Unrepresentable semantics must list the unresolved edge to Node B"
  );
  assert.ok(Array.isArray(graphPartial.unresolvedEdges), "unresolvedEdges array should be present");
  assert.equal(graphPartial.unresolvedEdges?.length, 1);
  assert.equal(graphPartial.unresolvedEdges?.[0]?.source, "Node A");
  assert.equal(graphPartial.unresolvedEdges?.[0]?.target, "Node B");

  // 4. Call audit_workflow_reliability tool directly on the partial workflow using workflowId
  const auditRes1 = await auditWorkflowReliabilityTool.handler({
    workflowId: wf.id,
    maxDepth: 1,
    seed: 42,
  });

  assert.equal(auditRes1.success, true, "Audit must run and return success: true");
  assert.ok(auditRes1.verdict, "Audit should return a verdict");

  // 5. Now create Node B
  insertNode(wf.id, {
    nodeName: "Node B",
    nodeDescription: "Bank Verification API",
    substrates: [
      { vowel: "REGISTER", params: { idempotencyEnforced: true } },
    ],
    consonants: [
      { kind: "DELAY", params: { durationMs: 1000 } },
    ],
    outboundEdges: [],
  });

  // 6. Call audit again and assert edge now resolves completely
  const graphComplete = workflowToGraph(wf);
  assert.equal(graphComplete.actors.length, 2, "Should have 2 actors");
  assert.deepEqual(graphComplete.epistemicStatus, ["OBSERVED"], "Fully resolved graph should be OBSERVED");
  assert.equal(graphComplete.channels.length, 1, "Channel between A and B should now exist");
  assert.equal(graphComplete.unresolvedEdges?.length ?? 0, 0, "No unresolved edges remaining");

  const auditRes2 = await auditWorkflowReliabilityTool.handler({
    workflowId: wf.id,
    maxDepth: 1,
    seed: 42,
  });

  assert.equal(auditRes2.success, true, "Audit must succeed on complete graph");
  assert.ok(auditRes2.verdict, "Audit should return verdict");
});

test("connect_nodes and update_node tools allow out-of-order authoring", async () => {
  clearWorkflows();

  const wf = createWorkflow("wf-connect-test", "Connect Nodes Test");

  // Insert two nodes with no edges initially
  insertNode(wf.id, {
    nodeName: "Client Gateway",
    substrates: [{ vowel: "REGISTER", params: {} }],
  });
  insertNode(wf.id, {
    nodeName: "Postgres Database",
    substrates: [{ vowel: "CELL", params: { durable: true } }],
  });

  // Connect them after creation
  const connectRes = connectNodes(wf.id, "Client Gateway", "Postgres Database", { timeoutMs: 2000 });
  assert.equal(connectRes.fromNode, "Client Gateway");
  assert.equal(connectRes.toNode, "Postgres Database");
  assert.deepEqual(connectRes.outboundEdges, ["Postgres Database"]);

  // Update Postgres Database with an extra substrate and consonant
  const updateRes = updateNode(wf.id, "Postgres Database", {
    substrates: [
      { vowel: "CELL", params: { durable: true } },
      { vowel: "LEASE", params: { capacity: 300 } },
    ],
    consonants: [{ kind: "SATURATE", params: { loadUnits: 100 } }],
  });

  assert.equal(updateRes.node.substrates.length, 2);
  assert.equal(updateRes.node.consonants?.length, 1);

  // Compile to graph
  const graph = workflowToGraph(wf);
  assert.equal(graph.actors.length, 2);
  assert.equal(graph.channels.length, 1);
  assert.deepEqual(graph.epistemicStatus, ["OBSERVED"]);
});
