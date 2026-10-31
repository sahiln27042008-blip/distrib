export interface OrchestratorMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | any[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string; // for tool results
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  extra_content?: Record<string, unknown>;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: object; // JSON schema
  };
}

export interface OrchestratorResponse {
  text: string; // assistant message text (may be empty if tool_calls present)
  tool_calls: ToolCall[]; // empty if just text
  stop_reason: "stop" | "tool_calls" | "length" | "error";
}

export interface Orchestrator {
  chat(messages: OrchestratorMessage[], tools: ToolDefinition[]): Promise<OrchestratorResponse>;
}

export { createOrchestrator } from "./meta-client.ts";

