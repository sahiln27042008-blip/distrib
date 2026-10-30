import type { Orchestrator, OrchestratorMessage, ToolCall } from "../llm/orchestrator.ts";
import { createOrchestrator } from "../llm/meta-client.ts";
import { SYSTEM_PROMPT } from "../llm/prompts.ts";

const MAX_ITERATIONS = Number(process.env.MAX_AGENT_ITERATIONS) || 6;

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
    const isFinalIteration = i === MAX_ITERATIONS - 1;
    const currentTools = isFinalIteration ? [] : toolDefs;
    console.log(`[AGENT_LOOP] Iteration ${i}: calling orchestrator (${messages.length} msgs)...`);
    const response = await orchestrator.chat(messages, currentTools);
    console.log(`[AGENT_LOOP] Iteration ${i}: model replied with ${response.tool_calls.length} tool calls (${response.tool_calls.map(tc => tc.name).join(", ")})`);

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
        console.log(`[AGENT_LOOP] Iteration ${i}: executing tool '${tc.name}'...`);
        const result = await tool.handler(tc.arguments, opts.context);
        console.log(`[AGENT_LOOP] Iteration ${i}: tool '${tc.name}' completed.`);
        let toolContent = typeof result === "string" ? result : JSON.stringify(result);
        if (tc.name === "run_matrix" && result && typeof result === "object" && result.trace) {
          if (opts.context) {
            (opts.context as any).lastTrace = result.trace;
          }
          const compact = {
            success: result.success,
            config: result.config,
            snapshot: result.snapshot,
            traceId: result.traceId,
            trace: { traceId: result.traceId, note: "Trace cached in session. Calling audit_trace will automatically inspect this trace." }
          };
          toolContent = JSON.stringify(compact);
        }
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolContent,
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

  // If loop exhausted with tool calls but no final text reply, do a final synthesis pass
  if (allExecutedToolCalls.length > 0) {
    try {
      console.log("[AGENT_LOOP] Requesting final diagnostic synthesis...");
      messages.push({
        role: "user",
        content: "You have gathered the evidence from the simulator and auditor. Present your complete reliability analysis, invariant violations, root causes, and recommended fixes in plain English."
      });
      const finalResp = await orchestrator.chat(messages, []);
      if (finalResp.text) {
        return {
          text: finalResp.text,
          stopReason: "stop",
          toolCalls: allExecutedToolCalls,
        };
      }
    } catch (e: any) {
      console.error("[AGENT_LOOP] Final synthesis error:", e);
    }
  }

  return {
    text: "Reached max iterations.",
    stopReason: "length",
    toolCalls: allExecutedToolCalls,
  };
}
