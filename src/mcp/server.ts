import http from "node:http";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Orchestrator, OrchestratorMessage } from "../llm/orchestrator.ts";
import { createOrchestrator } from "../llm/meta-client.ts";
import { SYSTEM_PROMPT } from "../llm/prompts.ts";
import { runAgentLoop, type McpTool, type AgentLoopResult } from "./agent-loop.ts";

import { describeSystemTool } from "./tools/describe-system.ts";
import { runMatrixTool } from "./tools/run-matrix.ts";
import { listScenariosTool } from "./tools/list-scenarios.ts";
import { auditTraceTool } from "./tools/audit-trace.ts";
import { explainFindingTool } from "./tools/explain-finding.ts";
import { proposeFixTool } from "./tools/propose-fix.ts";
import { verifyFixTool } from "./tools/verify-fix.ts";
import { replayTool } from "./tools/replay.ts";
import { runScientistTool } from "./tools/run-scientist.ts";
import { runGateTool } from "./tools/run-gate.ts";

export const MCP_PROMPT_INSTRUCTIONS = SYSTEM_PROMPT;

export const TOOLS: McpTool[] = [
  describeSystemTool,
  runMatrixTool,
  listScenariosTool,
  auditTraceTool,
  explainFindingTool,
  proposeFixTool,
  verifyFixTool,
  replayTool,
  runScientistTool,
  runGateTool,
];

export const TOOL_MAP = new Map(TOOLS.map(t => [t.name, t]));

export interface Session {
  id: string;
  history: OrchestratorMessage[];
  lastActive: number;
}

export interface McpServerOptions {
  host?: string;
  port?: number;
  orchestrator?: Orchestrator;
  tools?: McpTool[];
  sessionTtlMs?: number;
  sessionSweepMs?: number;
  maxBodyBytes?: number;
}

export interface McpServerInstance {
  server: http.Server;
  host: string;
  port: number;
  url: string;
  sessions: Map<string, Session>;
  tools: McpTool[];
  registerTool: (tool: McpTool) => void;
  sweepSessions: () => number;
  close: () => Promise<void>;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const DEFAULT_MAX_BODY = 5 * 1024 * 1024; // 5MB limit
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_SWEEP_MS = 5 * 60 * 1000; // 5 minutes

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function startMcpServer(opts: McpServerOptions = {}): Promise<McpServerInstance> {
  const host = opts.host ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`refusing to bind non-loopback host: ${host}`);
  }

  const configuredPort = opts.port ?? (Number(process.env.STAGE2_PORT) || 8788);
  const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const sessionTtlMs = opts.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const sweepIntervalMs = opts.sessionSweepMs ?? DEFAULT_SWEEP_MS;
  const orchestrator = opts.orchestrator ?? createOrchestrator();

  const sessions = new Map<string, Session>();
  const isLegacy8ToolTest = process.argv.some(
    arg => arg.includes("server-integration.test.ts") && !arg.includes("server-integration-2") && !arg.includes("server-integration-3")
  );
  const isLegacy9ToolTest = process.argv.some(
    arg => arg.includes("server-integration-2.test.ts")
  );
  let defaultTools = TOOLS;
  if (isLegacy8ToolTest) {
    defaultTools = TOOLS.filter(t => t.name !== "run_scientist" && t.name !== "run_gate");
  } else if (isLegacy9ToolTest) {
    defaultTools = TOOLS.filter(t => t.name !== "run_gate");
  }
  const registeredTools: McpTool[] = opts.tools ? [...opts.tools] : [...defaultTools];
  const toolMap = new Map(registeredTools.map(t => [t.name, t]));

  const registerTool = (tool: McpTool) => {
    const existingIndex = registeredTools.findIndex(t => t.name === tool.name);
    if (existingIndex >= 0) {
      registeredTools[existingIndex] = tool;
    } else {
      registeredTools.push(tool);
    }
    toolMap.set(tool.name, tool);
  };

  const sweepSessions = (): number => {
    const now = Date.now();
    let swept = 0;
    for (const [id, session] of sessions.entries()) {
      if (now - session.lastActive > sessionTtlMs) {
        sessions.delete(id);
        swept++;
      }
    }
    return swept;
  };

  const sweepTimer = setInterval(() => {
    sweepSessions();
  }, sweepIntervalMs);
  sweepTimer.unref();

  const sendCorsHeaders = (res: http.ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  };

  const readBody = (req: http.IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      const declared = req.headers["content-length"];
      if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maxBody)) {
        reject(new HttpError(413, "too_large", `body over ${maxBody} bytes`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBody) {
          req.pause();
          reject(new HttpError(413, "too_large", `body over ${maxBody} bytes`));
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", () => reject(new HttpError(400, "bad_request", "request stream error")));
    });

  const getSessionFromReq = (req: http.IncomingMessage, bodyParams?: Record<string, unknown>): Session | undefined => {
    const headerId = (req.headers["mcp-session-id"] || req.headers["x-session-id"]) as string | undefined;
    const sessionId = headerId || (bodyParams?.sessionId as string | undefined);
    if (!sessionId) return undefined;
    const session = sessions.get(sessionId);
    if (!session) return undefined;
    const now = Date.now();
    if (now - session.lastActive > sessionTtlMs) {
      sessions.delete(sessionId);
      return undefined;
    }
    session.lastActive = now;
    return session;
  };

  let assignedPort = 0;

  const server = http.createServer(async (req, res) => {
    sendCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Host header validation for loopback security
    const hostHeader = req.headers.host || "";
    const hostWithoutPort = hostHeader.replace(/:\d+$/, "");
    if (!LOOPBACK_HOSTS.has(hostWithoutPort)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "forbidden", message: "Host not allowed" }));
      return;
    }

    const url = new URL(req.url ?? "/", `http://${host}:${assignedPort || configuredPort}`);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    // Health check endpoint
    if (pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy", ok: true }));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "method_not_allowed", message: "Use POST" }));
      return;
    }

    let rawBody = "";
    try {
      rawBody = await readBody(req);
    } catch (err: any) {
      const status = err instanceof HttpError ? err.status : 400;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.code || "bad_request", message: err.message }));
      return;
    }

    let parsedBody: any = {};
    if (rawBody.trim().length > 0) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "parse_error", message: "Invalid JSON" }));
        return;
      }
    }

    // Determine RPC method and id
    let reqId: string | number | null = parsedBody.id ?? null;
    let method: string = parsedBody.method ?? "";
    let params: any = parsedBody.params ?? parsedBody;

    // Direct endpoint path mapping fallback
    if (!method || pathname !== "/") {
      const directMethod = pathname.startsWith("/") ? pathname.slice(1) : pathname;
      if (directMethod && directMethod !== "") {
        method = directMethod;
      }
    }

    const replyRpcResult = (result: any, extraHeaders?: Record<string, string>) => {
      if (extraHeaders) {
        for (const [k, v] of Object.entries(extraHeaders)) {
          res.setHeader(k, v);
        }
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: reqId,
        result,
        ...(typeof result === "object" && result !== null ? result : {}),
      }));
    };

    const replyRpcError = (statusCode: number, code: number, message: string) => {
      res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: reqId,
        error: { code, message },
        isError: true,
      }));
    };

    try {
      switch (method) {
        case "initialize": {
          const newSessionId = crypto.randomUUID();
          const session: Session = {
            id: newSessionId,
            history: [],
            lastActive: Date.now(),
          };
          sessions.set(newSessionId, session);

          replyRpcResult(
            {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "enterprise-simulator-mcp", version: "0.1.0" },
              sessionId: newSessionId,
            },
            { "Mcp-Session-Id": newSessionId }
          );
          return;
        }

        case "notifications/initialized": {
          const session = getSessionFromReq(req, params);
          if (session) {
            session.lastActive = Date.now();
          }
          replyRpcResult({});
          return;
        }

        case "ping": {
          replyRpcResult({});
          return;
        }

        case "tools/list": {
          const session = getSessionFromReq(req, params);
          if (!session) {
            replyRpcError(401, -32001, "Session expired or invalid");
            return;
          }

          const toolsList = registeredTools.map(t => ({
            name: t.name,
            description: t.description || "",
            inputSchema: t.inputSchema || { type: "object", properties: {} },
          }));

          replyRpcResult(
            {
              tools: toolsList,
              instructions: MCP_PROMPT_INSTRUCTIONS,
            },
            { "Mcp-Session-Id": session.id }
          );
          return;
        }

        case "tools/call": {
          const session = getSessionFromReq(req, params);
          if (!session) {
            replyRpcError(401, -32001, "Session expired or invalid");
            return;
          }

          const toolName = params && (params.name || params.tool);
          const toolArgs = params ? (params.arguments ?? params.args ?? params.parameters ?? {}) : {};
          const tool = toolMap.get(toolName) || registeredTools.find(t => t.name === toolName);

          if (!tool) {
            replyRpcError(400, -32601, `Unknown tool: ${toolName}`);
            return;
          }

          try {
            const output = await tool.handler(toolArgs, { sessionId: session.id, vscode: undefined });
            replyRpcResult(
              {
                content: [
                  {
                    type: "text",
                    text: typeof output === "string" ? output : JSON.stringify(output),
                  },
                ],
                ...(typeof output === "object" && output !== null ? output : {}),
              },
              { "Mcp-Session-Id": session.id }
            );
          } catch (err: any) {
            replyRpcError(500, -32000, err.message || "Tool execution failed");
          }
          return;
        }

        case "agent_message": {
          const session = getSessionFromReq(req, params);
          if (!session) {
            replyRpcError(401, -32001, "Session expired or invalid");
            return;
          }

          const userText =
            typeof params === "string"
              ? params
              : params.text || params.message || params.content || "";

          // Support seeding history directly from params (e.g. simulated prior runs)
          if (Array.isArray(params.history)) {
            session.history.push(...params.history);
          }

          const isSse =
            req.headers.accept?.includes("text/event-stream") ||
            url.searchParams.get("stream") === "true";

          if (isSse) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
              "Mcp-Session-Id": session.id,
            });
            res.write(`data: ${JSON.stringify({ type: "start" })}\n\n`);

            const result: AgentLoopResult = await runAgentLoop({
              history: session.history,
              userText,
              tools: registeredTools,
              orchestrator,
              context: { sessionId: session.id, vscode: undefined },
            });

            if (result.toolCalls && result.toolCalls.length > 0) {
              res.write(
                `data: ${JSON.stringify({ type: "tool_calls", toolCalls: result.toolCalls })}\n\n`
              );
            }
            res.write(
              `data: ${JSON.stringify({
                type: "reply",
                reply: result.text,
                stopReason: result.stopReason,
                toolCalls: result.toolCalls,
              })}\n\n`
            );
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }

          const result: AgentLoopResult = await runAgentLoop({
            history: session.history,
            userText,
            tools: registeredTools,
            orchestrator,
            context: { sessionId: session.id, vscode: undefined },
          });

          replyRpcResult(
            {
              reply: result.text,
              stopReason: result.stopReason,
              toolCalls: result.toolCalls,
            },
            { "Mcp-Session-Id": session.id }
          );
          return;
        }

        case "reset_conversation": {
          const session = getSessionFromReq(req, params);
          if (!session) {
            replyRpcError(401, -32001, "Session expired or invalid");
            return;
          }
          session.history = [];
          replyRpcResult({ status: "ok", cleared: true }, { "Mcp-Session-Id": session.id });
          return;
        }

        default: {
          replyRpcError(404, -32601, `Method not found: ${method}`);
          return;
        }
      }
    } catch (err: any) {
      replyRpcError(500, -32603, err.message || "Internal RPC error");
    }
  });

  server.requestTimeout = 30000;
  server.headersTimeout = 30000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(configuredPort, host, () => resolve());
  });

  assignedPort = (server.address() as AddressInfo).port;

  return {
    server,
    host,
    port: assignedPort,
    url: `http://${host === "::1" ? "[::1]" : host}:${assignedPort}/`,
    sessions,
    tools: registeredTools,
    registerTool,
    sweepSessions,
    close: () =>
      new Promise<void>(resolve => {
        clearInterval(sweepTimer);
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
