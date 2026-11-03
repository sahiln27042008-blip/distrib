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

test("tools/list returns 11 tools including run_scientist", async () => {
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
    assert.equal(tools.length, 11);

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
  } finally {
    await mcp.close();
  }
});

test("tools/call with run_scientist fails closed for local mock output", async () => {
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
        name: "run_scientist",
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

    const discoveredFailures =
      callRes.body.discoveredFailures ?? callRes.body.result?.discoveredFailures;
    assert.equal(discoveredFailures, 0);

    const failures = callRes.body.failures || callRes.body.result?.failures;
    assert.ok(Array.isArray(failures));
    assert.equal(failures.length, 0);
    assert.equal(callRes.body.status ?? callRes.body.result?.status, "INCONCLUSIVE");
  } finally {
    await mcp.close();
  }
});

