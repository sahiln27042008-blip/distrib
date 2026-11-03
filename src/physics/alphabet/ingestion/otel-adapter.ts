import { readFile } from "node:fs/promises";
import type { SimEvent } from "../../../kernel.ts";

interface RawSpan extends Record<string, unknown> {
  name?: unknown;
  spanId?: unknown;
  traceId?: unknown;
  parentSpanId?: unknown;
  startTimeUnixNano?: unknown;
  start_time?: unknown;
  attributes?: unknown;
  events?: unknown;
}

const ALPHABET_EVENT_KINDS = new Set([
  "channel.send",
  "channel.timeout",
  "channel.retry",
  "channel.ack",
  "channel.cascade_failure",
  "lease.acquire",
  "lease.release",
  "lease.rejected",
  "lease.panic_crash",
  "lease.epoch_expired",
  "cell.mutate",
  "cost.burn_exceeded",
]);

function decodeAttributeValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  for (const key of ["stringValue", "intValue", "doubleValue", "boolValue", "bytesValue"]) {
    if (key in record) return record[key];
  }
  return value;
}

function attributesToRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    const attributes: Record<string, unknown> = {};
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.key === "string") attributes[item.key] = decodeAttributeValue(item.value);
    }
    return attributes;
  }
  if (value && typeof value === "object") return { ...(value as Record<string, unknown>) };
  return {};
}

function parseInput(input: string | unknown): unknown[] {
  if (typeof input !== "string") return Array.isArray(input) ? input : [input];
  try {
    const parsed: unknown = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return input.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
  }
}

function collectSpans(value: unknown): RawSpan[] {
  if (Array.isArray(value)) return value.filter((span): span is RawSpan => !!span && typeof span === "object");
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  if (Array.isArray(root.spans)) return root.spans.filter((span): span is RawSpan => !!span && typeof span === "object");
  const output: RawSpan[] = [];
  const resourceSpans = Array.isArray(root.resourceSpans) ? root.resourceSpans : [];
  for (const resourceSpan of resourceSpans) {
    if (!resourceSpan || typeof resourceSpan !== "object") continue;
    const scopeSpans = (resourceSpan as Record<string, unknown>).scopeSpans ?? (resourceSpan as Record<string, unknown>).instrumentationLibrarySpans;
    if (!Array.isArray(scopeSpans)) continue;
    for (const scopeSpan of scopeSpans) {
      if (!scopeSpan || typeof scopeSpan !== "object") continue;
      const spans = (scopeSpan as Record<string, unknown>).spans;
      if (Array.isArray(spans)) output.push(...spans.filter((span): span is RawSpan => !!span && typeof span === "object"));
    }
  }
  return output;
}

function absoluteTime(span: RawSpan): number | undefined {
  const nano = span.startTimeUnixNano;
  if (typeof nano === "string" && /^\d+$/.test(nano)) return Number(BigInt(nano) / 1_000_000n);
  if (typeof nano === "number" && Number.isFinite(nano)) return nano / 1_000_000;
  const time = span.start_time ?? span.timestamp;
  if (typeof time === "number" && Number.isFinite(time)) return time;
  if (typeof time === "string") {
    const parsed = Date.parse(time);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isWriteOperation(operation: unknown): boolean {
  return typeof operation === "string" && /^(insert|update|delete|write|put|upsert)$/i.test(operation.trim());
}

function mapSpan(span: RawSpan, index: number, timeOrigin: number): SimEvent {
  const attributes = attributesToRecord(span.attributes);
  const name = typeof span.name === "string" ? span.name : "";
  const lowerName = name.toLowerCase();
  const explicitKind = attributes["alphabet.event.kind"] ?? attributes["sim.event.kind"];
  const retryCount = Number(attributes["retry.count"] ?? attributes.retry_count ?? 0);
  const hasRetryLink = typeof attributes["retry.attempt_of"] === "string" || typeof attributes.attempt_of === "string";
  const method = attributes["http.request.method"] ?? attributes["http.method"];
  const status = Number(attributes["http.response.status_code"] ?? attributes["http.status_code"] ?? 0);
  const errorType = String(attributes["error.type"] ?? attributes["exception.type"] ?? "").toLowerCase();
  let kind = "external.unknown";

  if (typeof explicitKind === "string" && ALPHABET_EVENT_KINDS.has(explicitKind)) {
    kind = explicitKind;
  } else if (ALPHABET_EVENT_KINDS.has(name)) {
    kind = name;
  } else if (retryCount > 0 || hasRetryLink || lowerName.includes("retry")) {
    kind = "channel.retry";
  } else if (
    attributes["db.connection.action"] === "acquire" ||
    attributes["db.connection.held"] === true ||
    /db(\.|_)?connection\.(acquire|checkout)|connection\.(acquire|checkout)/i.test(name)
  ) {
    kind = "lease.acquire";
  } else if (isWriteOperation(attributes["db.operation.name"] ?? attributes["db.operation"])) {
    kind = "cell.mutate";
  } else if (attributes["gen_ai.operation.name"] || /\b(llm|chat completion|text completion|model call)\b/i.test(name)) {
    kind = "channel.send";
  } else if (method || attributes["url.full"] || attributes["http.url"] || lowerName.startsWith("http.")) {
    kind = status >= 400 || errorType.includes("timeout") || lowerName.includes("timeout")
      ? "channel.timeout"
      : "channel.send";
  }

  const spanId = typeof span.spanId === "string" ? span.spanId : `otel-span-${index + 1}`;
  const traceId = typeof span.traceId === "string" ? span.traceId : spanId;
  const start = absoluteTime(span);
  const event: SimEvent = {
    id: spanId,
    t: start === undefined ? index : Math.max(0, start - timeOrigin),
    kind,
    corr: traceId,
    data: {
      ...attributes,
      name,
      raw: span,
      ...(typeof method === "string" ? { method } : {}),
      ...(Number.isFinite(retryCount) && retryCount > 0 ? { retryCount } : {}),
    },
  };
  if (typeof span.parentSpanId === "string" && span.parentSpanId.length > 0) event.parent = span.parentSpanId;
  return event;
}

export function otelTraceToSimEvents(input: string | unknown): SimEvent[] {
  const parsed = parseInput(input);
  const spans = parsed.flatMap(collectSpans);
  const timestamps = spans.map(absoluteTime).filter((time): time is number => time !== undefined);
  const origin = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  return spans.map((span, index) => mapSpan(span, index, origin)).sort((left, right) => left.t - right.t || left.id.localeCompare(right.id));
}

export async function readOtelTraceFile(filePath: string): Promise<SimEvent[]> {
  return otelTraceToSimEvents(await readFile(filePath, "utf8"));
}
