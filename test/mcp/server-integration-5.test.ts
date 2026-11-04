import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startMcpServer, TOOLS } from "../../src/mcp/server.ts";
import { MockOrchestrator } from "../../src/llm/orchestrator-mock.ts";
import { createWorkflowTool } from "../../src/mcp/tools/create-workflow.ts";
import { clearWorkflows } from "../../src/compiler/workflow-store.ts";

function httpRequest(
  port: number,
  path: string,
  body: Record<string, unknown>,
  sessionId?: string,
): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ statusCode: res.statusCode ?? 0, body: JSON.parse(text) });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

async function initialize(port: number): Promise<string> {
  const response = await httpRequest(port, "/initialize", {});
  assert.equal(response.statusCode, 200);
  const sessionId = response.body.sessionId ?? response.body.result?.sessionId;
  assert.equal(typeof sessionId, "string");
  return sessionId;
}

function toolsWithMockCompiler() {
  return TOOLS.map((registeredTool) => {
    if (registeredTool.name !== createWorkflowTool.name) return registeredTool;
    return {
      ...registeredTool,
      handler: (args: Record<string, unknown>, context?: Record<string, unknown>) =>
        createWorkflowTool.handler(args, { ...context, orchestrator: new MockOrchestrator() }),
    };
  });
}

async function createWorkflow(port: number, sessionId: string): Promise<string> {
  const response = await httpRequest(
    port,
    "/tools/call",
    {
      name: "create_workflow",
      arguments: { systemDescription: "Stripe refund payment settlement workflow" },
    },
    sessionId,
  );
  const result = response.body.result ?? response.body;
  assert.equal(response.statusCode, 200);
  assert.equal(result.success, true);
  assert.ok(typeof result.workflowId === "string" && result.workflowId.length > 0);
  return result.workflowId;
}

test("tools/list returns 15 tools including create_workflow and insert_node", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const sessionId = await initialize(mcp.port);
    const response = await httpRequest(mcp.port, "/tools/list", {}, sessionId);
    const tools = response.body.tools ?? response.body.result?.tools;

    assert.equal(response.statusCode, 200);
    assert.equal(tools.length, 15);
    assert.ok(tools.some((tool: { name: string }) => tool.name === "create_workflow"));
    assert.ok(tools.some((tool: { name: string }) => tool.name === "insert_node"));
  } finally {
    await mcp.close();
  }
});

test("tools/call with create_workflow returns a workflow ID", async () => {
  clearWorkflows();
  const mcp = await startMcpServer({ port: 0, tools: toolsWithMockCompiler() });
  try {
    const sessionId = await initialize(mcp.port);
    const workflowId = await createWorkflow(mcp.port, sessionId);
    assert.ok(workflowId.length > 0);
  } finally {
    await mcp.close();
    clearWorkflows();
  }
});

test("tools/call with insert_node adds a node to the workflow", async () => {
  clearWorkflows();
  const mcp = await startMcpServer({ port: 0, tools: toolsWithMockCompiler() });
  try {
    const sessionId = await initialize(mcp.port);
    const workflowId = await createWorkflow(mcp.port, sessionId);
    const insertResponse = await httpRequest(
      mcp.port,
      "/tools/call",
      {
        name: "insert_node",
        arguments: {
          workflowId,
          nodeName: "Stripe Payment Gateway",
          nodeDescription: "Executes refund settlement",
          substrates: [{ vowel: "CHANNEL", params: { timeoutMs: 8000, idempotencyEnabled: false } }],
        },
      },
      sessionId,
    );
    const insertResult = insertResponse.body.result ?? insertResponse.body;

    assert.equal(insertResponse.statusCode, 200);
    assert.equal(insertResult.success, true);
    assert.equal(insertResult.nodeIndex, 1);
    assert.equal(insertResult.node.nodeName, "Stripe Payment Gateway");
    assert.equal(insertResult.compiledSubstrates[0].vowel, "CHANNEL");
  } finally {
    await mcp.close();
    clearWorkflows();
  }
});