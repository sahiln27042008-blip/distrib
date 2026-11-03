import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startMcpServer } from "../../src/mcp/server.ts";
import { MATRIX_PRESETS, type MatrixConfig } from "../../src/matrix-copy.ts";
import type { Orchestrator } from "../../src/llm/orchestrator.ts";

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

test("tools/list returns 10 tools with correct names", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId;
    assert.ok(sessionId);

    const listRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/list",
      headers: { "Mcp-Session-Id": sessionId },
      body: {},
    });

    assert.equal(listRes.statusCode, 200);
    const tools = listRes.body.tools || listRes.body.result?.tools;
    assert.ok(Array.isArray(tools));
    assert.equal(tools.length, 10);

    const names = tools.map((t: any) => t.name);
    assert.ok(names.includes("describe_system"));
    assert.ok(names.includes("run_matrix"));
    assert.ok(names.includes("list_scenarios"));
    assert.ok(names.includes("audit_trace"));
    assert.ok(names.includes("explain_finding"));
    assert.ok(names.includes("propose_fix"));
    assert.ok(names.includes("verify_fix"));
    assert.ok(names.includes("replay"));

    const instructions = listRes.body.instructions || listRes.body.result?.instructions;
    assert.ok(typeof instructions === "string" && instructions.length > 0);
  } finally {
    await mcp.close();
  }
});

test("tools/call with describe_system returns a config", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId;

    const callRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/call",
      headers: { "Mcp-Session-Id": sessionId },
      body: {
        name: "describe_system",
        arguments: { description: "refund agent with no idempotency keys" },
      },
    });

    assert.equal(callRes.statusCode, 200);
    const success = callRes.body.success ?? callRes.body.result?.success;
    assert.equal(success, true);
    const config = callRes.body.config || callRes.body.result?.config;
    assert.ok(config);
    assert.ok(config.A);
    assert.ok(config.B);
    assert.ok(config.C);
    assert.ok(config.D);
    assert.ok(config.E);
    assert.ok(config.F);
  } finally {
    await mcp.close();
  }
});

test("tools/call with run_matrix returns snapshot + trace", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId;

    const callRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/call",
      headers: { "Mcp-Session-Id": sessionId },
      body: {
        name: "run_matrix",
        arguments: { config: MATRIX_PRESETS.login_freeze_db_hog },
      },
    });

    assert.equal(callRes.statusCode, 200);
    const success = callRes.body.success ?? callRes.body.result?.success;
    assert.equal(success, true);
    const snapshot = callRes.body.snapshot || callRes.body.result?.snapshot;
    assert.ok(snapshot);
    const trace = callRes.body.trace || callRes.body.result?.trace;
    assert.ok(trace);
    assert.ok(Array.isArray(trace.spans));
  } finally {
    await mcp.close();
  }
});

test("tools/call with list_scenarios returns 3 scenarios", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId;

    const callRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/call",
      headers: { "Mcp-Session-Id": sessionId },
      body: {
        name: "list_scenarios",
        arguments: {},
      },
    });

    assert.equal(callRes.statusCode, 200);
    const success = callRes.body.success ?? callRes.body.result?.success;
    assert.equal(success, true);
    const scenarios = callRes.body.scenarios || callRes.body.result?.scenarios;
    assert.ok(Array.isArray(scenarios));
    assert.equal(scenarios.length, 3);
  } finally {
    await mcp.close();
  }
});

test("tools/call with unknown tool returns error", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId;

    const callRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/call",
      headers: { "Mcp-Session-Id": sessionId },
      body: {
        name: "nonexistent_tool",
        arguments: {},
      },
    });

    assert.equal(callRes.statusCode, 400);
    assert.ok(callRes.body.isError || callRes.body.error);
    const msg = callRes.body.error?.message || callRes.body.message || "";
    assert.match(msg, /Unknown tool/i);
  } finally {
    await mcp.close();
  }
});

test("agent_message with 'describe my refund system' returns toolCalls containing describe_system", async () => {
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
      body: { text: "describe my refund system with no idempotency keys" },
    });

    assert.equal(res.statusCode, 200);
    const toolCalls = res.body.toolCalls || res.body.result?.toolCalls;
    assert.ok(Array.isArray(toolCalls));
    assert.ok(toolCalls.length > 0);
    const describeCall = toolCalls.find((tc: any) => tc.name === "describe_system");
    assert.ok(describeCall, "expected describe_system tool call");
  } finally {
    await mcp.close();
  }
});

test("agent_message full loop: describe → run → audit → explain → propose → verify", async () => {
  let savedOriginalConfig: any = null;
  let savedTrace: any = null;
  let savedFinding: any = null;
  let savedExplanation: any = null;
  let savedFixedConfig: any = null;

  const fullLoopMock: Orchestrator = {
    async chat(messages, _tools) {
      const lastTool = [...messages].reverse().find(m => m.role === "tool");
      if (!lastTool) {
        // Step 1: Call describe_system
        return {
          text: "",
          tool_calls: [
            {
              id: "call-step-1",
              name: "describe_system",
              arguments: { description: "refund agent with no idempotency keys on legacy erp" },
            },
          ],
          stop_reason: "tool_calls",
        };
      }

      let lastToolContent: any;
      try {
        lastToolContent = typeof lastTool.content === "string"
          ? JSON.parse(lastTool.content)
          : Array.isArray(lastTool.content)
            ? lastTool.content
            : {};
      } catch {
        lastToolContent = {};
      }

      if (lastToolContent.config && !savedOriginalConfig) {
        // Step 2: Call run_matrix
        savedOriginalConfig = lastToolContent.config;
        return {
          text: "",
          tool_calls: [
            {
              id: "call-step-2",
              name: "run_matrix",
              arguments: { config: savedOriginalConfig },
            },
          ],
          stop_reason: "tool_calls",
        };
      }

      if (lastToolContent.trace && !savedTrace) {
        // Step 3: Call audit_trace
        savedTrace = lastToolContent.trace;
        return {
          text: "",
          tool_calls: [
            {
              id: "call-step-3",
              name: "audit_trace",
              arguments: { trace: savedTrace },
            },
          ],
          stop_reason: "tool_calls",
        };
      }

      if (lastToolContent.findings && !savedFinding) {
        // Step 4: Call explain_finding
        savedFinding = lastToolContent.findings[0] || {
          rule_id: "r04-network-idempotency",
          pillar: "network-idempotency",
          status: "proven",
          severity: "critical",
          message: "Non-idempotent refund retries",
          evidence: { span_ids: [savedTrace.spans?.[0]?.spanId || "s-0"] },
        };
        return {
          text: "",
          tool_calls: [
            {
              id: "call-step-4",
              name: "explain_finding",
              arguments: { finding: savedFinding, trace: savedTrace },
            },
          ],
          stop_reason: "tool_calls",
        };
      }

      if (lastToolContent.explanation && !savedExplanation) {
        // Step 5: Call propose_fix
        savedExplanation = lastToolContent.explanation;
        return {
          text: "",
          tool_calls: [
            {
              id: "call-step-5",
              name: "propose_fix",
              arguments: {
                finding: savedFinding,
                explanation: savedExplanation,
                originalConfig: savedOriginalConfig,
              },
            },
          ],
          stop_reason: "tool_calls",
        };
      }

      if (lastToolContent.fixedConfig && !savedFixedConfig) {
        // Step 6: Call verify_fix
        savedFixedConfig = lastToolContent.fixedConfig;
        return {
          text: "",
          tool_calls: [
            {
              id: "call-step-6",
              name: "verify_fix",
              arguments: {
                originalConfig: savedOriginalConfig,
                fixedConfig: savedFixedConfig,
                findingRuleId: savedFinding.rule_id,
              },
            },
          ],
          stop_reason: "tool_calls",
        };
      }

      // Final step: Summary text
      return {
        text: "Diagnosis complete. Verified fix applied: changed dial C to C1_clean_20ms. The invariant finding was verified and eliminated.",
        tool_calls: [],
        stop_reason: "stop",
      };
    },
  };

  const mcp = await startMcpServer({ port: 0, orchestrator: fullLoopMock });
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
      body: { text: "Diagnose and fix my refund agent system" },
    });

    assert.equal(res.statusCode, 200);
    const reply = res.body.reply || res.body.result?.reply;
    assert.ok(typeof reply === "string");
    assert.match(reply, /Verified fix applied/i);

    const toolCalls = res.body.toolCalls || res.body.result?.toolCalls;
    assert.ok(Array.isArray(toolCalls));
    assert.ok(toolCalls.length >= 6, `Expected at least 6 tool calls, got ${toolCalls.length}`);

    const calledNames = toolCalls.map((tc: any) => tc.name);
    assert.ok(calledNames.includes("describe_system"));
    assert.ok(calledNames.includes("run_matrix"));
    assert.ok(calledNames.includes("audit_trace"));
    assert.ok(calledNames.includes("explain_finding"));
    assert.ok(calledNames.includes("propose_fix"));
    assert.ok(calledNames.includes("verify_fix"));
  } finally {
    await mcp.close();
  }
});

test("All 8 tools are registered and callable", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId;

    // First generate a run to have valid trace + finding for downstream tools
    const runRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/call",
      headers: { "Mcp-Session-Id": sessionId },
      body: {
        name: "run_matrix",
        arguments: { config: MATRIX_PRESETS.login_freeze_db_hog },
      },
    });
    assert.equal(runRes.statusCode, 200);
    const sampleTrace = runRes.body.trace || runRes.body.result?.trace;
    const sampleConfig = MATRIX_PRESETS.login_freeze_db_hog!;

    const sampleFinding = {
      rule_id: "r04-network-idempotency",
      pillar: "network-idempotency",
      status: "proven",
      severity: "critical",
      message: "Non-idempotent call",
      evidence: { span_ids: [sampleTrace?.spans?.[0]?.spanId || "s-0"] },
    };

    const toolInvocationTests: Array<{ name: string; args: Record<string, unknown> }> = [
      { name: "describe_system", args: { description: "Streaming customer agent" } },
      { name: "run_matrix", args: { config: sampleConfig } },
      { name: "list_scenarios", args: {} },
      { name: "audit_trace", args: { trace: sampleTrace } },
      { name: "explain_finding", args: { finding: sampleFinding, trace: sampleTrace } },
      {
        name: "propose_fix",
        args: {
          finding: sampleFinding,
          explanation: "Root cause explanation",
          originalConfig: sampleConfig,
        },
      },
      {
        name: "verify_fix",
        args: {
          originalConfig: sampleConfig,
          fixedConfig: sampleConfig,
          findingRuleId: "r04-network-idempotency",
        },
      },
      { name: "replay", args: { config: sampleConfig } },
    ];

    for (const testCase of toolInvocationTests) {
      const res = await httpRequest(mcp.port, {
        method: "POST",
        path: "/tools/call",
        headers: { "Mcp-Session-Id": sessionId },
        body: {
          name: testCase.name,
          arguments: testCase.args,
        },
      });

      assert.equal(res.statusCode, 200, `Tool ${testCase.name} should return 200`);
      const success = res.body.success ?? res.body.result?.success;
      assert.equal(success, true, `Tool ${testCase.name} should succeed`);
    }
  } finally {
    await mcp.close();
  }
});

