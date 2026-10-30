// enterpriseee/enterprise-simulator/test/mcp/workflow-tools.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { createWorkflowTool } from "../../src/mcp/tools/create-workflow.ts";
import { insertNodeTool } from "../../src/mcp/tools/insert-node.ts";
import { getWorkflow, clearWorkflows, listWorkflows } from "../../src/compiler/workflow-store.ts";

test.beforeEach(() => {
  clearWorkflows();
});

test("create_workflow returns a workflow ID", async () => {
  const result = await createWorkflowTool.handler({
    systemDescription:
      "Stripe payment checkout flow with Redis idempotency cache and PostgreSQL transaction ledger",
    declaredInvariants: ["payment_safety", "idempotency"],
  });

  assert.equal(result.success, true);
  assert.ok(typeof result.workflowId === "string" && result.workflowId.length > 0);
  assert.ok(typeof result.name === "string" && result.name.length > 0);
  assert.ok(Array.isArray(result.declaredInvariants));
  assert.ok(result.declaredInvariants.includes("payment_safety"));

  // Verify stored in workflow store
  const stored = getWorkflow(result.workflowId as string);
  assert.ok(stored);
  assert.equal(stored.id, result.workflowId);
  assert.equal(stored.nodes.length, 0);
  assert.ok(listWorkflows().includes(result.workflowId as string));
});

test("insert_node adds nodes in sequence 1, 2, 3", async () => {
  const initRes = await createWorkflowTool.handler({
    systemDescription: "Multi-step refund approval and settlement pipeline",
  });
  assert.equal(initRes.success, true);
  const workflowId = initRes.workflowId as string;

  // Insert node 1
  const node1Res = await insertNodeTool.handler({
    workflowId,
    nodeName: "API Ingress Gateway",
    nodeDescription: "Rate-limited entry point for payment settlement requests",
    substrates: [
      {
        vowel: "LEASE",
        params: { id: "lease-admission", maxCapacity: 20, ttlMs: 5000, overflowPolicy: "REJECT_429" },
      },
      {
        vowel: "CHANNEL",
        params: { id: "chan-ingress", timeoutMs: 5000 },
      },
    ],
  });

  assert.equal(node1Res.success, true);
  assert.equal(node1Res.nodeIndex, 1);
  assert.equal(node1Res.totalNodes, 1);
  assert.equal((node1Res.node as any).nodeName, "API Ingress Gateway");

  // Insert node 2
  const node2Res = await insertNodeTool.handler({
    workflowId,
    nodeName: "Postgres Task State & Pool",
    nodeDescription: "Leased connection pool and durable state record",
    substrates: [
      {
        vowel: "LEASE",
        params: { id: "lease-pg-pool", maxCapacity: 5, ttlMs: 5000, overflowPolicy: "WAIT_TIMEOUT" },
      },
      {
        vowel: "REGISTER",
        params: { id: "cell-task-state", persistence: "DURABLE", idempotencyEnforced: true },
      },
    ],
  });

  assert.equal(node2Res.success, true);
  assert.equal(node2Res.nodeIndex, 2);
  assert.equal(node2Res.totalNodes, 2);
  assert.equal((node2Res.node as any).nodeName, "Postgres Task State & Pool");

  // Insert node 3
  const node3Res = await insertNodeTool.handler({
    workflowId,
    nodeName: "Stripe External Gateway",
    nodeDescription: "Payment charge and refund settlement channel",
    substrates: [
      {
        vowel: "CHANNEL",
        params: { id: "chan-payment", timeoutMs: 8000, retryPolicy: { maxRetries: 2 } },
      },
      {
        vowel: "REGISTER",
        params: { id: "cell-payment-ledger", persistence: "DURABLE", idempotencyEnforced: true },
      },
    ],
  });

  assert.equal(node3Res.success, true);
  assert.equal(node3Res.nodeIndex, 3);
  assert.equal(node3Res.totalNodes, 3);
  assert.equal((node3Res.node as any).nodeName, "Stripe External Gateway");
});

test("getWorkflow returns all nodes with substrates", async () => {
  const initRes = await createWorkflowTool.handler({
    systemDescription: "Autonomous support agent refund workflow",
    declaredInvariants: ["payment_safety", "resource_safety"],
  });
  const workflowId = initRes.workflowId as string;

  // Insert 2 nodes
  await insertNodeTool.handler({
    workflowId,
    nodeName: "Node A",
    nodeDescription: "First node",
    substrates: [{ vowel: "LOG", params: { id: "log-events", maxCapacity: 100 } }],
  });

  await insertNodeTool.handler({
    workflowId,
    nodeName: "Node B",
    nodeDescription: "Second node",
    substrates: [{ vowel: "CHANNEL", params: { id: "chan-tool", timeoutMs: 4000 } }],
  });

  const workflow = getWorkflow(workflowId);
  assert.ok(workflow);
  assert.equal(workflow.id, workflowId);
  assert.equal(workflow.nodes.length, 2);

  assert.equal(workflow.nodes[0]?.index, 1);
  assert.equal(workflow.nodes[0]?.nodeName, "Node A");
  assert.equal(workflow.nodes[0]?.substrates[0]?.vowel, "LOG");

  assert.equal(workflow.nodes[1]?.index, 2);
  assert.equal(workflow.nodes[1]?.nodeName, "Node B");
  assert.equal(workflow.nodes[1]?.substrates[0]?.vowel, "CHANNEL");
});

test("Tools handle missing workflowId gracefully", async () => {
  // Missing workflowId in insert_node
  const missingIdRes = await insertNodeTool.handler({
    nodeName: "Ghost Node",
    substrates: [{ vowel: "REGISTER", params: {} }],
  });
  assert.equal(missingIdRes.success, false);
  assert.match(String(missingIdRes.error), /workflowId is required/i);

  // Non-existent workflowId in insert_node
  const unknownIdRes = await insertNodeTool.handler({
    workflowId: "nonexistent-wf-12345",
    nodeName: "Ghost Node",
    substrates: [{ vowel: "REGISTER", params: {} }],
  });
  assert.equal(unknownIdRes.success, false);
  assert.match(String(unknownIdRes.error), /not found/i);

  // Missing nodeName in insert_node
  const missingNodeNameRes = await insertNodeTool.handler({
    workflowId: "any-id",
    substrates: [],
  });
  assert.equal(missingNodeNameRes.success, false);
  assert.match(String(missingNodeNameRes.error), /nodeName is required/i);

  // Missing systemDescription in create_workflow
  const missingDescRes = await createWorkflowTool.handler({});
  assert.equal(missingDescRes.success, false);
  assert.match(String(missingDescRes.error), /systemDescription is required/i);
});

