import assert from "node:assert/strict";
import test from "node:test";
import { MetaClient } from "../src/llm/meta-client.ts";

test("MetaClient preserves Gemini thought signatures across tool-call turns", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  let replayedSignature: unknown;

  globalThis.fetch = async (_input, init) => {
    requestCount++;
    const requestBody = JSON.parse(String(init?.body));

    if (requestCount === 1) {
      return Response.json({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: { name: "probe", arguments: "{}" },
              extra_content: {
                google: { thought_signature: "signature-test" },
              },
            }],
          },
        }],
      });
    }

    const assistantMessage = requestBody.messages.find(
      (message: { role: string }) => message.role === "assistant",
    );
    replayedSignature = assistantMessage.tool_calls[0].extra_content.google.thought_signature;

    return Response.json({
      choices: [{
        finish_reason: "stop",
        message: { content: "done", tool_calls: [] },
      }],
    });
  };

  try {
    const client = new MetaClient({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model",
    });
    const messages = [
      { role: "system" as const, content: "test" },
      { role: "user" as const, content: "call tool" },
    ];

    const firstResponse = await client.chat(messages, []);
    messages.push({
      role: "assistant",
      content: firstResponse.text,
      tool_calls: firstResponse.tool_calls,
    });
    await client.chat(messages, []);

    assert.equal(replayedSignature, "signature-test");
  } finally {
    globalThis.fetch = originalFetch;
  }
});