import test from "node:test";
import assert from "node:assert/strict";
import { renderCtoView } from "../../src/ui/cto-view.ts";
import { renderChatPage } from "../../src/ui/chat.ts";

test("CTO view renders a blocked decision and minimized counterexample", () => {
  const html = renderCtoView({
    status: "BLOCKED",
    reason: "2 failures discovered",
    discoveredFailures: [{
      id: "f1",
      hypothesis: "Retry can duplicate a charge",
      invariant: "r04-network-idempotency",
      businessImpact: "$50,000 in duplicate charges",
      counterexample: [
        { description: "Charge sent", timestamp: 0 },
        { description: "Response lost", timestamp: 10 },
      ],
      replayHandle: { seed: 42, config: {} },
    }],
    patches: [],
    experimentsRun: 5,
    provenFindingsTotal: 1,
  });

  assert.match(html, /BLOCKED/);
  assert.match(html, /🔴/);
  assert.match(html, /\$50,000 in duplicate charges/);
  assert.match(html, /Charge sent/);
  assert.match(html, /Response lost/);
  assert.match(html, /Minimal counterexample \(2 events\)/);
});

test("CTO view renders approved status and patch diff", () => {
  const html = renderCtoView({
    status: "APPROVED",
    reason: "No invariant violations",
    discoveredFailures: [],
    patches: [{
      ruleId: "r04-network-idempotency",
      description: "Add idempotency key",
      diff: "--- a/src/refund.ts\n+++ b/src/refund.ts\n+idempotencyKey",
      isVerified: true,
      beforeImpact: "$50,000",
      afterImpact: "$0",
      proof: "R04 finding no longer reproduced",
    }],
    experimentsRun: 10,
    provenFindingsTotal: 0,
  });

  assert.match(html, /APPROVED/);
  assert.match(html, /🟢/);
  assert.match(html, /Add idempotency key/);
  assert.match(html, /src\/refund\.ts/);
  assert.match(html, /✅ VERIFIED/);
  assert.match(html, /R04 finding no longer reproduced/);
});

test("CTO view escapes untrusted evidence and emits a strict CSP", () => {
  const html = renderCtoView({
    status: "BLOCKED",
    reason: "<script>alert(1)</script>",
    discoveredFailures: [{
      invariant: "<img src=x>",
      hypothesis: "<svg onload=alert(1)>",
      businessImpact: "& unsafe",
      counterexample: [{ description: "<script>bad()</script>", timestamp: 1 }],
      replayHandle: { seed: 4, config: {} },
    }],
    patches: [],
  });

  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /style-src 'sha256-/);
  assert.doesNotMatch(html, /unsafe-inline/);
});

test("chat page is self-contained and calls the same-origin MCP endpoint", () => {
  const html = renderChatPage();
  assert.match(html, /fetch\("\/mcp/);
  assert.match(html, /agent_message/);
  assert.match(html, /script-src 'sha256-/);
  assert.match(html, /connect-src 'self'/);
  assert.doesNotMatch(html, /src="https?:\/\//);
});