// enterpriseee/enterprise-simulator/src/physics/search/execute-faults.ts

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Sim, type SimEvent } from "../../kernel.ts";
import type { CompiledAlphabetGraph, Consonant, Vowel } from "../alphabet/types.ts";
import { Cell } from "../alphabet/vowels/cell.ts";
import { Lease } from "../alphabet/vowels/lease.ts";
import { Log } from "../alphabet/vowels/log.ts";
import { Channel } from "../alphabet/vowels/channel.ts";
import { applyConsonant } from "../alphabet/apply.ts";
import { auditNative } from "../alphabet/invariants/native-auditor.ts";
import type { ConsonantFault } from "./search-types.ts";
import type { Finding } from "../alphabet/invariants/finding.ts";

export interface FaultExecutionResult {
  events: SimEvent[];
  findings: Finding[];
  violatedInvariants: string[];
}

interface AuditorModule {
  parseLangChainCallbackJsonl: (jsonl: string) => any;
  auditTrace: (trace: any) => Finding[];
}

let cachedAuditor: AuditorModule | null = null;

export function resolveAuditor(): AuditorModule {
  const envRepo = process.env.SIM_AUDITOR_REPO;
  if (!envRepo && cachedAuditor) return cachedAuditor;
  const candidates = envRepo
    ? [envRepo]
    : [
        fileURLToPath(new URL("../../../../../../resilient-agent-invariants", import.meta.url)),
        fileURLToPath(new URL("../../../../../resilient-agent-invariants", import.meta.url)),
        fileURLToPath(new URL("../../../../resilient-agent-invariants", import.meta.url)),
        fileURLToPath(new URL("../../../resilient-agent-invariants", import.meta.url)),
      ];

  const repo = candidates.find((c) => existsSync(c));
  if (!repo) {
    throw new Error("Could not resolve resilient-agent-invariants repository");
  }

  const require = createRequire(import.meta.url);
  const distEntry = `${repo}/dist/src/index.js`;

  if (existsSync(distEntry)) {
    const mod = require(distEntry);
    cachedAuditor = {
      parseLangChainCallbackJsonl: mod.parseLangChainCallbackJsonl,
      auditTrace: mod.auditTrace,
    };
    return cachedAuditor;
  }

  throw new Error(`Auditor dist entry not found at ${distEntry}`);
}

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

export function convertAlphabetEventsToLangChainJsonl(
  events: SimEvent[],
  cellMap: Map<string, Cell>,
  channelMap: Map<string, Channel>,
): string {
  const jsonRecords: Array<{ t: number; order: number; rec: Record<string, unknown> }> = [];
  let order = 0;
  const push = (t: number, rec: Record<string, unknown>) => {
    jsonRecords.push({ t, order: order++, rec });
  };

  const lastT = events.reduce((max, e) => Math.max(max, e.t), 0);
  const rootRunId = "root";

  // Root run start and end
  push(0, {
    event_id: `${rootRunId}:start`,
    event: "chain_start",
    run_id: rootRunId,
    name: "alphabet_workflow",
    input: { eventCount: events.length },
    start_time: iso(0),
    metadata: { source: "sim-trace/0-to-langchain-callback-jsonl/1; SIMULATED" },
  });

  const hasCrash = events.some((e) => e.kind === "lease.panic_crash");
  push(lastT, {
    event_id: `${rootRunId}:end`,
    event: "chain_end",
    run_id: rootRunId,
    name: "alphabet_workflow",
    output: { final_event_count: events.length },
    end_time: iso(lastT),
    metadata: {
      source: "sim-trace/0-to-langchain-callback-jsonl/1; SIMULATED",
      source_event_ids: [`${rootRunId}:start`],
    },
    ...(hasCrash ? { error: "lease.panic_crash" } : {}),
  });

  // Lease expiry evidence (wiring-level failure detection)
  for (const expire of events.filter((e) => e.kind === "lease.epoch_expired")) {
    const leaseId = String(expire.data.leaseId ?? expire.corr ?? "lease");
    const runId = `tool-lease-expire-${leaseId}-${expire.id}`;

    push(expire.t, {
      event_id: `${runId}:start`,
      event: "tool_start",
      run_id: runId,
      parent_run_id: rootRunId,
      name: "lease.expire",
      resource: `lease://${leaseId}`,
      start_time: iso(expire.t),
      metadata: { source: "sim-trace/0-to-langchain-callback-jsonl/1; SIMULATED" },
    });

    push(expire.t, {
      event_id: `${runId}:end`,
      event: "tool_end",
      run_id: runId,
      parent_run_id: rootRunId,
      end_time: iso(expire.t),
      metadata: {
        source: "sim-trace/0-to-langchain-callback-jsonl/1; SIMULATED",
        source_event_ids: [`${runId}:start`],
      },
      error: "lease.epoch_expired",
    });
  }

  // Channel cascade evidence (target lease saturated before send)
  for (const cascade of events.filter((e) => e.kind === "channel.cascade_failure")) {
    const channelId = String(cascade.data.channelId ?? cascade.corr ?? "channel");
    const runId = `tool-channel-cascade-${channelId}-${cascade.id}`;

    push(cascade.t, {
      event_id: `${runId}:start`,
      event: "tool_start",
      run_id: runId,
      parent_run_id: rootRunId,
      name: "channel.cascade_failure",
      resource: `channel://${channelId}`,
      start_time: iso(cascade.t),
      metadata: { source: "sim-trace/0-to-langchain-callback-jsonl/1; SIMULATED" },
    });

    push(cascade.t, {
      event_id: `${runId}:end`,
      event: "tool_end",
      run_id: runId,
      parent_run_id: rootRunId,
      end_time: iso(cascade.t),
      metadata: {
        source: "sim-trace/0-to-langchain-callback-jsonl/1; SIMULATED",
        source_event_ids: [`${runId}:start`],
      },
      error: "channel.cascade_failure",
    });
  }

  // Index channel.send events
  const sendEvents = events.filter((e) => e.kind === "channel.send");
  const sendsByChannel = new Map<string, SimEvent[]>();
  for (const send of sendEvents) {
    const chId = String(send.data.channelId ?? send.corr);
    const list = sendsByChannel.get(chId) ?? [];
    list.push(send);
    sendsByChannel.set(chId, list);
  }

  for (const send of sendEvents) {
    const chId = String(send.data.channelId ?? send.corr);
    const channel = channelMap.get(chId);
    const targetActorId = String(send.data.targetActorId ?? channel?.targetActorId ?? chId);
    const targetCell = Array.from(cellMap.values()).find((c) => c.actorId === targetActorId);

    const chSends = sendsByChannel.get(chId) ?? [send];
    const attemptIndex = chSends.indexOf(send);
    const isRetry = attemptIndex > 0;
    const firstSend = chSends[0] ?? send;

    const runId = `tool-chan-${send.id}`;
    const firstRunId = `tool-chan-${firstSend.id}`;
    const preCommitSever = events.some(
      (event) => event.kind === "consonant.sever.pre_commit" && String(event.data.channelId ?? event.corr) === chId,
    );

    const payload = send.data.payload ?? { channelId: chId };
    const bodyHash = sha(payload);

    // End time and status for this send
    const relevantEvents = events.filter(
      (e) => e.t >= send.t && String(e.data.channelId ?? e.corr) === chId,
    );
    const ackEvent = relevantEvents.find((e) => e.kind === "channel.ack");
    const timeoutEvent = relevantEvents.find((e) => e.kind === "channel.timeout");
    const divergenceEvent = relevantEvents.find((e) => e.kind === "channel.divergence_detected");

    let endMs = send.t;
    let error: string | undefined;

    if (divergenceEvent || timeoutEvent || !ackEvent) {
      error = "timeout";
      endMs = timeoutEvent?.t ?? (send.t + (channel?.timeoutMs ?? 5000));
    } else {
      endMs = ackEvent?.t ?? send.t;
    }

    // Idempotency key handling:
    // If target cell does not enforce idempotency, retry has explicitly absent idempotency_key (null)
    const cellWasWiped = events.some(
      (e) =>
        (e.kind === "cell.wipe" || e.kind === "consonant.wipe.volatile") &&
        (String(e.data.cellId ?? e.corr) === targetCell?.id || e.data.actorId === targetActorId),
    );

    let idempotencyKey: string | null | undefined;
    if (channel?.idempotencyEnabled) {
      const payloadHash = bodyHash.replace("sha256:", "");
      idempotencyKey = createHash("sha256").update(`wf+${channel.sourceActorId}+${payloadHash}`).digest("hex");
    } else if (isRetry) {
      idempotencyKey = targetCell?.idempotencyEnforced && !cellWasWiped ? `idem-${bodyHash}` : null;
    } else {
      idempotencyKey = targetCell?.idempotencyEnforced && !cellWasWiped ? `idem-${bodyHash}` : undefined;
    }

    push(send.t, {
      event_id: `${runId}:start`,
      event: "tool_start",
      run_id: runId,
      parent_run_id: rootRunId,
      name: "payment.attempt",
      resource: `channel://${targetActorId}`,
      ...(targetCell && (!preCommitSever || isRetry) ? { side_effect: "POST" } : {}),
      body_hash: bodyHash,
      ...(idempotencyKey !== undefined ? { idempotency_key: idempotencyKey } : {}),
      ...(isRetry
        ? { retry_count: attemptIndex, attempt_of: firstRunId }
        : { retry_count: 0 }),
      start_time: iso(send.t),
      metadata: { source: "sim-trace/0-to-langchain-callback-jsonl/1; SIMULATED" },
    });

    push(endMs, {
      event_id: `${runId}:end`,
      event: "tool_end",
      run_id: runId,
      parent_run_id: rootRunId,
      end_time: iso(endMs),
      metadata: {
        source: "sim-trace/0-to-langchain-callback-jsonl/1; SIMULATED",
        source_event_ids: [`${runId}:start`],
      },
      ...(error ? { error } : {}),
    });
  }

  // Storage writes from cell.mutate
  const mutateEvents = events.filter((e) => e.kind === "cell.mutate");
  for (const mut of mutateEvents) {
    const cellId = String(mut.data.cellId ?? mut.corr);
    const cell = cellMap.get(cellId);
    if (cell && cell.persistence === "DURABLE") {
      const runId = `tool-cell-${mut.id}`;
      const payloadSize =
        typeof mut.data.payloadSize === "number"
          ? mut.data.payloadSize
          : Math.max(64, canon(mut.data.state).length);

      push(mut.t, {
        event_id: `${runId}:start`,
        event: "tool_start",
        run_id: runId,
        parent_run_id: rootRunId,
        name: "db.write",
        resource: "mock://db/write",
        step_type: "storage_write",
        payload_size: payloadSize,
        storage_class: "primary",
        offloaded: false,
        start_time: iso(mut.t),
        metadata: { source: "sim-trace/0-to-langchain-callback-jsonl/1; SIMULATED" },
      });

      push(mut.t, {
        event_id: `${runId}:end`,
        event: "tool_end",
        run_id: runId,
        parent_run_id: rootRunId,
        step_type: "storage_write",
        end_time: iso(mut.t),
        metadata: {
          source: "sim-trace/0-to-langchain-callback-jsonl/1; SIMULATED",
          source_event_ids: [`${runId}:start`],
        },
      });
    }
  }

  // Saga compensations if any
  const sagaEvents = events.filter((e) => e.kind === "saga.compensation");
  for (const saga of sagaEvents) {
    const runId = `tool-saga-${saga.id}`;
    push(saga.t, {
      event_id: `${runId}:start`,
      event: "tool_start",
      run_id: runId,
      parent_run_id: rootRunId,
      name: "saga.compensation",
      resource: "mock://saga/compensate",
      step_type: "tool_call",
      saga_id: String(saga.data.saga_id ?? "saga-1"),
      compensation_required: true,
      start_time: iso(saga.t),
      metadata: { source: "sim-trace/0-to-langchain-callback-jsonl/1; SIMULATED" },
    });

    push(saga.t, {
      event_id: `${runId}:end`,
      event: "tool_end",
      run_id: runId,
      parent_run_id: rootRunId,
      step_type: "tool_call",
      end_time: iso(saga.t),
      metadata: {
        source: "sim-trace/0-to-langchain-callback-jsonl/1; SIMULATED",
        source_event_ids: [`${runId}:start`],
      },
    });
  }

  jsonRecords.sort((a, b) => a.t - b.t || a.order - b.order);
  return jsonRecords.map(({ rec }) => JSON.stringify(rec)).join("\n") + "\n";
}

export async function executeFaultSequence(
  graph: CompiledAlphabetGraph,
  faults: ConsonantFault[],
  seed: number,
): Promise<FaultExecutionResult> {
  const requestedDuplicateEvents = faults
    .filter((fault) => fault.consonantKind === "DUPLICATE")
    .reduce((total, fault) => total + Math.max(0, Number(fault.params.count) || 0), 0);
  const maxEvents = Math.min(100_000, Math.max(2_000, 2_000 + requestedDuplicateEvents * 8));
  const sim = new Sim(seed, { maxEvents });

  const cellMap = new Map<string, Cell>();
  const leaseMap = new Map<string, Lease>();
  const logMap = new Map<string, Log>();
  const channelMap = new Map<string, Channel>();
  const vowelMap = new Map<string, Vowel>();

  // Instantiate fresh vowels on this sim
  for (const v of graph.vowels) {
    if (v.kind === "CELL") {
      const c = v as Cell;
      const Ctor = (c.constructor as any) || Cell;
      const cell = new Ctor({
        id: c.id,
        actorId: c.actorId,
        persistence: c.persistence,
        idempotencyEnforced: c.idempotencyEnforced,
        fencingTokenEnforced: c.fencingTokenEnforced,
        initialState: c.state,
        sim,
      });
      cellMap.set(cell.id, cell);
      vowelMap.set(cell.id, cell);
    } else if (v.kind === "LEASE") {
      const l = v as Lease;
      const Ctor = (l.constructor as any) || Lease;
      const lease = new Ctor({
        id: l.id,
        actorId: l.actorId,
        maxCapacity: l.maxCapacity,
        ttlMs: l.ttlMs,
        overflowPolicy: l.overflowPolicy,
        heldDuringExternalChannel: l.heldDuringExternalChannel,
        sim,
      });
      (lease as any).shedAtThresholdEnabled = (l as any).shedAtThresholdEnabled;
      (lease as any).shedThreshold = (l as any).shedThreshold;
      leaseMap.set(lease.id, lease);
      vowelMap.set(lease.id, lease);
    } else if (v.kind === "LOG") {
      const l = v as Log;
      const Ctor = (l.constructor as any) || Log;
      const log = new Ctor({
        id: l.id,
        actorId: l.actorId,
        maxCapacity: l.maxCapacity,
        compactionLagMs: l.compactionLagMs,
        deduplicateOnCompact: l.deduplicateOnCompact,
        seed,
        sim,
      });
      logMap.set(log.id, log);
      vowelMap.set(log.id, log);
    } else if (v.kind === "CHANNEL") {
      const ch = v as Channel;
      const Ctor = (ch.constructor as any) || Channel;
      const channel = new Ctor({
        id: ch.id,
        sourceActorId: ch.sourceActorId,
        targetActorId: ch.targetActorId,
        timeoutMs: ch.timeoutMs,
        retryPolicy: ch.retryPolicy,
        idempotencyEnabled: (ch as any).idempotencyEnabled,
        budgetUsd: ch.budgetUsd,
        sim,
      });
      channelMap.set(channel.id, channel);
      vowelMap.set(channel.id, channel);
    }
  }

  // Ensure graph.channels are present
  for (const ch of graph.channels) {
    if (!channelMap.has(ch.id)) {
      const Ctor = (ch.constructor as any) || Channel;
      const channel = new Ctor({
        id: ch.id,
        sourceActorId: ch.sourceActorId,
        targetActorId: ch.targetActorId,
        timeoutMs: ch.timeoutMs,
        retryPolicy: ch.retryPolicy,
        idempotencyEnabled: (ch as any).idempotencyEnabled,
        budgetUsd: ch.budgetUsd,
        sim,
      });
      channelMap.set(channel.id, channel);
      vowelMap.set(channel.id, channel);
    }
  }

  // Split faults into non-channel and channel
  const nonChannelFaults = faults.filter((f) => {
    const v = vowelMap.get(f.targetVowelId);
    return v && v.kind !== "CHANNEL";
  });
  const channelFaults = faults.filter((f) => {
    const v = vowelMap.get(f.targetVowelId);
    return !v || v.kind === "CHANNEL";
  });

  // Apply pre-channel vowel faults (e.g., SATURATE on Lease, WIPE on volatile cell, CORRUPT on Log)
  for (const fault of nonChannelFaults) {
    const target = vowelMap.get(fault.targetVowelId);
    if (target) {
      const consonant: Consonant = {
        kind: fault.consonantKind,
        ...(fault.params as any),
      };
      applyConsonant(sim, target, consonant, fault.params, sim.rng);
    }
  }

  // Execute channels in graph order
  const channelsToRun = Array.from(channelMap.values());
  for (const ch of channelsToRun) {
    const targetCell = Array.from(cellMap.values()).find((c) => c.actorId === ch.targetActorId);
    const heldLease = Array.from(leaseMap.values()).find(
      (l) => l.actorId === ch.sourceActorId && l.heldDuringExternalChannel,
    );
    const targetLease = Array.from(leaseMap.values()).find(
      (l) => l.actorId === ch.targetActorId,
    );
    const effectiveIdempotencyEnabled = ch.idempotencyEnabled || targetCell?.idempotencyEnforced === true;

    const chFaults = channelFaults.filter((f) => f.targetVowelId === ch.id);
    const payload = {
      action: `${ch.targetActorId}_call`,
      channelId: ch.id,
      source: ch.sourceActorId,
      target: ch.targetActorId,
      amount: 100,
    };

    const saturationFaultExists = faults.some(
      (fault) => fault.targetVowelId === targetLease?.id && fault.consonantKind === "SATURATE",
    );

    if (targetLease && saturationFaultExists && targetLease.currentLoad >= targetLease.maxCapacity && !(targetLease as any).shedAtThresholdEnabled) {
      sim.emit("channel.cascade_failure", ch.id, {
        channelId: ch.id,
        sourceActorId: ch.sourceActorId,
        targetActorId: ch.targetActorId,
        targetLeaseId: targetLease.id,
        targetLoad: targetLease.currentLoad,
        targetCapacity: targetLease.maxCapacity,
        policy: targetLease.overflowPolicy,
      });
      continue;
    }

    if (chFaults.length > 0) {
      for (const fault of chFaults) {
        const consonant: Consonant = {
          kind: fault.consonantKind,
          ...(fault.params as any),
        };
        const res = applyConsonant(
          sim,
          ch,
          consonant,
          {
            targetCell,
            heldLease,
            payload,
            ...fault.params,
          },
          sim.rng,
        );

        // If fault caused timeout or post-commit divergence, simulate caller retry
        const timeoutOccurred =
          res.details?.callerObservation === "timeout" ||
          (res.details as any)?.channelResult?.callerObservation === "timeout" ||
          (res.details as any)?.timedOut === true ||
          res.details?.phase === "POST_COMMIT" ||
          fault.consonantKind === "SEVER";

        if (timeoutOccurred) {
          sim.emit("channel.retry", ch.id, {
            channelId: ch.id,
            retryAttempt: 1,
            targetActorId: ch.targetActorId,
            payload,
          });

          const retryDedupKey = effectiveIdempotencyEnabled
            ? `sha256(wf+${ch.sourceActorId}+${sha(payload)})`
            : undefined;
          ch.send(sim, payload, targetCell, { dedupKey: retryDedupKey, retryAttempt: 1 });
        }
      }
    } else {
      // Normal channel invocation
      ch.send(sim, payload, targetCell, {
        heldLease,
        dedupKey: effectiveIdempotencyEnabled ? `sha256(wf+${ch.sourceActorId}+${sha(payload)})` : undefined,
      });
    }
  }

  for (const lease of leaseMap.values()) {
    lease.expire(sim.now, sim);
  }

  // Drain virtual clock simulation
  while (sim.step()) {}

  const nativeFindings = auditNative(sim.log, vowelMap);

  // Convert alphabet events to LangChain JSONL
  const jsonl = convertAlphabetEventsToLangChainJsonl(sim.log, cellMap, channelMap);

  let externalFindings: Finding[] = [];
  try {
    const auditor = resolveAuditor();
    const internalTrace = auditor.parseLangChainCallbackJsonl(jsonl);
    externalFindings = auditor.auditTrace(internalTrace);
  } catch (error) {
    if (nativeFindings.length === 0 && process.env.SIM_AUDITOR_REPO) throw error;
  }

  const uniqueFindings = new Map<string, Finding>();
  for (const finding of [...nativeFindings, ...externalFindings]) {
    const spanIds = [...finding.evidence.span_ids].sort();
    uniqueFindings.set(`${finding.rule_id}\u0000${JSON.stringify(spanIds)}`, finding);
  }
  const findings = [...uniqueFindings.values()];

  const provenRuleIds = findings
    .filter((f) => f.status === "proven" && f.severity === "critical")
    .map((f) => f.rule_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const violatedInvariants = Array.from(new Set(provenRuleIds));

  return {
    events: sim.log,
    findings,
    violatedInvariants,
  };
}

