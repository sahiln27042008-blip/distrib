import { readFile } from "node:fs/promises";
import type { SimEvent } from "../../../kernel.ts";

interface CallbackRecord extends Record<string, unknown> {
  event?: unknown;
  event_id?: unknown;
  run_id?: unknown;
  parent_run_id?: unknown;
  name?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  metadata?: unknown;
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

function parseRecords(input: string | unknown): CallbackRecord[] {
  if (typeof input !== "string") {
    if (Array.isArray(input)) return input.filter((record): record is CallbackRecord => !!record && typeof record === "object");
    if (input && typeof input === "object") {
      const root = input as Record<string, unknown>;
      const records = Array.isArray(root.records) ? root.records : Array.isArray(root.events) ? root.events : [input];
      return records.filter((record): record is CallbackRecord => !!record && typeof record === "object");
    }
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(input);
    return parseRecords(parsed);
  } catch {
    return input.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as CallbackRecord);
  }
}

function timeValue(record: CallbackRecord): number | undefined {
  const value = record.start_time ?? record.end_time ?? record.timestamp;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function callbackKind(record: CallbackRecord): string {
  const metadata = record.metadata && typeof record.metadata === "object"
    ? record.metadata as Record<string, unknown>
    : {};
  const explicitKind = metadata["alphabet.event.kind"] ?? metadata["sim.event.kind"];
  if (typeof explicitKind === "string" && ALPHABET_EVENT_KINDS.has(explicitKind)) return explicitKind;

  const event = String(record.event ?? "").toLowerCase();
  const name = String(record.name ?? "").toLowerCase();
  const retryCount = Number(record.retry_count ?? metadata.retry_count ?? 0);
  const attemptOf = record.attempt_of ?? metadata.attempt_of;
  if (retryCount > 0 || typeof attemptOf === "string" || name.includes("retry")) return "channel.retry";
  if ((event === "llm_start" || event === "chat_model_start") || /\b(llm|chat model|completion)\b/.test(name)) return "channel.send";
  if (record.step_type === "storage_write" || /\b(db\.write|database write)\b/.test(name)) return "cell.mutate";
  if (/connection\.(acquire|checkout)|db connection acquire/.test(name) || metadata["db.connection.action"] === "acquire") return "lease.acquire";
  if (event === "tool_end" && record.error !== undefined && /timeout|timed out|deadline/i.test(String(record.error))) return "channel.timeout";
  if (event === "tool_start" && (record.side_effect !== undefined || String(record.resource ?? "").startsWith("channel://") || String(record.resource ?? "").startsWith("http"))) return "channel.send";
  return "external.unknown";
}

function toEvent(record: CallbackRecord, index: number, origin: number): SimEvent {
  const timestamp = timeValue(record);
  const eventId = typeof record.event_id === "string" ? record.event_id : `langchain-event-${index + 1}`;
  const runId = typeof record.run_id === "string" ? record.run_id : eventId;
  const event: SimEvent = {
    id: eventId,
    t: timestamp === undefined ? index : Math.max(0, timestamp - origin),
    kind: callbackKind(record),
    corr: runId,
    data: { ...record, raw: record },
  };
  if (typeof record.parent_run_id === "string" && record.parent_run_id.length > 0) event.parent = record.parent_run_id;
  return event;
}

export function langchainJsonlToSimEvents(input: string | unknown): SimEvent[] {
  const records = parseRecords(input);
  const timestamps = records.map(timeValue).filter((time): time is number => time !== undefined);
  const origin = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  return records.map((record, index) => toEvent(record, index, origin)).sort((left, right) => left.t - right.t || left.id.localeCompare(right.id));
}

export async function readLangchainTraceFile(filePath: string): Promise<SimEvent[]> {
  return langchainJsonlToSimEvents(await readFile(filePath, "utf8"));
}
