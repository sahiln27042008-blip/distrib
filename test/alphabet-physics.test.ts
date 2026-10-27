// enterpriseee/enterprise-simulator/test/alphabet-physics.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Sim, Rng } from "../src/kernel.ts";
import {
  Cell,
  Log,
  Lease,
  Channel,
  applyDelay,
  applySever,
  applyDuplicate,
  applySaturate,
  applyWipe,
  applyCorrupt,
  applyConsonant,
  AlphabetCompiler,
} from "../src/physics/alphabet/index.ts";

describe("Layer 1 — Primitive Semantics", () => {
  it("CELL mutation increments mutationCount", () => {
    const sim = new Sim(42);
    const cell = new Cell({
      id: "cell-account-balance",
      actorId: "actor-bank",
      persistence: "DURABLE",
      idempotencyEnforced: false,
      fencingTokenEnforced: false,
      initialState: 100,
      sim,
    });

    const res1 = cell.mutate(150);
    assert.equal(res1.ok, true);
    assert.equal(res1.mutationCount, 1);
    assert.equal(cell.state, 150);

    const res2 = cell.mutate(200);
    assert.equal(res2.ok, true);
    assert.equal(res2.mutationCount, 2);
    assert.equal(cell.state, 200);
    assert.ok(sim.log.some((e) => e.kind === "cell.mutate"));
  });

  it("CELL idempotency rejects duplicate logical mutation", () => {
    const sim = new Sim(42);
    const cell = new Cell({
      id: "cell-order",
      actorId: "actor-store",
      persistence: "DURABLE",
      idempotencyEnforced: true,
      fencingTokenEnforced: false,
      sim,
    });

    const first = cell.mutate({ orderId: "ord-1", amount: 50 }, { dedupKey: "key-1" });
    assert.equal(first.ok, true);
    assert.equal(first.mutationCount, 1);

    const second = cell.mutate({ orderId: "ord-1", amount: 50 }, { dedupKey: "key-1" });
    assert.equal(second.ok, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.mutationCount, 1); // Not incremented
    assert.ok(sim.log.some((e) => e.kind === "cell.duplicate_detected"));
  });

  it("CELL fencing rejects stale epoch write", () => {
    const sim = new Sim(42);
    const cell = new Cell({
      id: "cell-leader",
      actorId: "actor-coordinator",
      persistence: "DURABLE",
      idempotencyEnforced: false,
      fencingTokenEnforced: true,
      sim,
    });

    cell.epoch = 2; // Advanced epoch

    const staleWrite = cell.mutate("stale data", { epoch: 1 });
    assert.equal(staleWrite.ok, false);
    assert.equal(staleWrite.staleEpoch, true);
    assert.equal(staleWrite.mutationCount, 0);
    assert.ok(sim.log.some((e) => e.kind === "cell.stale_write_rejected"));

    const currentWrite = cell.mutate("fresh data", { epoch: 2 });
    assert.equal(currentWrite.ok, true);
    assert.equal(currentWrite.mutationCount, 1);
  });

  it("LOG append adds entries", () => {
    const sim = new Sim(42);
    const log = new Log({
      id: "log-events",
      actorId: "actor-producer",
      maxCapacity: 10,
      compactionLagMs: 0,
      deduplicateOnCompact: false,
      sim,
    });

    const r1 = log.append("event A");
    const r2 = log.append("event B");
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(log.entries.length, 2);
    assert.deepEqual(log.read(), ["event A", "event B"]);
    assert.ok(sim.log.some((e) => e.kind === "log.append"));
  });

  it("LOG compaction moves entries older than lag", () => {
    const sim = new Sim(42);
    const log = new Log({
      id: "log-wal",
      actorId: "actor-db",
      maxCapacity: 10,
      compactionLagMs: 50,
      deduplicateOnCompact: false,
      sim,
    });

    log.append("e1"); // t = 0
    sim.now = 30;
    log.append("e2"); // t = 30
    sim.now = 60;
    log.append("e3"); // t = 60

    // Compact at t = 60. Cutoff = 60 - 50 = 10. Only e1 (t=0) is compacted.
    const res = log.compact(60);
    assert.equal(res.compactedCount, 1);
    assert.equal(log.compactedView.length, 1);
    assert.deepEqual(log.compactedView, ["e1"]);
    assert.ok(sim.log.some((e) => e.kind === "log.compact"));
  });

  it("LOG deduplication by dedupKey on compact", () => {
    const sim = new Sim(42);
    const log = new Log({
      id: "log-dedup",
      actorId: "actor-queue",
      maxCapacity: 10,
      compactionLagMs: 0,
      deduplicateOnCompact: true,
      sim,
    });

    log.append("item 1", "key-A");
    log.append("item 1 duplicate", "key-A");
    log.append("item 2", "key-B");

    const compactRes = log.compact(sim.now);
    assert.equal(compactRes.compactedCount, 2);
    assert.equal(compactRes.deduplicatedCount, 1);
    assert.deepEqual(log.compactedView, ["item 1", "item 2"]);
    assert.ok(sim.log.some((e) => e.kind === "log.dedup"));
  });

  it("LEASE capacity enforcement", () => {
    const sim = new Sim(42);
    const lease = new Lease({
      id: "lease-pool",
      actorId: "actor-db",
      maxCapacity: 2,
      ttlMs: 100,
      overflowPolicy: "REJECT_429",
      sim,
    });

    const acq1 = lease.acquire("client-1", 0);
    const acq2 = lease.acquire("client-2", 0);
    assert.equal(acq1.ok, true);
    assert.equal(acq2.ok, true);

    const acq3 = lease.acquire("client-3", 0);
    assert.equal(acq3.ok, false);
    assert.equal(acq3.rejected, true);
    assert.ok(sim.log.some((e) => e.kind === "lease.rejected"));
  });

  it("LEASE expiry increments epoch", () => {
    const sim = new Sim(42);
    const lease = new Lease({
      id: "lease-lock",
      actorId: "actor-leader",
      maxCapacity: 1,
      ttlMs: 50,
      overflowPolicy: "WAIT_TIMEOUT",
      sim,
    });

    lease.acquire("leader-A", 0);
    assert.equal(lease.currentEpoch, 0);

    // Advance past TTL (50ms)
    lease.expire(60);
    assert.equal(lease.currentLoad, 0);
    assert.equal(lease.currentEpoch, 1);
    assert.ok(sim.log.some((e) => e.kind === "lease.epoch_expired"));
  });

  it("CHANNEL 5-phase state machine", () => {
    const sim = new Sim(42);
    const cell = new Cell({
      id: "cell-target",
      actorId: "actor-b",
      persistence: "DURABLE",
      idempotencyEnforced: false,
      fencingTokenEnforced: false,
      sim,
    });
    const channel = new Channel({
      id: "chan-ab",
      sourceActorId: "actor-a",
      targetActorId: "actor-b",
      timeoutMs: 100,
      sim,
    });

    const res = channel.send(sim, { data: "hello" }, cell);
    assert.equal(res.callerObservation, "ok");
    assert.equal(res.targetCommitted, true);
    assert.equal(res.ackReceived, true);

    const kinds = sim.log.map((e) => e.kind);
    assert.ok(kinds.includes("channel.send"));
    assert.ok(kinds.includes("channel.receive"));
    assert.ok(kinds.includes("channel.mutate"));
    assert.ok(kinds.includes("channel.ack"));
    assert.ok(kinds.includes("channel.caller_observation"));
  });

  it("CHANNEL timeout when delay > timeoutMs", () => {
    const sim = new Sim(42);
    const cell = new Cell({
      id: "cell-target-timeout",
      actorId: "actor-b",
      persistence: "DURABLE",
      idempotencyEnforced: false,
      fencingTokenEnforced: false,
      sim,
    });
    const channel = new Channel({
      id: "chan-timeout",
      sourceActorId: "actor-a",
      targetActorId: "actor-b",
      timeoutMs: 50,
      sim,
    });

    const res = channel.send(sim, { val: "slow" }, cell, { delayMs: 100 });
    assert.equal(res.callerObservation, "timeout");
    assert.equal(res.targetCommitted, true); // Target continues!
    assert.ok(sim.log.some((e) => e.kind === "channel.timeout"));
  });

  it("DELAY on CHANNEL", () => {
    const sim = new Sim(42);
    const channel = new Channel({
      id: "chan-delayed",
      sourceActorId: "actor-a",
      targetActorId: "actor-b",
      timeoutMs: 200,
      sim,
    });

    const res = applyDelay(sim, channel, { durationMs: 100 });
    assert.equal(res.ok, true);
    assert.ok(sim.log.some((e) => e.kind === "consonant.delay.start"));
    assert.ok(sim.log.some((e) => e.kind === "consonant.delay.complete"));
  });

  it("SEVER PRE_COMMIT — target never receives", () => {
    const sim = new Sim(42);
    const cell = new Cell({
      id: "cell-sever-target",
      actorId: "actor-b",
      persistence: "DURABLE",
      idempotencyEnforced: false,
      fencingTokenEnforced: false,
      sim,
    });
    const channel = new Channel({
      id: "chan-pre-sever",
      sourceActorId: "actor-a",
      targetActorId: "actor-b",
      timeoutMs: 50,
      sim,
    });

    const res = applySever(sim, channel, { phase: "PRE_COMMIT", targetCell: cell });
    assert.equal(res.ok, true);
    assert.equal(cell.mutationCount, 0);
    assert.ok(sim.log.some((e) => e.kind === "consonant.sever.pre_commit"));
  });

  it("SEVER POST_COMMIT — divergence detected", () => {
    const sim = new Sim(42);
    const cell = new Cell({
      id: "cell-post-sever",
      actorId: "actor-b",
      persistence: "DURABLE",
      idempotencyEnforced: false,
      fencingTokenEnforced: false,
      sim,
    });
    const channel = new Channel({
      id: "chan-post-sever",
      sourceActorId: "actor-a",
      targetActorId: "actor-b",
      timeoutMs: 50,
      sim,
    });

    const res = applySever(sim, channel, { phase: "POST_COMMIT", targetCell: cell });
    assert.equal(res.ok, true);
    assert.equal(cell.mutationCount, 1); // Target committed
    assert.ok(sim.log.some((e) => e.kind === "channel.divergence_detected"));
  });

  it("DUPLICATE on CHANNEL without idempotency → duplicate mutation", () => {
    const sim = new Sim(42);
    const cell = new Cell({
      id: "cell-no-idem",
      actorId: "actor-b",
      persistence: "DURABLE",
      idempotencyEnforced: false, // Idempotency OFF
      fencingTokenEnforced: false,
      sim,
    });
    const channel = new Channel({
      id: "chan-dup",
      sourceActorId: "actor-a",
      targetActorId: "actor-b",
      timeoutMs: 100,
      sim,
    });

    applyDuplicate(sim, channel, { count: 3, targetCell: cell, payload: { charge: 100 } });
    assert.equal(cell.mutationCount, 3);
  });

  it("DUPLICATE on CHANNEL with idempotency → no duplicate", () => {
    const sim = new Sim(42);
    const cell = new Cell({
      id: "cell-with-idem",
      actorId: "actor-b",
      persistence: "DURABLE",
      idempotencyEnforced: true, // Idempotency ON
      fencingTokenEnforced: false,
      sim,
    });
    const channel = new Channel({
      id: "chan-dup-idem",
      sourceActorId: "actor-a",
      targetActorId: "actor-b",
      timeoutMs: 100,
      sim,
    });

    applyDuplicate(sim, channel, {
      count: 3,
      targetCell: cell,
      payload: { charge: 100 },
      dedupKey: "fixed-key",
    });
    assert.equal(cell.mutationCount, 1);
  });

  it("SATURATE LEASE with PANIC_CRASH → lease.panic_crash emitted", () => {
    const sim = new Sim(42);
    const lease = new Lease({
      id: "lease-worker-mem",
      actorId: "actor-worker",
      maxCapacity: 5,
      ttlMs: 100,
      overflowPolicy: "PANIC_CRASH",
      sim,
    });

    const res = applySaturate(sim, lease, { loadUnits: 10 });
    assert.equal(res.ok, false);
    assert.ok(sim.log.some((e) => e.kind === "lease.panic_crash"));
  });

  it("WIPE volatile cells preserves durable cells", () => {
    const sim = new Sim(42);
    const volatileCell = new Cell({
      id: "cell-session",
      actorId: "actor-srv",
      persistence: "VOLATILE",
      idempotencyEnforced: false,
      fencingTokenEnforced: false,
      initialState: "session-data",
      sim,
    });
    const durableCell = new Cell({
      id: "cell-account",
      actorId: "actor-srv",
      persistence: "DURABLE",
      idempotencyEnforced: false,
      fencingTokenEnforced: false,
      initialState: "permanent-balance",
      sim,
    });

    applyWipe(sim, { id: "actor-srv" }, {
      scope: "VOLATILE_CELLS",
      cells: [volatileCell, durableCell],
    });

    assert.equal(volatileCell.state, null);
    assert.equal(durableCell.state, "permanent-balance");
    assert.ok(sim.log.some((e) => e.kind === "consonant.wipe.volatile"));
  });

  it("WIPE lease epoch invalidates old writes", () => {
    const sim = new Sim(42);
    const lease = new Lease({
      id: "lease-coord",
      actorId: "actor-coord",
      maxCapacity: 1,
      ttlMs: 100,
      overflowPolicy: "WAIT_TIMEOUT",
      sim,
    });
    const cell = new Cell({
      id: "cell-fenced",
      actorId: "actor-coord",
      persistence: "DURABLE",
      idempotencyEnforced: false,
      fencingTokenEnforced: true,
      sim,
    });

    const acq = lease.acquire("worker-1", 0);
    const oldEpoch = acq.acquiredEpoch!;

    // Invalidate lease epoch via WIPE
    applyWipe(sim, { id: "actor-coord" }, {
      scope: "LEASE_EPOCH",
      leases: [lease],
    });

    // Worker attempts write with old epoch
    cell.epoch = lease.currentEpoch; // Cell updated with new fencing epoch
    const res = cell.mutate("write with stale token", { epoch: oldEpoch });
    assert.equal(res.ok, false);
    assert.equal(res.staleEpoch, true);
  });

  it("CORRUPT LOSSY_DROP is deterministic from seed", () => {
    const makeRun = (seed: number) => {
      const sim = new Sim(seed);
      const log = new Log({
        id: "log-traffic",
        actorId: "actor-gw",
        maxCapacity: 20,
        compactionLagMs: 0,
        deduplicateOnCompact: false,
        sim,
      });
      for (let i = 0; i < 10; i++) log.append(`item-${i}`);
      const rng = new Rng(seed);
      applyCorrupt(sim, log, { mode: "LOSSY_DROP", selector: { count: 3 } }, rng);
      return sim.log.filter((e) => e.kind === "log.entry_dropped");
    };

    const runA = makeRun(12345);
    const runB = makeRun(12345);
    const runC = makeRun(99999);

    assert.deepEqual(runA, runB);
    assert.notDeepEqual(runA, runC);
  });

  it("CORRUPT SCHEMA_DRIFT transforms response", () => {
    const sim = new Sim(42);
    const channel = new Channel({
      id: "chan-api",
      sourceActorId: "actor-client",
      targetActorId: "actor-api",
      timeoutMs: 100,
      sim,
    });

    const res = applyCorrupt(sim, channel, {
      mode: "SCHEMA_DRIFT",
      payload: { user_id: 123, status: "active" },
    });
    assert.equal(res.ok, true);
    assert.ok(sim.log.some((e) => e.kind === "channel.schema_drift_detected"));
  });

  it("CORRUPT POISON_PILL at specified index", () => {
    const sim = new Sim(42);
    const channel = new Channel({
      id: "chan-pipeline",
      sourceActorId: "actor-a",
      targetActorId: "actor-b",
      timeoutMs: 100,
      sim,
    });

    const res = applyCorrupt(sim, channel, {
      mode: "POISON_PILL",
      selector: { itemIndex: 14 },
    });
    assert.equal(res.ok, false);
    assert.equal((res.details as any).poisonItemIndex, 14);
    assert.ok(sim.log.some((e) => e.kind === "consonant.corrupt.poison_pill"));
  });
});

describe("Layer 2 — Composition", () => {
  it("DELAY + LEASE: lease held during delayed channel call", () => {
    const sim = new Sim(42);
    const lease = new Lease({
      id: "lease-held",
      actorId: "actor-a",
      maxCapacity: 1,
      ttlMs: 500,
      overflowPolicy: "REJECT_429",
      heldDuringExternalChannel: true,
      sim,
    });
    const channel = new Channel({
      id: "chan-ext",
      sourceActorId: "actor-a",
      targetActorId: "actor-ext",
      timeoutMs: 200,
      sim,
    });

    // Acquire lease and apply delay
    const delayRes = applyDelay(sim, channel, { durationMs: 150, heldLease: lease });
    assert.equal(delayRes.ok, true);
    // After delayed channel completes, lease is released
    assert.equal(lease.currentLoad, 0);
  });

  it("SEVER POST_COMMIT + DUPLICATE: retry without idempotency produces duplicate", () => {
    const sim = new Sim(42);
    const cell = new Cell({
      id: "cell-payment",
      actorId: "actor-payment",
      persistence: "DURABLE",
      idempotencyEnforced: false, // No idempotency
      fencingTokenEnforced: false,
      sim,
    });
    const channel = new Channel({
      id: "chan-payment",
      sourceActorId: "actor-agent",
      targetActorId: "actor-payment",
      timeoutMs: 50,
      sim,
    });

    // Attempt 1: POST_COMMIT sever occurs
    applySever(sim, channel, { phase: "POST_COMMIT", targetCell: cell });
    assert.equal(cell.mutationCount, 1);

    // Caller retries due to timeout
    channel.send(sim, { charge: 500 }, cell);
    assert.equal(cell.mutationCount, 2); // Duplicate emerges naturally!
  });

  it("WIPE VOLATILE_CELLS + DUPLICATE: replay after wipe duplicates", () => {
    const sim = new Sim(42);
    const sessionCell = new Cell({
      id: "cell-session",
      actorId: "actor-worker",
      persistence: "VOLATILE",
      idempotencyEnforced: false,
      fencingTokenEnforced: false,
      initialState: { step: 1 },
      sim,
    });
    const ledgerCell = new Cell({
      id: "cell-ledger",
      actorId: "actor-worker",
      persistence: "DURABLE",
      idempotencyEnforced: false,
      fencingTokenEnforced: false,
      initialState: { balances: 100 },
      sim,
    });

    // Mutation 1
    ledgerCell.mutate({ balances: 200 });
    assert.equal(ledgerCell.mutationCount, 1);

    // Worker crashes: wipe volatile state
    applyWipe(sim, { id: "actor-worker" }, { scope: "VOLATILE_CELLS", cells: [sessionCell, ledgerCell] });
    assert.equal(sessionCell.state, null);
    assert.equal(ledgerCell.state !== null, true);

    // Replay after crash
    ledgerCell.mutate({ balances: 300 });
    assert.equal(ledgerCell.mutationCount, 2);
  });

  it("SATURATE LEASE + PANIC_CRASH: bounded consumer overflow → crash", () => {
    const sim = new Sim(42);
    const boundedLease = new Lease({
      id: "lease-128mb",
      actorId: "worker",
      maxCapacity: 128,
      ttlMs: 1000,
      overflowPolicy: "PANIC_CRASH",
      sim,
    });

    const satRes = applySaturate(sim, boundedLease, { loadUnits: 150 });
    assert.equal(satRes.ok, false);
    assert.ok(sim.log.some((e) => e.kind === "lease.panic_crash"));
  });
});

describe("Layer 3 — CFO Workflow", () => {
  it("compiles CFO workflow into graph with required actors, channels, and cells", () => {
    const compiler = new AlphabetCompiler();
    const text =
      "CFO agent queries Postgres for high-value ($25k+) churned customers, cross-references Zendesk tickets and GitHub issues for the bugs that caused churn, grants a one-month-free credit in Stripe, sends a personalized apology email via SendGrid, and alerts the dev team in Slack.";
    const graph = compiler.compileFromNaturalLanguage(text);

    assert.ok(graph.actors.length >= 5, `Expected >= 5 actors, got ${graph.actors.length}`);
    assert.ok(graph.channels.length >= 3, `Expected >= 3 channels, got ${graph.channels.length}`);
    assert.ok(graph.vowels.filter((v) => v.kind === "CELL").length >= 2, "Expected >= 2 cells");
    assert.ok(graph.vowels.filter((v) => v.kind === "LEASE").length >= 1, "Expected >= 1 lease");
    assert.ok(graph.candidatePerturbations.length >= 3, "Expected >= 3 candidate perturbations");
  });
});

describe("Layer 4 — Cloudflare Reconstruction", () => {
  it("evaluates bounded resource consumer decomposition", () => {
    const compiler = new AlphabetCompiler();
    const result = compiler.attemptProposedMechanism(
      "proposed.bounded_resource_consumer",
      "Worker has a 128MB bounded memory limit that panics on overflow",
    );

    assert.equal(result.status, "REPRESENTABLE");
    if (result.status === "REPRESENTABLE") {
      assert.ok(result.letters.includes("V3"));
      assert.ok(result.letters.includes("C4"));
      assert.equal(result.coverage, 1.0);
    }
  });
});

describe("Layer 5 — Invoice Compilation", () => {
  it("compiles invoice evidence preserving provenance and confidence", () => {
    const compiler = new AlphabetCompiler();
    const evidence = [
      {
        source: "Cloudflare bill",
        sku: "Cloudflare Worker 128MB",
        actorId: "cloudflare-worker",
        evidence: "Memory limit 128MB",
        inferredCapacity: {
          kind: "LEASE" as const,
          maxCapacity: 128,
          confidence: "EXPLICIT" as const,
          evidence: "Cloudflare docs: Worker memory limit 128MB",
        },
      },
      {
        source: "OpenAI invoice",
        sku: "Tier-2 Pay-as-you-go",
        actorId: "openai-api",
        evidence: "Usage limit 5000 RPM",
        inferredCapacity: {
          kind: "LEASE" as const,
          maxCapacity: 5000,
          confidence: "EXPLICIT" as const,
          evidence: "OpenAI rate limits table",
        },
      },
      {
        source: "AWS bill",
        sku: "db.t4g.medium",
        actorId: "aws-rds",
        evidence: "4GB RAM",
        inferredCapacity: {
          kind: "LEASE" as const,
          maxCapacity: 400,
          confidence: "INFERRED" as const,
          evidence: "AWS docs: db.t4g.medium default max_connections ~400",
        },
      },
    ];

    const graph = compiler.compileFromInvoiceEvidence(evidence);
    const leases = graph.vowels.filter((v): v is Lease => v.kind === "LEASE");
    assert.equal(leases.length, 3);

    const cfLease = leases.find((l) => l.actorId === "cloudflare-worker");
    const oaLease = leases.find((l) => l.actorId === "openai-api");
    const rdsLease = leases.find((l) => l.actorId === "aws-rds");

    assert.equal(cfLease?.maxCapacity, 128);
    assert.equal(oaLease?.maxCapacity, 5000);
    assert.equal(rdsLease?.maxCapacity, 400);

    const cfProv = graph.provenance?.find((p) => p.source === "Cloudflare bill");
    const rdsProv = graph.provenance?.find((p) => p.source === "AWS bill");

    assert.equal(cfProv?.confidence, "EXPLICIT");
    assert.equal(rdsProv?.confidence, "INFERRED");
  });
});

describe("Layer 6 — Epistemic Boundary", () => {
  it("returns INSUFFICIENT_PHYSICS for sub-software physical phenomena", () => {
    const compiler = new AlphabetCompiler();
    const result = compiler.attemptProposedMechanism(
      "hardware.bit_flip",
      "a cosmic ray flips a bit in the L1 cache",
    );

    assert.equal(result.status, "INSUFFICIENT_PHYSICS");
    if (result.status === "INSUFFICIENT_PHYSICS") {
      assert.ok(result.missingSemantics.some((s) => s.includes("bit flip")));
    }

    const graph = compiler.compileFromNaturalLanguage("a cosmic ray flips a bit in the L1 cache");
    assert.ok(graph.epistemicStatus.includes("NOT_REPRESENTABLE"));
    assert.ok(graph.unrepresentableSemantics.includes("hardware-level bit flip"));
  });
});

