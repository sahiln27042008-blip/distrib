// enterpriseee/enterprise-simulator/test/mcp/memory-compaction.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { createWorkflow, insertNode, clearWorkflows } from "../../src/compiler/workflow-store.ts";
import { listWorkflowsTool } from "../../src/mcp/tools/list-workflows.ts";
import { runAgentLoop } from "../../src/mcp/agent-loop.ts";

test("list_workflows tool correctly returns all stored workflows and node counts", async () => {
  clearWorkflows();

  const wf1 = createWorkflow("wf-bank-1", "Bank Checkout Flow", ["inv-idempotency"], "Checkout workflow with Stripe and Postgres");
  insertNode(wf1.id, { nodeName: "Gateway", substrates: [{ vowel: "CHANNEL", params: {} }] });
  insertNode(wf1.id, { nodeName: "Postgres", substrates: [{ vowel: "CELL", params: {} }] });

  const res = await listWorkflowsTool.handler({});
  assert.equal(res.success, true);
  assert.equal(res.count, 1);
  const wfs = res.workflows as any[];
  assert.equal(wfs[0].id, wf1.id);
  assert.equal(wfs[0].name, "Bank Checkout Flow");
  assert.equal(wfs[0].nodesCount, 2);
  assert.deepEqual(wfs[0].nodes, ["Gateway", "Postgres"]);
});

test("Agent loop preserves initial user message and server workflow state when history > 30", async () => {
  clearWorkflows();

  const wf = createWorkflow("wf-arch-preserve", "Production Infra Case Study");
  insertNode(wf.id, { nodeName: "Edge Gateway", substrates: [{ vowel: "CHANNEL", params: {} }] });

  const initialUserSystemDesc = "My system has Cloudflare + Postgres pool (max 300) + Bank API with rate limit 500/min.";
  const history: any[] = [
    { role: "system", content: "You are the Causal Reliability Engineer." },
    { role: "user", content: initialUserSystemDesc },
  ];

  // Grow history to 35 messages with mock tool calls
  for (let i = 0; i < 16; i++) {
    const callId = `call_${i}`;
    history.push({
      role: "assistant",
      content: `Calling step ${i}`,
      tool_calls: [{ id: callId, name: "describe_system", arguments: {} }],
    });
    history.push({
      role: "tool",
      tool_call_id: callId,
      content: JSON.stringify({ step: i, status: "ok" }),
    });
  }

  assert.ok(history.length > 30, "History should exceed 30 messages before runAgentLoop");

  // Mock orchestrator that verifies it still sees the initial user system description
  let receivedFirstUserContent = "";
  let receivedWorkflowMemory = false;

  const mockOrchestrator = {
    chat: async (msgs: any[], _tools: any[]) => {
      const firstUser = msgs.find((m) => m.role === "user");
      receivedFirstUserContent = firstUser?.content || "";
      receivedWorkflowMemory = msgs.some((m) =>
        typeof m.content === "string" && m.content.includes("wf-arch-preserve")
      );
      return {
        text: "Understood. The architecture remains in memory.",
        tool_calls: [],
      };
    },
  };

  const loopRes = await runAgentLoop({
    history,
    userText: "What evidence do you need?",
    tools: [listWorkflowsTool],
    orchestrator: mockOrchestrator as any,
  });

  assert.ok(loopRes.text, "Agent loop should succeed");
  assert.equal(
    receivedFirstUserContent,
    initialUserSystemDesc,
    "The first user message (system description) MUST be preserved in compacted memory"
  );
  assert.equal(
    receivedWorkflowMemory,
    true,
    "Server workflow store context (wf-arch-preserve) MUST be injected into memory"
  );
});

