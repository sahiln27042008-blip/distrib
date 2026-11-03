import type { SimEvent } from "./kernel.ts";

// Standalone trace format ("sim-trace/0"). NOT the agent-runtime-invariants schema:
// that repo is not available here, so an adapter must be written against its real types.
export interface Span {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startMs: number; // virtual ms
  endMs: number;
  status: "ok" | "timeout" | "unfinished" | "error";
  attrs: Record<string, unknown>;
  links: Array<{ type: "retry_of"; spanId: string }>;
  events: Array<{ t: number; name: string; attrs: Record<string, unknown> }>;
}

export interface Trace {
  schema: "sim-trace/0";
  simulated: true;
  virtualTime: true;
  traceId: string;
  spans: Span[]; // observed facts only
  derived: Record<string, unknown>; // conclusions computed from state, kept separate
}

export function exportTrace(events: SimEvent[], traceId: string, derived: Record<string, unknown>): Trace {
  const byId = new Map(events.map((e) => [e.id, e]));
  const lastT = events.reduce((m, e) => Math.max(m, e.t), 0);
  const sid = (id: string) => `s-${id}`;

  // Walk causal parents up to the owning payment attempt.
  const attemptOf = (e: SimEvent): SimEvent | undefined => {
    for (let cur: SimEvent | undefined = e; cur; cur = cur.parent ? byId.get(cur.parent) : undefined) {
      if (cur.kind === "payment.attempt.sent") return cur;
    }
    return undefined;
  };
  const rootEv = events.find((e) => e.kind === "request.received");
  const rootId = rootEv ? sid(rootEv.id) : null;

  const spans: Span[] = [];
  for (const e of events) {
    const base = { spanId: sid(e.id), links: [] as Span["links"], events: [] as Span["events"] };
    if (e.kind === "request.received") {
      spans.push({
        ...base,
        parentSpanId: null,
        name: "refund.request",
        startMs: e.t,
        endMs: lastT,
        status: "ok",
        attrs: { corr: e.corr, ...e.data },
        events: events.filter((x) => x.kind === "state.transition").map((x) => ({ t: x.t, name: "state.transition", attrs: x.data })),
      });
    } else if (e.kind === "workflow.execution.started") {
      spans.push({
        ...base,
        parentSpanId: rootId,
        name: "workflow.execution",
        startMs: e.t,
        endMs: lastT,
        status: "ok",
        attrs: { ...e.data },
      });
    } else if (e.kind === "model_call") {
      const startMs = typeof e.data.started_at_ms === "number" ? e.data.started_at_ms : e.t;
      spans.push({
        ...base,
        parentSpanId: e.parent ? sid(e.parent) : rootId,
        name: "model_call",
        startMs,
        endMs: startMs,
        status: "ok",
        attrs: { ...e.data },
      });
    } else if (e.kind === "account.call") {
      const res = events.find((x) => x.kind === "account.result" && x.parent === e.id);
      spans.push({ ...base, parentSpanId: rootId, name: "account.lookup", startMs: e.t, endMs: res ? res.t : e.t, status: res ? "ok" : "unfinished", attrs: res ? { ...res.data } : {} });
    } else if (e.kind === "payment.attempt.sent") {
      const mine = events.filter((x) => attemptOf(x)?.id === e.id);
      const end = mine.find((x) => x.kind === "payment.response.received" || x.kind === "client.timeout");
      const late = mine.find((x) => x.kind === "payment.response.late_ignored");
      const server = mine.find((x) => x.kind === "payment.refund.created" || x.kind === "payment.idempotent_replay");
      const { retryOf, ...rest } = e.data as Record<string, unknown> & { retryOf?: string };
      const accepted = rest.outcome === "accepted" || rest.outcome === "replayed" || rest.outcome === "conn_reset";
      const span: Span = {
        ...base,
        parentSpanId: rootId,
        name: "payment.attempt",
        startMs: e.t,
        endMs: end ? end.t : e.t,
        status: accepted ? "ok" : !end ? "unfinished" : end.kind === "client.timeout" ? "timeout" : "ok",
        attrs: {
          ...rest,
          ...(server ? { serverProcessedAtMs: server.t, serverResult: server.kind, refundId: server.data.refundId } : {}),
          ...(late ? { lateResponseAtMs: late.t } : {}),
        },
      };
      if (typeof retryOf === "string") span.links.push({ type: "retry_of", spanId: sid(retryOf) });
      spans.push(span);
    } else if (e.kind === "storage_write") {
      spans.push({
        ...base,
        parentSpanId: rootId,
        name: "db.write",
        startMs: e.t,
        endMs: e.t,
        status: "ok",
        attrs: { ...e.data, step_type: "storage_write" },
      });
    } else if (e.kind === "saga.compensation") {
      spans.push({
        ...base,
        parentSpanId: rootId,
        name: "saga.compensation",
        startMs: e.t,
        endMs: e.t,
        status: typeof e.data.error === "string" ? "error" : "ok",
        attrs: { ...e.data },
      });
    } else if (e.kind === "db.write") {
      const a = attemptOf(e);
      spans.push({ ...base, parentSpanId: a ? sid(a.id) : rootId, name: `db.${String(e.data.table)}.${String(e.data.op)}`, startMs: e.t, endMs: e.t, status: "ok", attrs: { ...e.data } });
    }
  }

  for (const event of events) {
    if (event.kind !== "saga.compensation" || typeof event.data.compensation_for_body_hash !== "string") continue;
    const compensationSpan = spans.find((span) => span.spanId === sid(event.id));
    for (const span of spans) {
      if (span.name !== "payment.attempt" || span.attrs.body_hash !== event.data.compensation_for_body_hash) continue;
      if (event.data.tenant_index !== undefined && span.attrs.tenant_index !== undefined && span.attrs.tenant_index !== event.data.tenant_index) continue;
      if (typeof event.data.saga_id === "string") span.attrs.saga_id = event.data.saga_id;
      span.attrs.compensation_required = true;
      if (compensationSpan) {
        compensationSpan.attrs.compensation_for = span.spanId;
        break;
      }
    }
  }

  return { schema: "sim-trace/0", simulated: true, virtualTime: true, traceId, spans, derived };
}
