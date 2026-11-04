import test from "node:test";
import assert from "node:assert/strict";

import type { Finding } from "../src/physics/alphabet/invariants/finding.ts";
import { auditNative } from "../src/physics/alphabet/invariants/native-auditor.ts";
import { Channel } from "../src/physics/alphabet/vowels/channel.ts";
import { Cell } from "../src/physics/alphabet/vowels/cell.ts";
import { Lease } from "../src/physics/alphabet/vowels/lease.ts";
import type { CompiledAlphabetGraph, Vowel } from "../src/physics/alphabet/types.ts";
import { executeFaultSequence, type FaultExecutionResult } from "../src/physics/search/execute-faults.ts";
import type { ConsonantFault } from "../src/physics/search/search-types.ts";

function graph(vowels: Vowel[], channels: Channel[] = []): CompiledAlphabetGraph {
  const actorIds = [...new Set(vowels.map((vowel) => vowel.actorId).concat(channels.flatMap((channel) => [channel.sourceActorId, channel.targetActorId])))];
  return {
    actors: actorIds.map((id) => ({ id, name: id })),
    vowels,
    channels,
    contracts: [],
    candidatePerturbations: [],
    epistemicStatus: ["OBSERVED"],
    unrepresentableSemantics: [],
  };
}

function nativeFindings(result: FaultExecutionResult, ruleId: string): Finding[] {
  return result.findings.filter((finding) => finding.rule_id === ruleId);
}

function leaseGraph(options: {
  id?: string;
  actorId?: string;
  capacity?: number;
  ttlMs?: number;
  overflowPolicy?: "WAIT_TIMEOUT" | "REJECT_429" | "PANIC_CRASH";
  heldDuringExternalChannel?: boolean;
} = {}): { graph: CompiledAlphabetGraph; lease: Lease } {
  const actorId = options.actorId ?? "actor-lease";
  const lease = new Lease({
    id: options.id ?? "lease-test",
    actorId,
    maxCapacity: options.capacity ?? 50,
    ttlMs: options.ttlMs ?? 5000,
    overflowPolicy: options.overflowPolicy ?? "PANIC_CRASH",
    heldDuringExternalChannel: options.heldDuringExternalChannel,
  });
  return { graph: graph([lease]), lease };
}

test("A. native Finding has the external auditor's shape", () => {
  const finding: Finding = {
    rule_id: "native-test",
    pillar: "capacity",
    status: "proven",
    severity: "critical",
    message: "Observed event evidence.",
    evidence: { span_ids: ["e1"], details: { observed: true } },
    repro: "Emit the event.",
    suggested_fix: "Address the observed condition.",
  };
  assert.deepEqual(Object.keys(finding).sort(), [
    "evidence", "message", "pillar", "repro", "rule_id", "severity", "status", "suggested_fix",
  ]);
});

test("B. panic crash event creates a proven native finding", async () => {
  const { graph: testGraph, lease } = leaseGraph({ capacity: 50, overflowPolicy: "PANIC_CRASH" });
  const fault: ConsonantFault = {
    consonantKind: "SATURATE",
    targetVowelId: lease.id,
    params: { loadUnits: 70 },
  };
  const result = await executeFaultSequence(testGraph, [fault], 42);
  const findings = nativeFindings(result, "native-lease-capacity-overflow");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.status, "proven");
  assert.ok(result.events.some((event) => findings[0]?.evidence.span_ids.includes(event.id) && event.kind === "lease.panic_crash"));
});

test("C. panic-crash policy alone creates no native finding", async () => {
  const { graph: testGraph } = leaseGraph({ capacity: 50, overflowPolicy: "PANIC_CRASH" });
  const result = await executeFaultSequence(testGraph, [], 42);
  assert.equal(nativeFindings(result, "native-lease-capacity-overflow").length, 0);
});

test("D. delayed channel beyond held lease TTL proves epoch expiry", async () => {
  const lease = new Lease({
    id: "lease-source",
    actorId: "actor-client",
    maxCapacity: 1,
    ttlMs: 5000,
    overflowPolicy: "WAIT_TIMEOUT",
    heldDuringExternalChannel: true,
  });
  const channel = new Channel({
    id: "channel-delayed",
    sourceActorId: "actor-client",
    targetActorId: "actor-service",
    timeoutMs: 20000,
  });
  const testGraph = graph([lease, channel], [channel]);
  const fault: ConsonantFault = {
    consonantKind: "DELAY",
    targetVowelId: channel.id,
    params: { durationMs: 10000 },
  };
  const result = await executeFaultSequence(testGraph, [fault], 42);
  const findings = nativeFindings(result, "native-lease-epoch-expiry");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.status, "proven");
  assert.ok(result.events.some((event) => findings[0]?.evidence.span_ids.includes(event.id) && event.kind === "lease.epoch_expired"));
});

test("E. held lease without an over-TTL delay creates no epoch-expiry finding", async () => {
  const lease = new Lease({
    id: "lease-source",
    actorId: "actor-client",
    maxCapacity: 1,
    ttlMs: 5000,
    overflowPolicy: "WAIT_TIMEOUT",
    heldDuringExternalChannel: true,
  });
  const channel = new Channel({
    id: "channel-undelayed",
    sourceActorId: "actor-client",
    targetActorId: "actor-service",
    timeoutMs: 100,
  });
  const result = await executeFaultSequence(graph([lease, channel], [channel]), [], 42);
  assert.equal(nativeFindings(result, "native-lease-epoch-expiry").length, 0);
});

test("F. saturated target lease produces native cascade evidence", async () => {
  const lease = new Lease({
    id: "lease-metadata",
    actorId: "actor-metadata",
    maxCapacity: 1,
    ttlMs: 5000,
    overflowPolicy: "REJECT_429",
  });
  const channel = new Channel({
    id: "channel-metadata",
    sourceActorId: "actor-svc-a",
    targetActorId: "actor-metadata",
    timeoutMs: 100,
  });
  const testGraph = graph([lease, channel], [channel]);
  const result = await executeFaultSequence(testGraph, [{
    consonantKind: "SATURATE",
    targetVowelId: lease.id,
    params: { loadUnits: 5 },
  }], 42);
  const findings = nativeFindings(result, "native-channel-cascade");
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.status, "proven");
  assert.ok(result.events.some((event) => findings[0]?.evidence.span_ids.includes(event.id) && event.kind === "channel.cascade_failure"));
});

test("G. unsaturated target lease creates no cascade finding", async () => {
  const lease = new Lease({
    id: "lease-metadata",
    actorId: "actor-metadata",
    maxCapacity: 1,
    ttlMs: 5000,
    overflowPolicy: "REJECT_429",
  });
  const channel = new Channel({
    id: "channel-metadata",
    sourceActorId: "actor-svc-a",
    targetActorId: "actor-metadata",
    timeoutMs: 100,
  });
  const result = await executeFaultSequence(graph([lease, channel], [channel]), [], 42);
  assert.equal(nativeFindings(result, "native-channel-cascade").length, 0);
});

test("REJECT_429 remains warning evidence, not a blocking invariant", async () => {
  const { graph: testGraph, lease } = leaseGraph({
    capacity: 1,
    overflowPolicy: "REJECT_429",
  });
  const result = await executeFaultSequence(testGraph, [{
    consonantKind: "SATURATE",
    targetVowelId: lease.id,
    params: { loadUnits: 2 },
  }], 42);
  const finding = nativeFindings(result, "native-lease-rejected")[0];
  assert.equal(finding?.severity, "warning");
  assert.equal(finding?.status, "proven");
  assert.ok(!result.violatedInvariants.includes("native-lease-rejected"));
});

test("cost burn is not reported when no channel budget is declared", async () => {
  const channel = new Channel({
    id: "channel-unbudgeted",
    sourceActorId: "actor-trader",
    targetActorId: "actor-broker",
    timeoutMs: 20,
  });
  const result = await executeFaultSequence(graph([channel], [channel]), [{
    consonantKind: "DUPLICATE",
    targetVowelId: channel.id,
    params: { count: 20 },
  }], 42);
  assert.equal(result.events.filter((event) => event.kind === "cost.burn_exceeded").length, 0);
  assert.equal(nativeFindings(result, "native-cost-burn").length, 0);
});

test("declared channel budget produces native cost-burn finding when duplicate sends exceed it", async () => {
  const channel = new Channel({
    id: "channel-budgeted",
    sourceActorId: "actor-trader",
    targetActorId: "actor-broker",
    timeoutMs: 20,
    budgetUsd: 10,
  });
  const result = await executeFaultSequence(graph([channel], [channel]), [{
    consonantKind: "DUPLICATE",
    targetVowelId: channel.id,
    params: { count: 11 },
  }], 42);
  const events = result.events.filter((event) => event.kind === "cost.burn_exceeded");
  const findings = nativeFindings(result, "native-cost-burn");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.data.threshold, 1000);
  assert.equal(events[0]?.data.totalCost, 1100);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.status, "proven");
  assert.ok(result.violatedInvariants.includes("native-cost-burn"));
});

test("H. native findings survive an unavailable external auditor", async () => {
  const { graph: testGraph, lease } = leaseGraph({ capacity: 1, overflowPolicy: "PANIC_CRASH" });
  const fault: ConsonantFault = {
    consonantKind: "SATURATE",
    targetVowelId: lease.id,
    params: { loadUnits: 2 },
  };
  const previous = process.env.SIM_AUDITOR_REPO;
  process.env.SIM_AUDITOR_REPO = "Z:/missing-resilient-agent-invariants";
  try {
    const result = await executeFaultSequence(testGraph, [fault], 42);
    assert.equal(nativeFindings(result, "native-lease-capacity-overflow").length, 1);
    assert.ok(result.violatedInvariants.includes("native-lease-capacity-overflow"));
  } finally {
    if (previous === undefined) delete process.env.SIM_AUDITOR_REPO;
    else process.env.SIM_AUDITOR_REPO = previous;
  }
});

test("native-network-idempotency fires for retry without dedup key when external auditor is unavailable", async () => {
  const channel = new Channel({
    id: "channel-retry-without-key",
    sourceActorId: "actor-client",
    targetActorId: "actor-service",
    timeoutMs: 50,
    idempotencyEnabled: false,
  });
  const result = await executeFaultSequence(graph([channel], [channel]), [{
    consonantKind: "SEVER",
    targetVowelId: channel.id,
    params: { phase: "POST_COMMIT" },
  }], 42);

  const finding = nativeFindings(result, "native-network-idempotency")[0];
  assert.ok(finding, "expected a native network idempotency finding");
  assert.equal(finding.status, "proven");
  assert.equal(finding.severity, "critical");
  assert.ok(result.events.some((event) => event.kind === "channel.retry"));
  assert.ok(result.events.some((event) => event.kind === "channel.send"));
  assert.ok(finding.evidence.span_ids.length >= 2);
});

test("I. native and external findings merge without duplicate rule/span pairs", async () => {
  const overflowLease = new Lease({
    id: "lease-overflow",
    actorId: "actor-overflow",
    maxCapacity: 1,
    ttlMs: 5000,
    overflowPolicy: "PANIC_CRASH",
  });
  const paymentCell = new Cell({
    id: "cell-payment",
    actorId: "actor-payment",
    persistence: "DURABLE",
    idempotencyEnforced: false,
    fencingTokenEnforced: false,
  });
  const channel = new Channel({
    id: "channel-payment",
    sourceActorId: "actor-client",
    targetActorId: "actor-payment",
    timeoutMs: 50,
  });
  const testGraph = graph([overflowLease, paymentCell, channel], [channel]);
  const faults: ConsonantFault[] = [
    { consonantKind: "SATURATE", targetVowelId: overflowLease.id, params: { loadUnits: 2 } },
    { consonantKind: "SEVER", targetVowelId: channel.id, params: { phase: "POST_COMMIT" } },
  ];
  const result = await executeFaultSequence(testGraph, faults, 42);
  assert.ok(result.findings.some((finding) => finding.rule_id === "native-lease-capacity-overflow"));
  assert.ok(result.findings.some((finding) => finding.rule_id === "r04-network-idempotency"));
  const pairKeys = result.findings.map((finding) => `${finding.rule_id}\u0000${[...finding.evidence.span_ids].sort().join(",")}`);
  assert.equal(new Set(pairKeys).size, pairKeys.length);
});

test("each native rule is silent unless its matching event exists", () => {
  const lease = new Lease({
    id: "lease-negative",
    actorId: "actor-negative",
    maxCapacity: 10,
    ttlMs: 1000,
    overflowPolicy: "PANIC_CRASH",
  });
  assert.deepEqual(auditNative([], new Map([[lease.id, lease]])), []);
});
