import http from "node:http";
import type { AddressInfo, IncomingHttpHeaders } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderCtoView } from "./ui/cto-view.ts";
import { renderChatPage } from "./ui/chat.ts";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export interface Stage3ServerOptions {
  host?: string;
  port?: number;
  mcpPort?: number;
  maxBodyBytes?: number;
}

export interface Stage3ServerInstance {
  server: http.Server;
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

function send(res: http.ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = req.headers["content-length"];
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
      reject(new Error("request body is too large"));
      req.resume();
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("request body is too large"));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function proxyHeaders(headers: IncomingHttpHeaders, targetHost: string): http.OutgoingHttpHeaders {
  const forwarded: http.OutgoingHttpHeaders = { host: targetHost };
  for (const name of ["content-type", "content-length", "accept", "mcp-session-id", "authorization"]) {
    const value = headers[name];
    if (value !== undefined) forwarded[name] = value;
  }
  return forwarded;
}

export async function startStage3Server(options: Stage3ServerOptions = {}): Promise<Stage3ServerInstance> {
  const host = options.host ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host)) throw new Error(`refusing to bind non-loopback host: ${host}`);
  const port = options.port ?? (Number(process.env.STAGE3_PORT) || 8789);
  const mcpPort = options.mcpPort ?? (Number(process.env.STAGE2_PORT) || 8788);
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  if (!Number.isInteger(mcpPort) || mcpPort < 1 || mcpPort > 65535) throw new Error("MCP port must be in [1, 65535]");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Stage 3 port must be in [0, 65535]");

  const server = http.createServer((req, res) => {
    const rawHost = (req.headers.host ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    if (!LOOPBACK_HOSTS.has(rawHost)) {
      send(res, 403, "text/plain; charset=utf-8", "Host not allowed");
      return;
    }

    const requestUrl = new URL(req.url ?? "/", `http://${host}:${port || 8789}`);
    const pathname = requestUrl.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "GET" && (pathname === "/" || pathname === "/chat")) {
      send(res, 200, "text/html; charset=utf-8", renderChatPage());
      return;
    }

    if (pathname === "/gate" && req.method === "GET") {
      send(res, 200, "text/html; charset=utf-8", renderCtoView({
        status: "INSUFFICIENT_EVIDENCE",
        reason: "Run the reliability gate to see its evidence.",
        discoveredFailures: [],
        patches: [],
        experimentsRun: 0,
        scenariosTested: 0,
        provenFindingsTotal: 0,
      }));
      return;
    }

    if (pathname === "/gate" && req.method === "POST") {
      readBody(req, maxBodyBytes).then((body) => {
        const evidence = JSON.parse(body);
        if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
          send(res, 400, "text/plain; charset=utf-8", "Expected a JSON object");
          return;
        }
        send(res, 200, "text/html; charset=utf-8", renderCtoView(evidence));
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Invalid request";
        send(res, message.includes("too large") ? 413 : 400, "text/plain; charset=utf-8", message.includes("too large") ? message : "Invalid JSON");
      });
      return;
    }

    if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
      const targetHost = `127.0.0.1:${mcpPort}`;
      const targetPath = `${pathname.slice(4) || "/"}${requestUrl.search}`;
      const upstream = http.request({
        hostname: "127.0.0.1",
        port: mcpPort,
        path: targetPath,
        method: req.method,
        headers: proxyHeaders(req.headers, targetHost),
      }, (upstreamResponse) => {
        const responseHeaders: http.OutgoingHttpHeaders = {};
        for (const name of ["content-type", "content-length", "cache-control", "mcp-session-id", "connection"]) {
          const value = upstreamResponse.headers[name];
          if (value !== undefined) responseHeaders[name] = value;
        }
        responseHeaders["X-Content-Type-Options"] = "nosniff";
        res.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders);
        upstreamResponse.pipe(res);
      });
      upstream.on("error", () => {
        if (!res.headersSent) send(res, 502, "text/plain; charset=utf-8", "MCP server is not reachable on the configured local port.");
        else res.destroy();
      });
      req.pipe(upstream);
      return;
    }

    send(res, 404, "text/plain; charset=utf-8", "Not found");
  });

  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const assignedPort = (server.address() as AddressInfo).port;

  return {
    server,
    host,
    port: assignedPort,
    url: `http://${host === "::1" ? "[::1]" : host}:${assignedPort}/`,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startStage3Server().then((instance) => {
    console.log(`[Stage 3] UI: ${instance.url}`);
    console.log(`[Stage 3] CTO view: ${instance.url}gate`);
    console.log(`[Stage 3] MCP proxy: ${instance.url}mcp`);
  }).catch((error: unknown) => {
    console.error("Failed to start Stage 3 server:", error);
    process.exitCode = 1;
  });
}