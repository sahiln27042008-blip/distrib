import type { Orchestrator, OrchestratorMessage, ToolCall } from "../llm/orchestrator.ts";
import { createOrchestrator } from "../llm/meta-client.ts";
import { SYSTEM_PROMPT } from "../llm/prompts.ts";

const MAX_ITERATIONS = 25;

export interface AgentLoopResult {
  text: string;
  stopReason: "stop" | "tool_calls" | "length" | "error";
  toolCalls: ToolCall[];
}

export interface ToolDispatcher {
  (name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: object;
  handler: (args: any, context?: any) => Promise<any>;
}

export async function runAgentLoop(opts: {
  history: OrchestratorMessage[];
  userText: string;
  tools: McpTool[];
  orchestrator?: Orchestrator; // optional, defaults to createOrchestrator()
  context?: any;
}): Promise<AgentLoopResult> {
  const orchestrator = opts.orchestrator || createOrchestrator();
  const messages = opts.history;
  if (messages.length === 0 || messages[0]?.role !== "system") {
    messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  }
  messages.push({ role: "user", content: opts.userText });

  const toolDefs = (opts.tools || []).map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.inputSchema || { type: "object", properties: {} },
    },
  }));

  const allExecutedToolCalls: ToolCall[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await orchestrator.chat(messages, toolDefs);

    if (response.tool_calls.length === 0) {
      return {
        text: response.text,
        stopReason: response.stop_reason,
        toolCalls: allExecutedToolCalls,
      };
    }

    allExecutedToolCalls.push(...response.tool_calls);

    messages.push({
      role: "assistant",
      content: response.text,
      tool_calls: response.tool_calls,
    });

    for (const tc of response.tool_calls) {
      const tool = (opts.tools || []).find(t => t.name === tc.name);
      if (!tool) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: `Unknown tool: ${tc.name}` }),
        });
        continue;
      }
      try {
        const result = await tool.handler(tc.arguments, opts.context);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      } catch (err: any) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: err.message || String(err) }),
        });
      }
    }
  }

  return {
    text: "Reached max iterations.",
    stopReason: "length",
    toolCalls: allExecutedToolCalls,
  };
}

