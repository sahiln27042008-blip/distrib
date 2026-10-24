import type {
  Orchestrator,
  OrchestratorMessage,
  OrchestratorResponse,
  ToolCall,
  ToolDefinition,
} from "./orchestrator.ts";
import { MockOrchestrator } from "./orchestrator-mock.ts";

// OpenAI-compatible chat completions endpoint. The hackathon 
// provides Meta Llama 3.3 at an OpenAI-compatible URL with the 
// standard tool_calls format. The user sets META_API_KEY and 
// META_BASE_URL env vars at the end.

export interface MetaClientConfig {
  apiKey: string;
  baseUrl: string; // e.g. https://api.meta.ai/v1 (TBD by hackathon)
  model: string; // e.g. "llama-3.3-70b" (TBD by hackathon)
  timeoutMs?: number; // default 60000
}

export class MetaClient implements Orchestrator {
  config: MetaClientConfig;
  constructor(config: MetaClientConfig) {
    this.config = config;
  }

  async chat(
    messages: OrchestratorMessage[],
    tools: ToolDefinition[]
  ): Promise<OrchestratorResponse> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map(m => this.convertMessage(m)),
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
    };

    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 60000),
    });

    if (!res.ok) {
      throw new Error(`Meta API ${res.status}: ${await res.text()}`);
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
      })),
      stop_reason:
        data.choices?.[0]?.finish_reason === "tool_calls" ? "tool_calls" : "stop",
    };
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
  if (process.env.META_API_KEY && process.env.META_BASE_URL) {
    return new MetaClient({
      apiKey: process.env.META_API_KEY!,
      baseUrl: process.env.META_BASE_URL!,
      model: process.env.META_MODEL || "llama-3.3-70b",
    });
  }
  return new MockOrchestrator(Number(process.env.MOCK_SEED) || 42);
}
