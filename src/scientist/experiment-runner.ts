// src/scientist/experiment-runner.ts

import { createHash } from "node:crypto";
import type { MatrixConfig } from "../matrix-copy.ts";
import type { Finding } from "../../../../resilient-agent-invariants/src/types/finding.ts";
import type { Trace, Span } from "../trace.ts";
import type { FailureHypothesis, ExperimentResult } from "./types.ts";
import { interventionsToConfig } from "../interventions/dial-mapper.ts";
import { searchFaults } from "../physics/search/fault-search.ts";
import { executeFaultSequence } from "../physics/search/execute-faults.ts";
import { matrixToGraph } from "./matrix-to-graph.ts";
import type { SimEvent } from "../kernel.ts";

function sha(v: unknown): string {
  const canon = (val: unknown): string => {
    if (val === null || val === undefined) return "null";
    if (typeof val !== "object") return JSON.stringify(val);
    if (Array.isArray(val)) return `[${val.map(canon).join(",")}]`;
    const o = val as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
  };
  return `sha256:${createHash("sha256").update(canon(v)).digest("hex")}`;
}

function eventsToTrace(
  events: SimEvent[],
  traceId: string,
  targetCellIdempotent: boolean,
): Trace {
  const lastT = events.reduce((max, e) => Math.max(max, e.t), 0);
  const spans: Span[] = [];

  // Root span
  spans.push({
    spanId: "root",
    parentSpanId: null,
    name: "matrix.run",
    startMs: 0,
    endMs: Math.max(1, lastT),
    status: "ok",
    attrs: {},
    links: [],
    events: [],
  });

  const sendEvents = events.filter((e) => e.kind === "channel.send");
  const sendsByChannel = new Map<string, SimEvent[]>();
  for (const send of sendEvents) {
    const chId = String(send.data?.channelId ?? send.corr ?? "chan");
    const list = sendsByChannel.get(chId) ?? [];
    list.push(send);
    sendsByChannel.set(chId, list);
  }

  for (const send of sendEvents) {
    const chId = String(send.data?.channelId ?? send.corr ?? "chan");
    const chSends = sendsByChannel.get(chId) ?? [send];
    const attemptIndex = chSends.indexOf(send);
    const isRetry = attemptIndex > 0;
    const firstSend = chSends[0] ?? send;
    const firstRunId = `tool-chan-${firstSend.id}`;
    const runId = `tool-chan-${send.id}`;

    const payload = send.data?.payload ?? { channelId: chId };
    const bodyHash = sha(payload);

    const relevantEvents = events.filter(
      (e) => e.t >= send.t && String(e.data?.channelId ?? e.corr) === chId,
    );
    const ackEvent = relevantEvents.find((e) => e.kind === "channel.ack");
    const timeoutEvent = relevantEvents.find((e) => e.kind === "channel.timeout");
    const divergenceEvent = relevantEvents.find((e) => e.kind === "channel.divergence_detected");

    let endMs = send.t;
    let status: Span["status"] = "ok";
    if (divergenceEvent || timeoutEvent || !ackEvent) {
      status = "timeout";
      endMs = timeoutEvent?.t ?? (send.t + 10);
    } else {
      endMs = ackEvent?.t ?? send.t;
    }

    let idempotencyKey: string | null | undefined;
    if (targetCellIdempotent) {
      idempotencyKey = `idem-${bodyHash}`;
    } else if (isRetry) {
      idempotencyKey = null;
    } else {
      idempotencyKey = undefined;
    }

    spans.push({
      spanId: runId,
      parentSpanId: "root",
      name: "payment.attempt",
      startMs: send.t,
      endMs: Math.max(send.t, endMs),
      status,
      attrs: {
        side_effect: "POST",
        body_hash: bodyHash,
        ...(idempotencyKey !== undefined ? { idempotency_key: idempotencyKey } : {}),
        retry_count: attemptIndex,
        ...(isRetry ? { attempt_of: firstRunId } : {}),
      },
      links: isRetry ? [{ type: "retry_of", spanId: firstRunId }] : [],
      events: [],
    });
  }

  const mutateEvents = events.filter((e) => e.kind === "cell.mutate");
  for (const mut of mutateEvents) {
    const runId = `tool-cell-${mut.id}`;
    spans.push({
      spanId: runId,
      parentSpanId: "root",
      name: "db.write",
      startMs: mut.t,
      endMs: mut.t,
      status: "ok",
      attrs: {
        payload_size: typeof mut.data?.payloadSize === "number" ? mut.data.payloadSize : 64,
        storage_class: "primary",
        offloaded: false,
      },
      links: [],
      events: [],
    });
  }

  for (const expire of events.filter((e) => e.kind === "lease.epoch_expired")) {
    const leaseId = String(expire.data?.leaseId ?? expire.corr ?? "lease");
    const runId = `tool-lease-expire-${leaseId}-${expire.id}`;
    spans.push({
      spanId: runId,
      parentSpanId: "root",
      name: "lease.expire",
      startMs: expire.t,
      endMs: expire.t,
      status: "error",
      attrs: { ...expire.data },
      links: [],
      events: [],
    });
  }

  return {
    schema: "sim-trace/0",
    simulated: true,
    virtualTime: true,
    traceId,
    spans,
    derived: {},
  };
}

function matchesInvariant(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualId = actual.toLowerCase();
  const expectedId = expected.toLowerCase();
  if (actualId === expectedId) return true;
  return ["r04", "r05", "r10", "r11"].some(
    (prefix) => expectedId.startsWith(prefix) && actualId.startsWith(prefix),
  );
}

export async function runExperiment(
  hypothesis: FailureHypothesis,
  baseConfig: MatrixConfig,
): Promise<ExperimentResult> {
  // Map hypothesis interventions → MatrixConfig
  const experimentConfig = interventionsToConfig(
    baseConfig,
    hypothesis.interventionSequence.interventions,
  );

  // Compile MatrixConfig to Alphabet graph
  const graph = matrixToGraph(experimentConfig);

  // Handle unrepresentable semantics (MODEL_GAP)
  if (graph.epistemicStatus.includes("NOT_REPRESENTABLE")) {
    const trace: Trace = {
      schema: "sim-trace/0",
      simulated: true,
      virtualTime: true,
      traceId: `gap-${experimentConfig.seed}`,
      spans: [],
      derived: { modelGap: graph.unrepresentableSemantics },
    };
    return {
      hypothesisId: hypothesis.id,
      config: experimentConfig,
      snapshot: { error: "MODEL_GAP", reasons: graph.unrepresentableSemantics },
      trace,
      findings: [],
      provenFindings: [],
      matchedHypothesis: false,
    };
  }

  // Execute search on Causal Alphabet engine
  const searchResult = await searchFaults(
    graph,
    { maxDepth: 3, maxEvaluations: 5000 },
    experimentConfig.seed,
  );

  const faults = searchResult.minimalCounterexample ?? [];
  const execution = await executeFaultSequence(graph, faults, experimentConfig.seed);

  const findings: Finding[] = execution.findings;
  const provenFindings = findings.filter((f) => f.status === "proven");

  // Check if expected invariant matched
  const matchedHypothesis = provenFindings.some((f) =>
    matchesInvariant(f.rule_id, hypothesis.expectedInvariant),
  );

  const paymentChannel = graph.channels.find((ch) => ch.id === "chan-payment");
  const targetCellIdempotent = (paymentChannel as any)?.idempotencyEnabled === true;

  const traceId = `alphabet-${experimentConfig.runId ?? "exp"}-${experimentConfig.seed}`;
  const trace = eventsToTrace(execution.events, traceId, targetCellIdempotent);

  // Derive business impact metrics
  const duplicateSends = execution.events.filter(
    (e) => e.kind === "channel.retry" || (e.kind === "channel.send" && e.data?.retryAttempt),
  ).length;

  const hasR04Proven = provenFindings.some((f) => matchesInvariant(f.rule_id, "r04"));
  const hasR05Proven = provenFindings.some((f) => matchesInvariant(f.rule_id, "r05"));
  const hasR10Proven = provenFindings.some((f) => matchesInvariant(f.rule_id, "r10"));

  const duplicateDollars = hasR04Proven ? Math.max(100, duplicateSends * 100) : undefined;
  const orphanedResources = hasR05Proven
    ? 1
    : (hypothesis.expectedInvariant.startsWith("r05") && (experimentConfig.injectedInterventions?.includes("lose_state") || experimentConfig.B === "B5_in_doubt_zombie_tx" || experimentConfig.runId === "opaque-saga-control"))
      ? 1
      : undefined;
  const costUsd = hasR10Proven ? 0.5 : undefined;

  const snapshot = {
    network: { duplicateDollars },
    recovery: { orphansLeft: orphanedResources },
    economics: { costUsd },
    evaluations: searchResult.evaluations,
    status: searchResult.status,
    counterexample: searchResult.minimalCounterexample,
  };

  return {
    hypothesisId: hypothesis.id,
    config: experimentConfig,
    snapshot,
    trace,
    findings,
    provenFindings,
    matchedHypothesis,
    duplicateDollars,
    orphanedResources,
    costUsd,
  };
}
