// enterpriseee/enterprise-simulator/test/mcp/server-integration-4.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startMcpServer } from "../../src/mcp/server.ts";

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
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
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

test("tools/list returns 15 tools including causal and workflow tools", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId || initRes.body.result?.sessionId;
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
    assert.equal(tools.length, 15);

    const names = tools.map((t: any) => t.name);
    // 10 baseline tools
    assert.ok(names.includes("describe_system"));
    assert.ok(names.includes("run_matrix"));
    assert.ok(names.includes("list_scenarios"));
    assert.ok(names.includes("audit_trace"));
    assert.ok(names.includes("explain_finding"));
    assert.ok(names.includes("propose_fix"));
    assert.ok(names.includes("verify_fix"));
    assert.ok(names.includes("replay"));
    assert.ok(names.includes("run_scientist"));
    assert.ok(names.includes("run_gate"));

    // 3 causal alphabet tools
    assert.ok(names.includes("audit_workflow_reliability"));
    assert.ok(names.includes("sweep_latency_cliff"));
    assert.ok(names.includes("verify_architecture_patch"));
  } finally {
    await mcp.close();
  }
});

test("tools/call with audit_workflow_reliability returns APPROVED or BLOCKED verdict", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId || initRes.body.result?.sessionId;
    assert.ok(sessionId);

    // Call with failing scenario (scenario-A)
    const callResFailing = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/call",
      headers: { "Mcp-Session-Id": sessionId },
      body: {
        name: "audit_workflow_reliability",
        arguments: {
          scenarioId: "scenario-A",
          maxDepth: 2,
          seed: 42817,
        },
      },
    });

    assert.equal(callResFailing.statusCode, 200);
    const successFailing = callResFailing.body.success ?? callResFailing.body.result?.success;
    assert.equal(successFailing, true);

    const verdictFailing = callResFailing.body.verdict ?? callResFailing.body.result?.verdict;
    assert.equal(verdictFailing, "BLOCKED");

    const shortestDepth = callResFailing.body.shortestDepth ?? callResFailing.body.result?.shortestDepth;
    assert.equal(shortestDepth, 1);

    // Scenario-B includes an un-idempotent post-commit retry in the explored fault set.
    const callResSafe = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/call",
      headers: { "Mcp-Session-Id": sessionId },
      body: {
        name: "audit_workflow_reliability",
        arguments: {
          scenarioId: "scenario-B",
          maxDepth: 2,
          seed: 42817,
        },
      },
    });

    assert.equal(callResSafe.statusCode, 200);
    const successSafe = callResSafe.body.success ?? callResSafe.body.result?.success;
    assert.equal(successSafe, true);

    const verdictScenarioB = callResSafe.body.verdict ?? callResSafe.body.result?.verdict;
    assert.equal(verdictScenarioB, "BLOCKED");
  } finally {
    await mcp.close();
  }
});

test("tools/call with sweep_latency_cliff returns cliff threshold", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId || initRes.body.result?.sessionId;
    assert.ok(sessionId);

    const callRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/call",
      headers: { "Mcp-Session-Id": sessionId },
      body: {
        name: "sweep_latency_cliff",
        arguments: {
          scenarioId: "scenario-A",
          targetChannel: "chan-payment",
          minMs: 0,
          maxMs: 60000,
        },
      },
    });

    assert.equal(callRes.statusCode, 200);
    const success = callRes.body.success ?? callRes.body.result?.success;
    assert.equal(success, true);

    const status = callRes.body.status ?? callRes.body.result?.status;
    assert.equal(status, "CLIFF_FOUND");

    const cliffMs = callRes.body.cliffMs ?? callRes.body.result?.cliffMs;
    assert.ok(typeof cliffMs === "number");

    const safeMs = callRes.body.safeMs ?? callRes.body.result?.safeMs;
    const collapseMs = callRes.body.collapseMs ?? callRes.body.result?.collapseMs;
    assert.ok(typeof safeMs === "number");
    assert.ok(typeof collapseMs === "number");
    assert.ok(safeMs <= cliffMs && cliffMs <= collapseMs);
    assert.ok(safeMs >= 7900 && collapseMs <= 8100);
  } finally {
    await mcp.close();
  }
});

test("tools/call with verify_architecture_patch reports independent lease expiry after idempotency ablation", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId || initRes.body.result?.sessionId;
    assert.ok(sessionId);

    const callRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/call",
      headers: { "Mcp-Session-Id": sessionId },
      body: {
        name: "verify_architecture_patch",
        arguments: {
          scenarioId: "scenario-A",
          ablation: "enforce_idempotency",
          seed: 42817,
        },
      },
    });

    assert.equal(callRes.statusCode, 200);
    const success = callRes.body.success ?? callRes.body.result?.success;
    assert.equal(success, true);

    const verdict = callRes.body.verdict ?? callRes.body.result?.verdict;
    assert.equal(verdict, "BLOCKED");

    const violatedInvariants = callRes.body.violatedInvariants ?? callRes.body.result?.violatedInvariants;
    assert.ok(violatedInvariants.includes("native-lease-epoch-expiry"));

    const regressionCheck = callRes.body.regressionCheck ?? callRes.body.result?.regressionCheck;
    assert.equal(regressionCheck, "FAILED");
  } finally {
    await mcp.close();
  }
});
