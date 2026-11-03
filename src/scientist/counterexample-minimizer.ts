// src/scientist/counterexample-minimizer.ts

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Trace, Span } from "../trace.ts";
import type { Finding } from "../../../../resilient-agent-invariants/src/types/finding.ts";
import { exportChaosLangChainJsonl } from "../chaos-auditor-adapter.ts";
import type { DiscoveredFailure } from "./types.ts";
import type {
  MinimalCounterexample,
  CounterexampleEvent,
  MinimizerConfig,
} from "./minimizer-types.ts";

const require = createRequire(import.meta.url);

function getAuditorSync(): {
  auditTrace: (trace: any) => Finding[];
  parseLangChainCallbackJsonl: (jsonl: string) => any;
} {
  const envRepo = process.env.SIM_AUDITOR_REPO;
  const here = fileURLToPath(new URL("../../../../", import.meta.url));
  const repoRoot =
    envRepo && envRepo.trim().length > 0
      ? path.resolve(envRepo)
      : path.resolve(here, "resilient-agent-invariants");
  const distRoot = path.join(repoRoot, "dist", "src");

  const auditPath = path.join(distRoot, "rules", "audit-trace.js");
  const adapterPath = path.join(
    distRoot,
    "adapters",
    "langchain-callback-jsonl.js",
  );

  const { auditTrace } = require(auditPath);
  const { parseLangChainCallbackJsonl } = require(adapterPath);
  return { auditTrace, parseLangChainCallbackJsonl };
}

function matchesInvariant(actual: string, expected: string): boolean {
  const actualId = actual.toLowerCase();
  const expectedId = expected.toLowerCase();
  return actualId === expectedId || actualId.startsWith(expectedId.slice(0, 3));
}

// Delta-debugging: remove subsets of events and check if the
// invariant still fires. If yes, keep the removal. If no,
// restore. Repeat until no more events can be removed.

export function minimizeCounterexample(
  failure: DiscoveredFailure,
  config: MinimizerConfig = { maxReductionRounds: 10, targetEventCount: 5 },
): MinimalCounterexample {
  const trace = failure.experiment.trace;
  const invariant = failure.hypothesis.expectedInvariant;
  const originalSpans = trace.spans || [];

  // Start with all spans that are relevant to the finding
  const findingSpanIds = new Set<string>();
  for (const finding of failure.experiment.provenFindings) {
    if (matchesInvariant(finding.rule_id, invariant)) {
      for (const spanId of finding.evidence.span_ids || []) {
        findingSpanIds.add(spanId);
      }
    }
  }

  // Get the spans that are directly cited in the finding
  // evidence, plus their causal parents (walk parentSpanId chain)
  let workingSpans = extractRelevantSpans(originalSpans, findingSpanIds);

  const originalEventCount = workingSpans.length;

  // Delta-debugging: try removing subsets of events
  for (let round = 0; round < config.maxReductionRounds; round++) {
    if (workingSpans.length <= config.targetEventCount) break;

    const reduced = reduceOnce(workingSpans, trace, invariant);
    if (reduced.length < workingSpans.length) {
      workingSpans = reduced;
    } else {
      break; // can't reduce further
    }
  }

  const events = spansToEvents(workingSpans, originalSpans);

  return {
    failureId: failure.id,
    events,
    originalEventCount,
    minimizedEventCount: events.length,
    invariant,
    stillViolates: checkInvariantFires(workingSpans, trace, invariant),
  };
}

function extractRelevantSpans(
  allSpans: Span[],
  findingSpanIds: Set<string>,
): Span[] {
  if (findingSpanIds.size === 0) {
    // If no specific spans cited, use payment.attempt +
    // db.write + worker.exit spans (the ones that matter for R04/R05)
    return allSpans.filter(
      (s) =>
        s.name === "payment.attempt" ||
        s.name === "db.write" ||
        s.name === "worker.exit" ||
        s.name === "process.main_host.crashed" ||
        s.name === "saga.compensation",
    );
  }

  const relevant = new Map<string, Span>();
  const byId = new Map(allSpans.map((s) => [s.spanId, s]));

  // Add cited spans + walk parent chain
  for (const spanId of findingSpanIds) {
    let current = byId.get(spanId);
    while (current) {
      relevant.set(current.spanId, current);
      current = current.parentSpanId
        ? byId.get(current.parentSpanId)
        : undefined;
    }
  }

  const orderMap = new Map(allSpans.map((s, idx) => [s.spanId, idx]));
  return Array.from(relevant.values()).sort(
    (a, b) => (orderMap.get(a.spanId) ?? 0) - (orderMap.get(b.spanId) ?? 0),
  );
}

function reduceOnce(
  spans: Span[],
  fullTrace: Trace,
  invariant: string,
): Span[] {
  // Try binary / block splits if large
  if (spans.length > 8) {
    const half = Math.floor(spans.length / 2);
    const firstHalf = spans.slice(0, half);
    if (checkInvariantFires(firstHalf, fullTrace, invariant)) {
      return firstHalf;
    }
    const secondHalf = spans.slice(half);
    if (checkInvariantFires(secondHalf, fullTrace, invariant)) {
      return secondHalf;
    }
  }

  // Try removing each span and check if invariant still fires
  for (let i = 0; i < spans.length; i++) {
    const reduced = spans.filter((_, idx) => idx !== i);
    if (checkInvariantFires(reduced, fullTrace, invariant)) {
      return reduced; // can remove this span
    }
  }

  // Try removing pairs
  if (spans.length <= 20) {
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        const reduced = spans.filter((_, idx) => idx !== i && idx !== j);
        if (checkInvariantFires(reduced, fullTrace, invariant)) {
          return reduced;
        }
      }
    }
  }

  return spans; // can't reduce
}

function checkInvariantFires(
  spans: Span[],
  fullTrace: Trace,
  invariant: string,
): boolean {
  // Build a reduced trace with just these spans
  const reducedTrace: Trace = {
    ...fullTrace,
    spans,
  };

  try {
    const jsonl = exportChaosLangChainJsonl(reducedTrace);
    const auditor = getAuditorSync();
    const internal = auditor.parseLangChainCallbackJsonl(jsonl);
    const findings: Finding[] = auditor.auditTrace(internal);
    return findings.some(
      (f) => matchesInvariant(f.rule_id, invariant) && f.status === "proven",
    );
  } catch {
    return false;
  }
}

function spansToEvents(
  spans: Span[],
  originalSpans: Span[],
): CounterexampleEvent[] {
  return spans.map((span) => {
    const originalIndex = originalSpans.findIndex(
      (s) => s.spanId === span.spanId,
    );
    return {
      index: originalIndex >= 0 ? originalIndex : 0,
      spanId: span.spanId,
      name: span.name,
      timestamp: span.startMs,
      attrs: span.attrs,
      description: describeEvent(span),
    };
  });
}

function describeEvent(span: Span): string {
  const attrs = (span.attrs || {}) as Record<string, unknown>;
  switch (span.name) {
    case "payment.attempt": {
      const key = attrs.idempotency_key;
      const retry = attrs.retry_count;
      if (key === null || key === undefined) {
        return `Payment request sent (no idempotency key)${
          retry ? `, retry #${retry}` : ""
        }`;
      }
      return `Payment request sent (key: ${String(key).slice(0, 12)}...)${
        retry ? `, retry #${retry}` : ""
      }`;
    }
    case "db.write":
      return `Database write (${attrs.table || "unknown"}.${
        attrs.op || "unknown"
      })`;
    case "worker.exit":
      return `Worker process exited (${attrs.reason || "unknown"})`;
    case "process.main_host.crashed":
      return `Host process CRASHED`;
    case "saga.compensation":
      return `Saga compensation (${attrs.compensation_for || "unknown"})`;
    default:
      return `${span.name}`;
  }
}

