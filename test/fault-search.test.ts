// enterpriseee/enterprise-simulator/test/fault-search.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { AlphabetCompiler } from "../src/physics/alphabet/compiler.ts";
import { Channel, type ChannelConfig, type ChannelSendOpts, type ChannelSendResult } from "../src/physics/alphabet/vowels/channel.ts";
import { Cell } from "../src/physics/alphabet/vowels/cell.ts";
import type { CompiledAlphabetGraph } from "../src/physics/alphabet/types.ts";
import type { Sim } from "../src/kernel.ts";
import {
  searchFaults,
  findCollapseCliff,
  executeFaultSequence,
  type ConsonantFault,
} from "../src/physics/search/index.ts";

test("Test 1: Single-fault discovery via IDDFS (depth 1)", async () => {
  const compiler = new AlphabetCompiler();
  const graph = compiler.compileFromNaturalLanguage(
    "CFO agent queries Postgres for high-value churned customers, grants credit in Stripe, sends email via SendGrid, alerts Slack"
  );

  // Focus candidate perturbation on SEVER POST_COMMIT on Stripe channel
  graph.candidatePerturbations = [
    {
      consonant: { kind: "SEVER", phase: "POST_COMMIT" },
      targetId: "channel-cfo-stripe",
    },
  ];

  const result = await searchFaults(graph, { maxDepth: 1, maxEvaluations: 50 }, 42);

  assert.equal(result.status, "FAILURE_FOUND");
  assert.equal(result.depthReached, 1);
  assert.ok(result.minimalCounterexample);
  assert.equal(result.minimalCounterexample.length, 1);
  assert.equal(result.minimalCounterexample[0]?.consonantKind, "SEVER");
  assert.equal(result.minimalCounterexample[0]?.targetVowelId, "channel-cfo-stripe");
  assert.ok(result.violatedInvariants.includes("r04-network-idempotency"));

  // Verify counterexample reproduces violation
  const repro = await executeFaultSequence(graph, result.minimalCounterexample, 42);
  assert.ok(repro.violatedInvariants.includes("r04-network-idempotency"));
  assert.ok(repro.events.some((e) => e.kind === "channel.divergence_detected"));
});

test("Test 2: Two-fault interaction (SEVER alone succeeds, WIPE alone succeeds, SEVER + WIPE fails at depth 2)", async () => {
  const cell = new Cell({
    id: "cell-session-dedup",
    actorId: "actor-service",
    persistence: "VOLATILE",
    idempotencyEnforced: true,
    fencingTokenEnforced: false,
    initialState: { ok: true },
  });

  const channel = new Channel({
    id: "chan-session-service",
    sourceActorId: "actor-client",
    targetActorId: "actor-service",
    timeoutMs: 5000,
  });

  const graph: CompiledAlphabetGraph = {
    actors: [
      { id: "actor-client", name: "Client" },
      { id: "actor-service", name: "Service" },
    ],
    vowels: [cell, channel],
    channels: [channel],
    contracts: [],
    candidatePerturbations: [
      {
        consonant: { kind: "SEVER", phase: "POST_COMMIT" },
        targetId: channel.id,
      },
      {
        consonant: { kind: "WIPE", scope: "VOLATILE_CELLS", cellIds: [cell.id] },
        targetId: cell.id,
      },
    ],
    epistemicStatus: ["OBSERVED"],
    unrepresentableSemantics: [],
  };

  const severFault: ConsonantFault = {
    consonantKind: "SEVER",
    targetVowelId: channel.id,
    params: { phase: "POST_COMMIT" },
  };

  const wipeFault: ConsonantFault = {
    consonantKind: "WIPE",
    targetVowelId: cell.id,
    params: { scope: "VOLATILE_CELLS", cellIds: [cell.id] },
  };

  // (a) SEVER alone -> recovery succeeds (0 invariant violations)
  const severAlone = await executeFaultSequence(graph, [severFault], 42);
  assert.equal(severAlone.violatedInvariants.length, 0, "SEVER alone must succeed recovery");

  // (b) WIPE alone -> recovery succeeds (0 invariant violations)
  const wipeAlone = await executeFaultSequence(graph, [wipeFault], 42);
  assert.equal(wipeAlone.violatedInvariants.length, 0, "WIPE alone must succeed recovery");

  // (c) SEVER + WIPE -> invariant violation (r04)
  const combo = await executeFaultSequence(graph, [wipeFault, severFault], 42);
  assert.ok(combo.violatedInvariants.includes("r04-network-idempotency"), "Combination must fail");

  // IDDFS search discovers failure at depth 2
  const searchRes = await searchFaults(graph, { maxDepth: 2, maxEvaluations: 50 }, 42);
  assert.equal(searchRes.status, "FAILURE_FOUND");
  assert.equal(searchRes.depthReached, 2);
  assert.ok(searchRes.minimalCounterexample);
  assert.equal(searchRes.minimalCounterexample.length, 2);
});

test("Test 3: Cliff detection on parameterized delay (timeoutMs = 30000)", async () => {
  const cell = new Cell({
    id: "cell-target-unidem",
    actorId: "actor-server",
    persistence: "DURABLE",
    idempotencyEnforced: false,
    fencingTokenEnforced: false,
  });

  const channel = new Channel({
    id: "chan-timeout-cliff",
    sourceActorId: "actor-client",
    targetActorId: "actor-server",
    timeoutMs: 30000,
  });

  const graph: CompiledAlphabetGraph = {
    actors: [
      { id: "actor-client", name: "Client" },
      { id: "actor-server", name: "Server" },
    ],
    vowels: [cell, channel],
    channels: [channel],
    contracts: [],
    candidatePerturbations: [],
    epistemicStatus: ["OBSERVED"],
    unrepresentableSemantics: [],
  };

  const cliff = await findCollapseCliff(
    graph,
    {
      name: "durationMs",
      targetVowelId: channel.id,
      consonantKind: "DELAY",
      paramKey: "durationMs",
    },
    {
      low: 0,
      high: 60000,
      tolerance: 50,
      maxIterations: 30,
    },
    42,
  );

  assert.equal(cliff.status, "CLIFF_FOUND");
  assert.ok(cliff.lowerSafeBound !== undefined);
  assert.ok(cliff.upperFailureBound !== undefined);

  // Interval must contain 30000 within tolerance
  assert.ok(
    cliff.lowerSafeBound <= 30000 && 30000 <= cliff.upperFailureBound,
    `Expected threshold interval [${cliff.lowerSafeBound}, ${cliff.upperFailureBound}] to contain 30000`,
  );
  assert.ok(
    cliff.upperFailureBound - cliff.lowerSafeBound <= cliff.tolerance,
    "Interval width must be within tolerance",
  );
});

test("Test 4: Exhaustive bounded immunity (resilient configuration with maxDepth 2)", async () => {
  const cell = new Cell({
    id: "cell-resilient-target",
    actorId: "actor-secure-server",
    persistence: "DURABLE",
    idempotencyEnforced: true,
    fencingTokenEnforced: true,
  });

  const channel = new Channel({
    id: "chan-resilient",
    sourceActorId: "actor-client",
    targetActorId: "actor-secure-server",
    timeoutMs: 5000,
  });

  const graph: CompiledAlphabetGraph = {
    actors: [
      { id: "actor-client", name: "Client" },
      { id: "actor-secure-server", name: "Secure Server" },
    ],
    vowels: [cell, channel],
    channels: [channel],
    contracts: [],
    candidatePerturbations: [
      { consonant: { kind: "DELAY", durationMs: 100 }, targetId: channel.id },
      { consonant: { kind: "SEVER", phase: "PRE_COMMIT" }, targetId: channel.id },
      { consonant: { kind: "SEVER", phase: "POST_COMMIT" }, targetId: channel.id },
      { consonant: { kind: "DUPLICATE", count: 2 }, targetId: channel.id },
    ],
    epistemicStatus: ["PROVEN"],
    unrepresentableSemantics: [],
  };

  const result = await searchFaults(graph, { maxDepth: 2, maxEvaluations: 5000 }, 42);

  assert.equal(result.status, "NO_FAILURE_WITHIN_BOUND");
  assert.equal(result.depthReached, 2);
  assert.equal(result.violatedInvariants.length, 0);
});

test("Test 5: Budget exhaustion halts search and does NOT claim safety", async () => {
  const cell = new Cell({
    id: "cell-budget-target",
    actorId: "actor-budget-server",
    persistence: "DURABLE",
    idempotencyEnforced: true,
    fencingTokenEnforced: true,
  });

  const channel1 = new Channel({
    id: "chan-budget-1",
    sourceActorId: "client",
    targetActorId: "actor-budget-server",
    timeoutMs: 5000,
  });
  const channel2 = new Channel({
    id: "chan-budget-2",
    sourceActorId: "client",
    targetActorId: "actor-budget-server",
    timeoutMs: 5000,
  });

  const candidates: Array<{ consonant: any; targetId: string }> = [];
  for (let i = 0; i < 10; i++) {
    candidates.push({
      consonant: { kind: "DELAY", durationMs: 10 * (i + 1) },
      targetId: i % 2 === 0 ? channel1.id : channel2.id,
    });
  }

  const graph: CompiledAlphabetGraph = {
    actors: [
      { id: "client", name: "Client" },
      { id: "actor-budget-server", name: "Server" },
    ],
    vowels: [cell, channel1, channel2],
    channels: [channel1, channel2],
    contracts: [],
    candidatePerturbations: candidates,
    epistemicStatus: ["OBSERVED"],
    unrepresentableSemantics: [],
  };

  const result = await searchFaults(graph, { maxDepth: 3, maxEvaluations: 5 }, 42);

  assert.equal(result.status, "BUDGET_EXHAUSTED");
  assert.notEqual(result.status, "NO_FAILURE_WITHIN_BOUND");
  assert.equal(result.evaluations, 5);
});

test("Test 6: Determinism (identical options + seed produce deep-equal results & fingerprint)", async () => {
  const compiler = new AlphabetCompiler();
  const graph = compiler.compileFromNaturalLanguage(
    "CFO agent queries Postgres for high-value churned customers, grants credit in Stripe, sends email via SendGrid, alerts Slack"
  );

  const options = { maxDepth: 1, maxEvaluations: 50 };

  const res1 = await searchFaults(graph, options, 42);
  const res2 = await searchFaults(graph, options, 42);

  assert.equal(res1.status, res2.status);
  assert.deepEqual(res1.minimalCounterexample, res2.minimalCounterexample);
  assert.deepEqual(res1.violatedInvariants, res2.violatedInvariants);
  assert.equal(res1.evaluations, res2.evaluations);
  assert.equal(res1.depthReached, res2.depthReached);
  assert.equal(res1.deterministicFingerprint, res2.deterministicFingerprint);
  assert.ok(typeof res1.deterministicFingerprint === "string");
  assert.ok(res1.deterministicFingerprint.length > 0);
});

class NonMonotonicChannel extends Channel {
  constructor(config: ChannelConfig) {
    super(config);
  }

  override send(
    sim: Sim,
    payload: unknown,
    targetCell?: Cell,
    opts?: ChannelSendOpts,
  ): ChannelSendResult {
    // Non-monotonic behavior: delay between 20 and 40 triggers timeout; values below 20 or above 40 are safe
    if (opts?.delayMs && opts.delayMs >= 20 && opts.delayMs <= 40) {
      return super.send(sim, payload, targetCell, { ...opts, delayMs: 100000 });
    }
    return super.send(sim, payload, targetCell, { ...opts, delayMs: 0 });
  }
}

test("Test 7: Non-monotonic cliff protection returns NON_MONOTONIC", async () => {
  const cell = new Cell({
    id: "cell-nm-target",
    actorId: "actor-nm-server",
    persistence: "DURABLE",
    idempotencyEnforced: false,
    fencingTokenEnforced: false,
  });

  const channel = new NonMonotonicChannel({
    id: "chan-non-monotonic",
    sourceActorId: "client",
    targetActorId: "actor-nm-server",
    timeoutMs: 1000,
  });

  const graph: CompiledAlphabetGraph = {
    actors: [
      { id: "client", name: "Client" },
      { id: "actor-nm-server", name: "Server" },
    ],
    vowels: [cell, channel],
    channels: [channel],
    contracts: [],
    candidatePerturbations: [],
    epistemicStatus: ["OBSERVED"],
    unrepresentableSemantics: [],
  };

  const result = await findCollapseCliff(
    graph,
    {
      name: "durationMs",
      targetVowelId: channel.id,
      consonantKind: "DELAY",
      paramKey: "durationMs",
    },
    {
      low: 0,
      high: 100,
      tolerance: 5,
    },
    42,
  );

  assert.equal(result.status, "NON_MONOTONIC");
  assert.equal(result.parameter, "durationMs");
});

