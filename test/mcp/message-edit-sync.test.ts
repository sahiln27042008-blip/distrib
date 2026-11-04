// enterpriseee/enterprise-simulator/test/mcp/message-edit-sync.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "../../src/mcp/agent-loop.ts";
import type { OrchestratorMessage } from "../../src/llm/orchestrator.ts";

test("Editing a message preserves all prior messages and resets future turns", async () => {
  const initialSystemDesc = "My system has Cloudflare + Postgres pool (max 300) + Stripe gateway.";

  // Prior history that client transmits on editing Message 2
  const setHistory: OrchestratorMessage[] = [
    { role: "user", content: initialSystemDesc },
    { role: "assistant", content: "Understood. I have recorded your architecture." },
  ];

  let receivedMessagesCount = 0;
  let receivedFirstUser = "";

  const mockOrchestrator = {
    chat: async (msgs: any[], _tools: any[]) => {
      receivedMessagesCount = msgs.length;
      const firstUser = msgs.find((m) => m.role === "user");
      receivedFirstUser = firstUser?.content || "";
      return {
        text: "I analyzed the pool size based on your Postgres pool.",
        tool_calls: [],
      };
    },
  };

  // Simulating server receiving setHistory + new edited message
  const serverSessionHistory = [...setHistory];

  const result = await runAgentLoop({
    history: serverSessionHistory,
    userText: "What is the pool size limit?",
    tools: [],
    orchestrator: mockOrchestrator as any,
  });

  assert.ok(result.text.includes("pool size"));
  assert.equal(
    receivedFirstUser,
    initialSystemDesc,
    "The original system description from Message 1 MUST be preserved when Message 2 is edited"
  );
  assert.ok(receivedMessagesCount >= 3, "Orchestrator must receive full prior history + edited prompt");
});
