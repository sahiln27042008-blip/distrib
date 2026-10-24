import { test } from "node:test";
import assert from "node:assert/strict";
import type { Trace } from "../src/trace.ts";
import { exportChaosLangChainJsonl } from "../src/chaos-auditor-adapter.ts";

const parse = (jsonl: string) => jsonl.trim().split(/\r?\n+/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);

test("adapter emits chain_start + payment tool events for a minimal sim trace", () => {
  const trace: Trace = {
    schema: "sim-trace/0",
    simulated: true,
    virtualTime: true,
    traceId: "t-root",
    spans: [
      {
        spanId: "root",
        parentSpanId: null,
        name: "root.run",
        startMs: 0,
        endMs: 50,
        status: "ok",
        attrs: { declared_budget: 0.25 },
        links: [],
        events: [],
      },
      {
        spanId: "pay-1",
        parentSpanId: "root",
        name: "payment.attempt",
        startMs: 10,
        endMs: 40,
        status: "ok",
        attrs: {
          side_effect: "POST",
          body_hash: "sha256:abc123",
          idempotency_key: null,
          retry_count: 1,
          attempt_of: "root",
        },
        links: [{ type: "retry_of", spanId: "root" }],
        events: [],
      },
    ],
    derived: { snapshot: { config: { F: "F3_resilient_invariant_runtime" } } },
  };

  const out = exportChaosLangChainJsonl(trace);
  const records = parse(out);
  assert.equal(records.length, 4, "root start/end + payment start/end");
  assert.equal(records.filter((r) => r.event === "chain_start").length, 1);
  assert.equal(records.filter((r) => r.event === "tool_start" && r.name === "payment.attempt").length, 1);
  const start = records.find((r) => r.event === "tool_start" && r.name === "payment.attempt")!;
  assert.equal(start.side_effect, "POST");
  assert.equal(start.body_hash, "sha256:abc123");
  assert.equal(start.idempotency_key, null);
  assert.equal(start.retry_count, 1);
  assert.equal(start.attempt_of, "root");
  assert.equal((start.metadata as Record<string, unknown>).source, "sim-trace/0-to-langchain-callback-jsonl/1; SIMULATED");
  assert.equal(records[0].event, "chain_start");
  assert.equal(out, out.trim() + "\n");
});

test("adapter emits storage_write events from db.write spans", () => {
  const trace: Trace = {
    schema: "sim-trace/0",
    simulated: true,
    virtualTime: true,
    traceId: "t-db",
    spans: [
      {
        spanId: "root",
        parentSpanId: null,
        name: "root.run",
        startMs: 0,
        endMs: 20,
        status: "ok",
        attrs: {},
        links: [],
        events: [],
      },
      {
        spanId: "db-1",
        parentSpanId: "root",
        name: "db.write",
        startMs: 10,
        endMs: 10,
        status: "ok",
        attrs: {
          step_type: "storage_write",
          payload_size: 15_000_000,
          storage_class: "primary",
          offloaded: false,
        },
        links: [],
        events: [],
      },
    ],
    derived: {},
  };

  const records = parse(exportChaosLangChainJsonl(trace));
  const rec = records.find((r) => r.event === "tool_start" && r.step_type === "storage_write")!;
  assert.ok(rec);
  assert.equal(rec.payload_size, 15_000_000);
  assert.equal(rec.storage_class, "primary");
  assert.equal(rec.offloaded, false);
});

test("adapter emits llm_start + llm_end for model_call spans", () => {
  const trace: Trace = {
    schema: "sim-trace/0",
    simulated: true,
    virtualTime: true,
    traceId: "t-llm",
    spans: [
      {
        spanId: "root",
        parentSpanId: null,
        name: "root.run",
        startMs: 0,
        endMs: 20,
        status: "ok",
        attrs: {},
        links: [],
        events: [],
      },
      {
        spanId: "llm-1",
        parentSpanId: "root",
        name: "model_call",
        startMs: 10,
        endMs: 20,
        status: "ok",
        attrs: {
          model: "mock-llm",
          tokens_in: 120,
          tokens_out: 80,
          cost: 0.12,
        },
        links: [],
        events: [],
      },
    ],
    derived: {},
  };

  const records = parse(exportChaosLangChainJsonl(trace));
  assert.equal(records.filter((r) => r.event === "llm_start").length, 1);
  assert.equal(records.filter((r) => r.event === "llm_end").length, 1);
  const start = records.find((r) => r.event === "llm_start")!;
  assert.equal(start.prompt_tokens, 120);
  assert.equal(start.completion_tokens, 80);
  assert.equal(start.cost, 0.12);
});

test("adapter output is deterministic across identical traces", () => {
  const trace: Trace = {
    schema: "sim-trace/0",
    simulated: true,
    virtualTime: true,
    traceId: "t-det",
    spans: [
      {
        spanId: "root",
        parentSpanId: null,
        name: "root.run",
        startMs: 0,
        endMs: 10,
        status: "ok",
        attrs: {},
        links: [],
        events: [],
      },
      {
        spanId: "x-1",
        parentSpanId: "root",
        name: "payment.attempt",
        startMs: 2,
        endMs: 7,
        status: "ok",
        attrs: { side_effect: "PUT", body_hash: "sha256:det", idempotency_key: "abc" },
        links: [],
        events: [],
      },
    ],
    derived: {},
  };

  assert.equal(exportChaosLangChainJsonl(trace), exportChaosLangChainJsonl(trace));
});
