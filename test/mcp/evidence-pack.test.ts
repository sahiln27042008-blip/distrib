import test from "node:test";
import assert from "node:assert/strict";
import { loadEvidencePackTool, saveEvidencePackTool } from "../../src/mcp/tools/evidence-pack.ts";

test("evidence packs restore a session's saved audit context", async () => {
  const context: Record<string, unknown> = {
    sessionId: "evidence-session-a",
    lastTrace: { traceId: "trace-1", spans: [{ id: "span-1" }] },
    lastConfig: { A: "A1" },
    lastFindings: [{ rule_id: "R04", status: "proven" }],
  };
  const saved = await saveEvidencePackTool.handler({ name: "Refund review" }, context);
  assert.equal(saved.success, true);
  assert.equal(context.lastTrace && (context.lastTrace as any).traceId, "trace-1");

  context.lastTrace = undefined;
  context.lastConfig = undefined;
  context.lastFindings = undefined;
  const loaded = await loadEvidencePackTool.handler({ packId: saved.packId }, context);

  assert.equal(loaded.success, true);
  assert.equal((context.lastTrace as any).traceId, "trace-1");
  assert.deepEqual(context.lastConfig, { A: "A1" });
  assert.equal((context.lastFindings as any[])[0]?.rule_id, "R04");
});

test("evidence packs are isolated by session and require evidence", async () => {
  const emptyContext = { sessionId: "evidence-session-empty" };
  const emptySave = await saveEvidencePackTool.handler({}, emptyContext);
  assert.equal(emptySave.success, false);

  const ownerContext = { sessionId: "evidence-session-owner", lastTrace: { traceId: "private-trace" } };
  const saved = await saveEvidencePackTool.handler({}, ownerContext);
  const otherSessionLoad = await loadEvidencePackTool.handler(
    { packId: saved.packId },
    { sessionId: "evidence-session-other" },
  );
  assert.equal(otherSessionLoad.success, false);
});