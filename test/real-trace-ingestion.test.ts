import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { auditNative } from "../src/physics/alphabet/invariants/native-auditor.ts";
import { langchainJsonlToSimEvents, readOtelTraceFile } from "../src/physics/alphabet/ingestion/index.ts";

const samplePath = fileURLToPath(new URL("./reality-benchmark/fixtures/real-trace-sample.json", import.meta.url));

test("A. INGEST_OTELO maps explicit OTel request, DB, timeout, retry, and LLM signals", async () => {
  const events = await readOtelTraceFile(samplePath);
  const kinds = new Map(events.map((event) => [event.id, event.kind]));
  assert.equal(kinds.get("span-checkout"), "channel.send");
  assert.equal(kinds.get("span-db-acquire"), "lease.acquire");
  assert.equal(kinds.get("span-db-write"), "cell.mutate");
  assert.equal(kinds.get("span-payment-timeout"), "channel.timeout");
  assert.equal(kinds.get("span-payment-retry"), "channel.retry");
  assert.equal(kinds.get("span-model-call"), "channel.send");
  assert.ok(events.every((event) => event.t >= 0));
});

test("B. INGEST_AUDIT surfaces only an explicitly instrumented lease-expiry event", async () => {
  const events = await readOtelTraceFile(samplePath);
  const findings = auditNative(events);
  const expiry = findings.filter((finding) => finding.rule_id === "native-lease-epoch-expiry");
  assert.equal(expiry.length, 1);
  assert.equal(expiry[0]?.status, "proven");
  assert.deepEqual(expiry[0]?.evidence.span_ids, ["span-lease-expiry"]);
  assert.ok(!findings.some((finding) => finding.rule_id === "r04-network-idempotency"));
});

test("C. INGEST_UNKNOWN retains unmapped span data as external.unknown", async () => {
  const events = await readOtelTraceFile(samplePath);
  const unknown = events.find((event) => event.id === "span-custom-metric");
  assert.equal(unknown?.kind, "external.unknown");
  assert.equal((unknown?.data.raw as Record<string, unknown>).name, "custom.metric.flush");
  assert.equal(unknown?.data["metric.name"], "queue_depth");
});

test("LangChain JSONL adapter maps retry metadata and preserves unsupported callbacks", () => {
  const jsonl = [
    JSON.stringify({ event_id: "call-start", event: "tool_start", run_id: "call-1", name: "payment.attempt", side_effect: "POST", retry_count: 0, start_time: "2026-01-01T00:00:00.000Z" }),
    JSON.stringify({ event_id: "call-retry", event: "tool_start", run_id: "call-2", name: "payment.attempt", side_effect: "POST", retry_count: 1, attempt_of: "call-1", start_time: "2026-01-01T00:00:01.000Z" }),
    JSON.stringify({ event_id: "opaque", event: "custom_callback", run_id: "custom-1", name: "unsupported.callback", start_time: "2026-01-01T00:00:02.000Z" }),
  ].join("\n");
  const events = langchainJsonlToSimEvents(jsonl);
  assert.equal(events.find((event) => event.id === "call-start")?.kind, "channel.send");
  assert.equal(events.find((event) => event.id === "call-retry")?.kind, "channel.retry");
  const unknown = events.find((event) => event.id === "opaque");
  assert.equal(unknown?.kind, "external.unknown");
  assert.equal((unknown?.data.raw as Record<string, unknown>).name, "unsupported.callback");
});
