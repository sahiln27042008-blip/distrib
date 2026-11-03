import { createHash } from "node:crypto";
import type { Trace } from "./trace.ts";

export const CHAOS_AUDITOR_ADAPTER_VERSION = "sim-trace/0-to-langchain-callback-jsonl/1";

const EPOCH_MS = Date.UTC(2026, 0, 1);
const iso = (virtualMs: number) => new Date(EPOCH_MS + virtualMs).toISOString();

function canon(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
}

function sha(v: unknown): string {
  return `sha256:${createHash("sha256").update(canon(v)).digest("hex")}`;
}

function metadata(sourceEventIds?: string[]): Record<string, unknown> {
  const v: Record<string, unknown> = { source: `${CHAOS_AUDITOR_ADAPTER_VERSION}; SIMULATED` };
  if (sourceEventIds && sourceEventIds.length > 0) v.source_event_ids = sourceEventIds;
  return v;
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

export function exportChaosLangChainJsonl(trace: Trace): string {
  const root = trace.spans.find((s) => s.name === "matrix.run" || s.name === "refund.request") ?? trace.spans.find((s) => s.parentSpanId === null && s.name !== "saga.compensation") ?? trace.spans[0];
  if (!root) throw new Error("trace has no spans");

  const events: Array<{ t: number; order: number; rec: Record<string, unknown> }> = [];
  let order = 0;
  const push = (t: number, rec: Record<string, unknown>) => {
    events.push({ t, order: order++, rec });
  };

  const rootStartId = `${root.spanId}:start`;
  const rootEndId = `${root.spanId}:end`;
  const rootInput: Record<string, unknown> = {};
  if (root.attrs !== undefined && typeof root.attrs === "object") {
    Object.entries(root.attrs).forEach(([key, value]) => {
      if (value !== undefined) rootInput[key] = value;
    });
  }
  const input = Object.keys(rootInput).length > 0 ? rootInput : { traceId: trace.traceId };
  const output = { final_state: root.events.length > 0 ? root.events[root.events.length - 1]?.attrs ?? null : null };
  push(root.startMs, {
    event_id: rootStartId,
    event: "chain_start",
    run_id: root.spanId,
    name: root.name,
    input,
    start_time: iso(root.startMs),
    metadata: metadata(),
    ...(typeof root.attrs?.declared_budget === "number" ? { declared_budget: root.attrs.declared_budget } : {}),
  });
  push(root.endMs, {
    event_id: rootEndId,
    event: "chain_end",
    run_id: root.spanId,
    name: root.name,
    output,
    end_time: iso(root.endMs),
    metadata: metadata([rootStartId]),
  });

  let spansToProcess = trace.spans;
  if (spansToProcess.length > 3000) {
    const highPriority = spansToProcess.filter(s => s.spanId === root.spanId || s.name === "saga.compensation" || s.name === "model_call" || s.status !== "ok" || s.attrs?.compensation_required === true || s.attrs?.saga_id !== undefined);
    const otherSpans = spansToProcess.filter(s => !(s.spanId === root.spanId || s.name === "saga.compensation" || s.name === "model_call" || s.status !== "ok" || s.attrs?.compensation_required === true || s.attrs?.saga_id !== undefined));
    const allowedOther = Math.max(0, 3000 - highPriority.length);
    spansToProcess = [...highPriority.slice(0, 3000), ...otherSpans.slice(0, allowedOther)].sort((a, b) => a.startMs - b.startMs);
  }
  for (const span of spansToProcess) {
    if (span.spanId === root.spanId) continue;

    const attrs = span.attrs ?? {};
    const parentRunId = (span.parentSpanId && span.parentSpanId !== span.spanId) ? span.parentSpanId : root.spanId;
    const parentEventIds = [span.spanId + ":start"];

    if (span.name === "payment.attempt" || span.name === "payment.attempt.sent") {
      const bodyHash = typeof attrs.body_hash === "string" ? attrs.body_hash : sha({
        side_effect: attrs.side_effect,
        amountDollars: attrs.amountDollars,
        payload: attrs.payload,
      });
      const toolStart: Record<string, unknown> = {
        event_id: `${span.spanId}:start`,
        event: "tool_start",
        run_id: span.spanId,
        parent_run_id: parentRunId,
        name: span.name,
        resource: "mock://payment/attempt",
        start_time: iso(span.startMs),
        metadata: metadata(),
      };
      if (typeof attrs.side_effect === "string") toolStart.side_effect = attrs.side_effect;
      if (bodyHash) toolStart.body_hash = bodyHash;
      if (attrs.idempotency_key !== undefined) toolStart.idempotency_key = attrs.idempotency_key;
      if (attrs.retry_count !== undefined) toolStart.retry_count = Number(attrs.retry_count);
      if (typeof attrs.saga_id === "string") toolStart.saga_id = attrs.saga_id;
      if (typeof attrs.compensation_required === "boolean") toolStart.compensation_required = attrs.compensation_required;
      if (typeof attrs.attempt_of === "string") toolStart.attempt_of = attrs.attempt_of;
      else {
        const retryOf = span.links.find((link) => link.type === "retry_of")?.spanId;
        if (retryOf) toolStart.attempt_of = retryOf;
      }
      const toolEnd: Record<string, unknown> = {
        event_id: `${span.spanId}:end`,
        event: "tool_end",
        run_id: span.spanId,
        parent_run_id: parentRunId,
        end_time: iso(span.endMs),
        metadata: metadata(parentEventIds),
      };
      if (typeof span.status === "string" && span.status !== "ok") toolEnd.error = span.status;
      push(span.startMs, toolStart);
      push(span.endMs, toolEnd);
      continue;
    }

    if (span.name === "db.write" || (typeof attrs.step_type === "string" && attrs.step_type === "storage_write")) {
      const start: Record<string, unknown> = {
        event_id: `${span.spanId}:start`,
        event: "tool_start",
        run_id: span.spanId,
        parent_run_id: parentRunId,
        name: "db.write",
        resource: "mock://db/write",
        step_type: "storage_write",
        start_time: iso(span.startMs),
        metadata: metadata(),
      };
      if (attrs.payload_size !== undefined) start.payload_size = Number(attrs.payload_size);
      if (typeof attrs.storage_class === "string") start.storage_class = attrs.storage_class;
      if (attrs.offloaded !== undefined) start.offloaded = Boolean(attrs.offloaded);
      const end: Record<string, unknown> = {
        event_id: `${span.spanId}:end`,
        event: "tool_end",
        run_id: span.spanId,
        parent_run_id: parentRunId,
        step_type: "storage_write",
        end_time: iso(span.endMs),
        metadata: metadata([`${span.spanId}:start`]),
      };
      push(span.startMs, start);
      push(span.endMs, end);
      continue;
    }

    if (span.name === "workflow.execution") {
      const start: Record<string, unknown> = {
        event_id: `${span.spanId}:start`,
        event: "tool_start",
        run_id: span.spanId,
        parent_run_id: parentRunId,
        name: "workflow.execution",
        resource: "sim://workflow/execution",
        step_type: "tool_call",
        ...(attrs.compensation_missing === true ? {} : { side_effect: typeof attrs.side_effect === "string" ? attrs.side_effect : "POST" }),
        start_time: iso(span.startMs),
        metadata: metadata(),
      };
      if (typeof attrs.execution_id === "string") start.execution_id = attrs.execution_id;
      if (typeof attrs.declared_budget === "number") start.declared_budget = attrs.declared_budget;
      const end: Record<string, unknown> = {
        event_id: `${span.spanId}:end`,
        event: "tool_end",
        run_id: span.spanId,
        parent_run_id: parentRunId,
        step_type: "tool_call",
        ...(attrs.compensation_missing === true ? {} : { side_effect: typeof attrs.side_effect === "string" ? attrs.side_effect : "POST" }),
        end_time: iso(span.endMs),
        metadata: metadata([`${span.spanId}:start`]),
      };
      push(span.startMs, start);
      push(span.endMs, end);
      continue;
    }

    if (span.name === "model_call") {
      const start: Record<string, unknown> = {
        event_id: `${span.spanId}:start`,
        event: "llm_start",
        run_id: span.spanId,
        parent_run_id: parentRunId,
        name: span.name,
        input: { model: attrs.model ?? "mock-llm" },
        start_time: iso(span.startMs),
        metadata: metadata(),
      };
      if (typeof attrs.execution_id === "string") start.execution_id = attrs.execution_id;
      if (attrs.tokens_in !== undefined) start.prompt_tokens = Number(attrs.tokens_in);
      if (attrs.tokens_out !== undefined) start.completion_tokens = Number(attrs.tokens_out);
      if (attrs.cost !== undefined) { const c = Number(attrs.cost); start.cost = c; start.total_cost = c; }
      const end: Record<string, unknown> = {
        event_id: `${span.spanId}:end`,
        event: "llm_end",
        run_id: span.spanId,
        parent_run_id: parentRunId,
        output: { model: attrs.model ?? "mock-llm" },
        end_time: iso(span.endMs),
        metadata: metadata([`${span.spanId}:start`]),
      };
      if (typeof attrs.execution_id === "string") end.execution_id = attrs.execution_id;
      if (attrs.tokens_in !== undefined) end.prompt_tokens = Number(attrs.tokens_in);
      if (attrs.tokens_out !== undefined) end.completion_tokens = Number(attrs.tokens_out);
      if (attrs.cost !== undefined) { const c = Number(attrs.cost); end.cost = c; end.total_cost = c; }
      push(span.startMs, start);
      push(span.endMs, end);
      continue;
    }

    if (span.name === "saga.compensation") {
      const start: Record<string, unknown> = {
        event_id: `${span.spanId}:start`,
        event: "tool_start",
        run_id: span.spanId,
        parent_run_id: parentRunId,
        name: span.name,
        resource: "mock://saga/compensate",
        step_type: "tool_call",
        ...(attrs.compensation_missing === true ? {} : { side_effect: typeof attrs.side_effect === "string" ? attrs.side_effect : "POST" }),
        start_time: iso(span.startMs),
        metadata: metadata(),
      };
      if (typeof attrs.saga_id === "string") start.saga_id = attrs.saga_id;
      if (typeof attrs.compensation_required === "boolean") start.compensation_required = attrs.compensation_required;
      if (typeof attrs.compensation_for === "string") start.compensation_for = attrs.compensation_for;
      if (typeof attrs.compensation_order === "number") start.compensation_order = attrs.compensation_order;
      if (typeof attrs.compensation_missing === "boolean") start.compensation_missing = attrs.compensation_missing;
      const end: Record<string, unknown> = {
        event_id: `${span.spanId}:end`,
        event: "tool_end",
        run_id: span.spanId,
        parent_run_id: parentRunId,
        step_type: "tool_call",
        end_time: iso(span.endMs),
        metadata: metadata([`${span.spanId}:start`]),
      };
      if (span.status !== "ok") end.error = span.status;
      push(span.startMs, start);
      push(span.endMs, end);
    }
  }

  events.sort((a, b) => a.t - b.t || a.order - b.order);
  return events.map(({ rec }) => JSON.stringify(rec)).join("\n") + "\n";
}
