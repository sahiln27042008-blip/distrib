import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startMcpServer, type McpServerInstance } from "../../src/mcp/server.ts";
import { runAgentLoop, type McpTool } from "../../src/mcp/agent-loop.ts";
import { MockOrchestrator } from "../../src/llm/orchestrator-mock.ts";
import type { Orchestrator, OrchestratorMessage } from "../../src/llm/orchestrator.ts";

function httpRequest(
  port: number,
  options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: any;
  }
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const payload =
      options.body !== undefined
        ? typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body)
        : undefined;

    const headers: Record<string, string> = {
      ...(options.headers || {}),
    };
    if (payload !== undefined && !headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (payload !== undefined && !headers["Content-Length"] && !headers["content-length"]) {
      headers["Content-Length"] = Buffer.byteLength(payload).toString();
    }

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: options.path,
        method: options.method,
        headers,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on("data", chunk => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let body: any = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            // Keep raw text if not JSON
          }
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body,
            raw,
          });
        });
      }
    );

    req.on("error", reject);
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

test("GET /health returns 200", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const res = await httpRequest(mcp.port, {
      method: "GET",
      path: "/health",
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, "healthy");
    assert.equal(res.body.ok, true);
  } finally {
    await mcp.close();
  }
});

test("POST /initialize returns a session ID", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const res = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    assert.equal(res.statusCode, 200);
    const sessionId = res.body.sessionId || res.body.result?.sessionId;
    assert.ok(sessionId, "expected sessionId in response");
    assert.equal(typeof sessionId, "string");
    assert.equal(res.headers["mcp-session-id"], sessionId);
    assert.ok(mcp.sessions.has(sessionId));
  } finally {
    await mcp.close();
  }
});

test("POST /tools/list (with session) returns the tool list", async () => {
  const mockTool: McpTool = {
    name: "dummy_tool",
    description: "A dummy tool for testing",
    inputSchema: { type: "object", properties: { input: { type: "string" } } },
    handler: async args => ({ received: args }),
  };
  const mcp = await startMcpServer({ port: 0, tools: [mockTool] });
  try {
    // 1. Initialize session
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId;

    // 2. Request tools list
    const res = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/list",
      headers: { "Mcp-Session-Id": sessionId },
      body: {},
    });
    assert.equal(res.statusCode, 200);
    const tools = res.body.tools || res.body.result?.tools;
    assert.ok(Array.isArray(tools));
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "dummy_tool");
  } finally {
    await mcp.close();
  }
});

test("POST /tools/call with unknown tool returns error", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId;

    const res = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/call",
      headers: { "Mcp-Session-Id": sessionId },
      body: { name: "completely_unknown_tool", arguments: {} },
    });

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.isError || res.body.error);
    const msg = res.body.error?.message || res.body.message || "";
    assert.match(msg, /Unknown tool/i);
  } finally {
    await mcp.close();
  }
});

test("POST /tools/call with registered tool succeeds", async () => {
  const sampleTool: McpTool = {
    name: "ping_tool",
    description: "Returns pong",
    handler: async (args, context) => ({ pong: true, arg: args.val, sid: context?.sessionId }),
  };
  const mcp = await startMcpServer({ port: 0, tools: [sampleTool] });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId;

    const res = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/call",
      headers: { "Mcp-Session-Id": sessionId },
      body: { name: "ping_tool", arguments: { val: 42 } },
    });

    assert.equal(res.statusCode, 200);
    const content = res.body.content || res.body.result?.content;
    assert.ok(Array.isArray(content));
    assert.ok(content[0].text.includes("pong"));
    assert.ok(content[0].text.includes("42"));
  } finally {
    await mcp.close();
  }
});

test("POST /agent_message with 'describe my refund system' against mock orchestrator returns a toolCalls array containing describe_system", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId;

    const res = await httpRequest(mcp.port, {
      method: "POST",
      path: "/agent_message",
      headers: { "Mcp-Session-Id": sessionId },
      body: { text: "describe my refund system" },
    });

    assert.equal(res.statusCode, 200);
    const toolCalls = res.body.toolCalls || res.body.result?.toolCalls;
    assert.ok(Array.isArray(toolCalls), "toolCalls should be an array");
    assert.ok(toolCalls.length > 0, "toolCalls should not be empty");
    const describeCall = toolCalls.find((tc: any) => tc.name === "describe_system");
    assert.ok(describeCall, "expected describe_system tool call");
    assert.ok(describeCall.arguments.description.includes("refund"));
  } finally {
    await mcp.close();
  }
});

test("POST /agent_message with a simulated prior matrix result and 'audit it' returns a toolCalls array containing audit_trace", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId;

    const res = await httpRequest(mcp.port, {
      method: "POST",
      path: "/agent_message",
      headers: { "Mcp-Session-Id": sessionId },
      body: {
        text: "audit it and find issues",
        history: [
          {
            role: "tool",
            tool_call_id: "call-matrix-1",
            content: JSON.stringify({ traceId: "sim-trace-xyz-123", status: "completed" }),
          },
        ],
      },
    });

    assert.equal(res.statusCode, 200);
    const toolCalls = res.body.toolCalls || res.body.result?.toolCalls;
    assert.ok(Array.isArray(toolCalls), "toolCalls should be an array");
    assert.ok(toolCalls.length > 0, "toolCalls should not be empty");
    const auditCall = toolCalls.find((tc: any) => tc.name === "audit_trace");
    assert.ok(auditCall, "expected audit_trace tool call");
  } finally {
    await mcp.close();
  }
});

test("POST /reset_conversation clears session history", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId;

    // Send a message first
    await httpRequest(mcp.port, {
      method: "POST",
      path: "/agent_message",
      headers: { "Mcp-Session-Id": sessionId },
      body: { text: "describe my agent system" },
    });

    const sessionBefore = mcp.sessions.get(sessionId)!;
    assert.ok(sessionBefore.history.length > 0, "history should contain messages");

    // Reset conversation
    const res = await httpRequest(mcp.port, {
      method: "POST",
      path: "/reset_conversation",
      headers: { "Mcp-Session-Id": sessionId },
      body: {},
    });

    assert.equal(res.statusCode, 200);
    const cleared = res.body.cleared ?? res.body.result?.cleared;
    assert.equal(cleared, true);
    assert.equal(sessionBefore.history.length, 0, "history should be reset to empty");
  } finally {
    await mcp.close();
  }
});

test("Session TTL works (after 30 min idle, session is gone)", async () => {
  const mcp = await startMcpServer({
    port: 0,
    sessionTtlMs: 100, // 100ms TTL for testing
  });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId;
    assert.ok(mcp.sessions.has(sessionId));

    // Wait for TTL to expire
    await new Promise(r => setTimeout(r, 150));

    // Sweep sessions
    const swept = mcp.sweepSessions();
    assert.ok(swept >= 1);
    assert.equal(mcp.sessions.has(sessionId), false);

    // Request with expired session returns 401
    const res = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/list",
      headers: { "Mcp-Session-Id": sessionId },
      body: {},
    });
    assert.equal(res.statusCode, 401);
  } finally {
    await mcp.close();
  }
});

test("Loopback-only binding (refuses non-loopback Host header)", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const res = await httpRequest(mcp.port, {
      method: "GET",
      path: "/health",
      headers: {
        Host: "evil-attacker.com",
      },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "forbidden");
  } finally {
    await mcp.close();
  }
});

test("Unit test runAgentLoop with custom orchestrator and tools", async () => {
  let step = 0;
  const customOrchestrator: Orchestrator = {
    async chat(messages, tools) {
      step++;
      if (step === 1) {
        return {
          text: "",
          tool_calls: [
            {
              id: "call-1",
              name: "custom_math",
              arguments: { a: 5, b: 3 },
            },
          ],
          stop_reason: "tool_calls",
        };
      }
      return {
        text: "The sum is 8",
        tool_calls: [],
        stop_reason: "stop",
      };
    },
  };

  const history: OrchestratorMessage[] = [];
  const tools: McpTool[] = [
    {
      name: "custom_math",
      handler: async args => ({ sum: (args.a as number) + (args.b as number) }),
    },
  ];

  const result = await runAgentLoop({
    history,
    userText: "Add 5 and 3",
    tools,
    orchestrator: customOrchestrator,
  });

  assert.equal(result.text, "The sum is 8");
  assert.equal(result.stopReason, "stop");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0]!.name, "custom_math");
  assert.deepEqual(result.toolCalls[0]!.arguments, { a: 5, b: 3 });

  // Verify conversation history was populated
  assert.ok(history.length >= 4); // system, user, assistant with tool_call, tool result
  const lastToolMsg = history.find(m => m.role === "tool");
  assert.ok(lastToolMsg);
  assert.ok(lastToolMsg.content.includes("8"));
});

test("POST /agent_message supports SSE streaming", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId;

    const res = await httpRequest(mcp.port, {
      method: "POST",
      path: "/agent_message",
      headers: {
        "Mcp-Session-Id": sessionId,
        Accept: "text/event-stream",
      },
      body: { text: "describe our payment agent" },
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.headers["content-type"]?.includes("text/event-stream"));
    assert.ok(res.raw.includes("data: "));
    assert.ok(res.raw.includes("[DONE]"));
  } finally {
    await mcp.close();
  }
});

