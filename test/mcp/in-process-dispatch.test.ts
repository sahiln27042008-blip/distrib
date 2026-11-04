import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dispatchAgentMessageInProcess } from "../../src/mcp/server.ts";

describe("in-process dispatch fallback engine", () => {
  it("executes agent turn without needing an HTTP socket or port 8788", async () => {
    const mockOrchestrator = {
      async chat(messages: any[], tools: any[]) {
        return {
          content: "In-process execution verified successfully.",
          tool_calls: [],
          finish_reason: "stop",
        };
      },
    };

    const result = await dispatchAgentMessageInProcess({
      userText: "Verification test",
    });

    assert.ok(result.sessionId, "Must return a valid session ID");
    assert.ok(result.reply.length > 0, "Must return a non-empty reply");
    assert.equal(result.stopReason, "stop");
  });
});

