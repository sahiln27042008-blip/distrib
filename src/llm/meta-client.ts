import type {
  Orchestrator,
  OrchestratorMessage,
  OrchestratorResponse,
  ToolCall,
  ToolDefinition,
} from "./orchestrator.ts";
import { MockOrchestrator } from "./orchestrator-mock.ts";

export interface RetryAttempt {
  attempt: number;
  status?: number;
  error?: string;
  delayMs: number;
  timestamp: string;
}

export interface MetaClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number; // default 60000
  maxRetries?: number; // default 3
  onRetry?: (attempt: RetryAttempt) => void;
}

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

function sanitizeToolSchema(schema: any): any {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }
  const res: Record<string, any> = Array.isArray(schema) ? [] : { ...schema };
  if (res.properties && typeof res.properties === "object" && !Array.isArray(res.properties)) {
    const cleanProps: Record<string, any> = {};
    for (const [key, val] of Object.entries(res.properties)) {
      if (Array.isArray(val)) {
        cleanProps[key] = { type: "string", enum: val };
      } else if (val && typeof val === "object") {
        cleanProps[key] = sanitizeToolSchema(val);
      } else {
        cleanProps[key] = { type: "string" };
      }
    }
    res.properties = cleanProps;
  }
  return res;
}

export class MetaClient implements Orchestrator {
  config: MetaClientConfig;
  readonly retryLog: RetryAttempt[] = [];

  constructor(config: MetaClientConfig) {
    this.config = config;
  }

  async chat(
    messages: OrchestratorMessage[],
    tools: ToolDefinition[]
  ): Promise<OrchestratorResponse> {
    // Sanitize messages to guarantee every tool message has a preceding assistant with matching tool_call_id
    const validCallIds = new Set<string>();
    const sanitizedMessages: OrchestratorMessage[] = [];
    for (const msg of messages) {
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (tc.id) validCallIds.add(tc.id);
        }
        sanitizedMessages.push(msg);
      } else if (msg.role === "tool") {
        if (msg.tool_call_id && validCallIds.has(msg.tool_call_id)) {
          sanitizedMessages.push(msg);
        } else {
          console.warn(`[META_CLIENT] Dropping orphaned tool message with call ID ${msg.tool_call_id}`);
        }
      } else {
        sanitizedMessages.push(msg);
      }
    }
    const enableThinking = process.env.ENABLE_THINKING === 'true';
    const sanitizedTools = tools.map((t) => ({
      ...t,
      function: {
        ...t.function,
        parameters: sanitizeToolSchema(t.function?.parameters),
      },
    }));
    const body: Record<string, unknown> = {
      max_tokens: Number(process.env.META_MAX_TOKENS) || 65536,
      model: this.config.model,
      messages: sanitizedMessages.map(m => this.convertMessage(m)),
      tools: sanitizedTools.length > 0 ? sanitizedTools : undefined,
      tool_choice: sanitizedTools.length > 0 ? "auto" : undefined,
    };
    if (this.config.baseUrl.includes("integrate.api.nvidia.com")) {
      body.chat_template_kwargs = { enable_thinking: enableThinking };
    }

    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const maxRetries = this.config.maxRetries ?? 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeoutMs ?? 60000),
        });
      } catch (networkError) {
        if (attempt < maxRetries) {
          const delayMs = Math.min(10000, Math.floor(1000 * Math.pow(2, attempt) + Math.random() * 500));
          const attemptRecord: RetryAttempt = {
            attempt: attempt + 1,
            error: networkError instanceof Error ? networkError.message : String(networkError),
            delayMs,
            timestamp: new Date().toISOString(),
          };
          this.retryLog.push(attemptRecord);
          this.config.onRetry?.(attemptRecord);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw networkError;
      }

      if (!res.ok) {
        if (RETRYABLE_STATUS_CODES.has(res.status) && attempt < maxRetries) {
          let delayMs = Math.min(10000, Math.floor(1000 * Math.pow(2, attempt) + Math.random() * 500));
          const retryAfter = res.headers.get("Retry-After");
          if (retryAfter) {
            const parsedSeconds = Number(retryAfter);
            if (!Number.isNaN(parsedSeconds) && parsedSeconds > 0) {
              delayMs = Math.min(10000, parsedSeconds * 1000);
            } else {
              const parsedDate = new Date(retryAfter).getTime();
              if (!Number.isNaN(parsedDate) && parsedDate > Date.now()) {
                delayMs = Math.min(10000, Math.max(500, parsedDate - Date.now()));
              }
            }
          }
          const attemptRecord: RetryAttempt = {
            attempt: attempt + 1,
            status: res.status,
            delayMs,
            timestamp: new Date().toISOString(),
          };
          this.retryLog.push(attemptRecord);
          this.config.onRetry?.(attemptRecord);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        throw new Error(`LLM API ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as any;
      const choice = data.choices?.[0]?.message;
      let textContent = choice?.content;
      if (!textContent && choice?.reasoning_content) {
        textContent = String(choice.reasoning_content);
      }
      if (data.choices?.[0]?.finish_reason === "length") {
        if (textContent) {
          textContent += "\n\n*(Reached 32K token output boundary. Please prompt 'continue' to receive the next section.)*";
        } else {
          textContent = "[Reasoning tokens reached the 32K limit while processing these questions. Please prompt 'continue' or submit questions in smaller batches.]";
        }
      }
      const reasoningText = choice?.reasoning_content ? String(choice.reasoning_content) : undefined;
      return {
        text: textContent || "",
        reasoning: reasoningText,
        tool_calls: (choice?.tool_calls || []).map((tc: any) => ({
          id: tc.id,
          name: tc.function?.name ?? tc.name,
          arguments:
            typeof tc.function?.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function?.arguments ?? tc.arguments ?? {},
          ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
        })),
        stop_reason:
          data.choices?.[0]?.finish_reason === "tool_calls" ? "tool_calls" : "stop",
        ...(data.usage ? {
          usage: {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          },
        } : {}),
      };
    }

    throw new Error(`LLM API call failed after ${maxRetries} retries`);
  }

  private convertMessage(m: OrchestratorMessage): any {
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.tool_call_id,
        content: m.content,
      };
    }
    if (m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.tool_calls.map(tc => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
          ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
        })),
      };
    }
    return { role: m.role, content: m.content };
  }
}

export function createMetaOrchestrator(config: MetaClientConfig): Orchestrator {
  return new MetaClient(config);
}

function ensureEnvLoaded(): void {
  if (process.env.META_BASE_URL && process.env.META_API_KEY) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path");
    const candidateDirs = [process.cwd(), path.resolve(process.cwd(), ".."), path.resolve(process.cwd(), "../..")];
    for (const dir of candidateDirs) {
      for (const f of [".env.local", ".env"]) {
        const full = path.join(dir, f);
        if (fs.existsSync(full)) {
          const content = fs.readFileSync(full, "utf8");
          for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const eqIdx = trimmed.indexOf("=");
            if (eqIdx <= 0) continue;
            const k = trimmed.slice(0, eqIdx).trim();
            let v = trimmed.slice(eqIdx + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
              v = v.slice(1, -1);
            }
            if (!process.env[k]) process.env[k] = v;
          }
        }
      }
    }
  } catch {}
}

export class FailoverOrchestrator implements Orchestrator {
  private primary: Orchestrator;
  private fallbacks: Orchestrator[];

  constructor(primary: Orchestrator, fallbacks: Orchestrator[] = []) {
    this.primary = primary;
    this.fallbacks = fallbacks;
  }

  async chat(messages: OrchestratorMessage[], tools: ToolDefinition[]): Promise<OrchestratorResponse> {
    try {
      return await this.primary.chat(messages, tools);
    } catch (primaryErr: any) {
      console.warn(`[ORCHESTRATOR] Primary failed (${primaryErr.message}). Attempting fallback orchestrator...`);
      for (const fb of this.fallbacks) {
        try {
          return await fb.chat(messages, tools);
        } catch (fbErr: any) {
          console.warn(`[ORCHESTRATOR] Fallback failed: ${fbErr.message}`);
        }
      }
      throw primaryErr;
    }
  }
}

// Factory that picks mock vs real based on env with automatic multi-model failover:
export function createOrchestrator(): Orchestrator {
  ensureEnvLoaded();
  const orchestrators: Orchestrator[] = [];

  if (process.env.META_BASE_URL && process.env.META_API_KEY) {
    orchestrators.push(
      new MetaClient({
        apiKey: process.env.META_API_KEY,
        baseUrl: process.env.META_BASE_URL,
        model: process.env.META_MODEL || "nvidia/nemotron-3-ultra-550b-a55b",
        timeoutMs: Number(process.env.META_TIMEOUT_MS) || 600000,
      })
    );
  }
  if (process.env.GOOGLE_API_KEY) {
    orchestrators.push(
      new MetaClient({
        apiKey: process.env.GOOGLE_API_KEY,
        baseUrl: process.env.GOOGLE_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/",
        model: process.env.GOOGLE_MODEL || "gemini-3-flash-preview",
        timeoutMs: Number(process.env.GOOGLE_TIMEOUT_MS) || 600000,
      })
    );
  }

  if (orchestrators.length === 0) {
    return new MockOrchestrator(Number(process.env.MOCK_SEED) || 42);
  }

  if (orchestrators.length === 1) {
    return orchestrators[0]!;
  }

  return new FailoverOrchestrator(orchestrators[0]!, orchestrators.slice(1));
}
