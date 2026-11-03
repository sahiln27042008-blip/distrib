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
    const enableThinking = process.env.ENABLE_THINKING === 'true';
    const body: Record<string, unknown> = {
      max_tokens: 4096,
      model: this.config.model,
      messages: messages.map(m => this.convertMessage(m)),
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
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
      return {
        text: choice?.content || "",
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

// Factory that picks mock vs real based on env:
export function createOrchestrator(): Orchestrator {
  if (process.env.META_BASE_URL2 && process.env.META_API_KEY2) {
    return new MetaClient({
      apiKey: process.env.META_API_KEY2,
      baseUrl: process.env.META_BASE_URL2,
      model: process.env.META_MODEL2 || "muse-spark-1.3",
      timeoutMs: Number(process.env.META_TIMEOUT_MS) || 180000,
    });
  }
  if (process.env.META_BASE_URL) {
    return new MetaClient({
      apiKey: process.env.META_API_KEY || "local-key-not-required",
      baseUrl: process.env.META_BASE_URL,
      model: process.env.META_MODEL || "llama-3.3-70b",
      timeoutMs: Number(process.env.META_TIMEOUT_MS) || 180000,
    });
  }
  if (process.env.GOOGLE_API_KEY) {
    return new MetaClient({
      apiKey: process.env.GOOGLE_API_KEY,
      baseUrl: process.env.GOOGLE_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/",
      model: process.env.GOOGLE_MODEL || "gemini-3-flash-preview",
      timeoutMs: Number(process.env.GOOGLE_TIMEOUT_MS) || 180000,
    });
  }
  return new MockOrchestrator(Number(process.env.MOCK_SEED) || 42);
}
