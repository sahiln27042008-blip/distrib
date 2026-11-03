import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startMcpServer } from "../../src/mcp/server.ts";
import { MATRIX_PRESETS } from "../../src/matrix-copy.ts";

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

test("tools/list returns 12 tools including run_gate", async () => {
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
    assert.equal(tools.length, 12);

    const names = tools.map((t: any) => t.name);
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
  } finally {
    await mcp.close();
  }
});

test("tools/call with run_gate returns gate decision (status, reason, discoveredFailures, patches)", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId || initRes.body.result?.sessionId;
    assert.ok(sessionId);

    const config = {
      ...MATRIX_PRESETS.double_charge_2ms_drop,
      C: "C5_legacy_erp_no_idem",
      F: "F1_blind_retry_unbounded_spend",
      seed: 42,
    };

    const callRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/call",
      headers: { "Mcp-Session-Id": sessionId },
      body: {
        name: "run_gate",
        arguments: {
          config,
          maxExperiments: 3,
          invariants: ["r04-network-idempotency"],
        },
      },
    });

    assert.equal(callRes.statusCode, 200);
    const success = callRes.body.success ?? callRes.body.result?.success;
    assert.equal(success, true);

    const status = callRes.body.status ?? callRes.body.result?.status;
    assert.equal(status, "BLOCKED");

    const reason = callRes.body.reason ?? callRes.body.result?.reason;
    assert.ok(typeof reason === "string" && reason.length > 0);

    const discoveredFailures =
      callRes.body.discoveredFailures ?? callRes.body.result?.discoveredFailures;
    assert.ok(discoveredFailures > 0);

    const patches = callRes.body.patches ?? callRes.body.result?.patches;
    assert.ok(typeof patches === "number");

    const evidence = callRes.body.evidence ?? callRes.body.result?.evidence;
    assert.ok(evidence);
    assert.ok(Array.isArray(evidence.discoveredFailures));
    assert.ok(evidence.discoveredFailures.length > 0);
  } finally {
    await mcp.close();
  }
});

test("tools/call with run_gate on resilient config returns APPROVED", async () => {
  const mcp = await startMcpServer({ port: 0 });
  try {
    const initRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/initialize",
      body: {},
    });
    const sessionId = initRes.body.sessionId || initRes.body.result?.sessionId;
    assert.ok(sessionId);

    const resilientConfig = {
      ...MATRIX_PRESETS.double_charge_2ms_drop,
      runId: "resilient-gate-test",
      seed: 42,
      A: "A2_mixed_saas",
      B: "B1_zero_hold_2ms",
      C: "C1_clean_20ms",
      D: "D5_cqrs_duckdb_blackboard_o1",
      E: "E4_state_leases_ipc_worker",
      F: "F3_resilient_invariant_runtime",
      humanUsers: 50,
      concurrentAgents: 10,
      dbPoolSize: 20,
      workflowSteps: 10,
      saasPriceUsd: 20,
      ticketValueUsd: 5,
    };

    const callRes = await httpRequest(mcp.port, {
      method: "POST",
      path: "/tools/call",
      headers: { "Mcp-Session-Id": sessionId },
      body: {
        name: "run_gate",
        arguments: {
          config: resilientConfig,
          maxExperiments: 3,
        },
      },
    });

    assert.equal(callRes.statusCode, 200);
    const success = callRes.body.success ?? callRes.body.result?.success;
    assert.equal(success, true);

    const status = callRes.body.status ?? callRes.body.result?.status;
    assert.equal(status, "APPROVED");

    const reason = callRes.body.reason ?? callRes.body.result?.reason;
    assert.ok(typeof reason === "string" && reason.length > 0);

    const discoveredFailures =
      callRes.body.discoveredFailures ?? callRes.body.result?.discoveredFailures;
    assert.equal(discoveredFailures, 0);
  } finally {
    await mcp.close();
  }
});

