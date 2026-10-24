import type { Orchestrator, OrchestratorMessage, OrchestratorResponse, ToolCall } from "./orchestrator.ts";

// The mock returns canned tool_calls based on keywords in the 
// user message. This lets all Stage 2 tests pass without burning 
// API tokens. The user swaps to meta-client.ts at the end.

export class MockOrchestrator implements Orchestrator {
  seed: number;
  constructor(seed: number = 42) {
    this.seed = seed;
  }

  async chat(messages: OrchestratorMessage[], _tools: unknown): Promise<OrchestratorResponse> {
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    const userText = (lastUser?.content || "").toLowerCase();

    // Check if a tool has already been invoked after the last user message
    const lastUserIndex = messages.findLastIndex
      ? messages.findLastIndex(m => m.role === "user")
      : messages.lastIndexOf(lastUser!);
    const subsequentMessages = lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : [];

    const wasCalledSinceUser = (toolName: string) =>
      subsequentMessages.some(m =>
        (m.role === "assistant" && m.tool_calls?.some(tc => tc.name === toolName)) ||
        (m.role === "tool" && (m.name === toolName || m.tool_call_id?.includes(toolName)))
      );

    const toolCalls: ToolCall[] = [];

    if (
      userText.includes("describe") ||
      userText.includes("system") ||
      userText.includes("agent") ||
      userText.includes("workflow")
    ) {
      // User is describing a system -> return describe_system call
      if (!wasCalledSinceUser("describe_system")) {
        toolCalls.push({
          id: `call-${Date.now()}-1`,
          name: "describe_system",
          arguments: { description: lastUser?.content || "" },
        });
      }
    }

    if (
      userText.includes("audit") ||
      userText.includes("find") ||
      userText.includes("failure") ||
      userText.includes("issue")
    ) {
      // After a run_matrix tool result, ask to audit
      const priorMatrix = messages.some(
        m =>
          (m.role === "tool" && m.content.includes("traceId")) ||
          (m.content && m.content.includes("traceId"))
      );
      if (priorMatrix && !wasCalledSinceUser("audit_trace")) {
        toolCalls.push({
          id: `call-${Date.now()}-2`,
          name: "audit_trace",
          arguments: { traceId: "from-prior-run" },
        });
      }
    }

    // If no tool_calls matched, return plain text
    if (toolCalls.length === 0) {
      if (wasCalledSinceUser("describe_system")) {
        return {
          text: "System described successfully. Ready to run matrix.",
          tool_calls: [],
          stop_reason: "stop",
        };
      }
      if (wasCalledSinceUser("audit_trace")) {
        return {
          text: "Audit completed successfully. All invariants analyzed.",
          tool_calls: [],
          stop_reason: "stop",
        };
      }
      return {
        text: "I'll start by describing your system. Tell me about your AI agent — what does it do, how many users, what's the workflow?",
        tool_calls: [],
        stop_reason: "stop",
      };
    }

    return {
      text: "",
      tool_calls: toolCalls,
      stop_reason: "tool_calls",
    };
  }
}

export function createMockOrchestrator(seed?: number): Orchestrator {
  return new MockOrchestrator(seed);
}
