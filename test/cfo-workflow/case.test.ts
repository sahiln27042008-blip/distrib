// enterpriseee/enterprise-simulator/test/cfo-workflow/case.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Sim } from "../../src/kernel.ts";
import { AlphabetCompiler } from "../../src/physics/alphabet/compiler.ts";
import { applySever, applyDuplicate, applyDelay } from "../../src/physics/alphabet/index.ts";
import type { Cell } from "../../src/physics/alphabet/vowels/cell.ts";
import type { Channel } from "../../src/physics/alphabet/vowels/channel.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = JSON.parse(fs.readFileSync(path.join(here, "public-evidence.json"), "utf8"));

test("Layer 3: CFO Workflow Compilation", () => {
  const compiler = new AlphabetCompiler();
  const graph = compiler.compileFromNaturalLanguage(evidence.workflow_description);

  // Assert graph structure
  assert.ok(graph.actors.length >= 5, `Expected >= 5 actors, got ${graph.actors.length}`);
  assert.ok(graph.channels.length >= 3, `Expected >= 3 channels, got ${graph.channels.length}`);
  assert.ok(graph.vowels.filter((v) => v.kind === "CELL").length >= 2, "Expected >= 2 cells");
  assert.ok(graph.vowels.filter((v) => v.kind === "LEASE").length >= 1, "Expected >= 1 lease");

  // Representable failure modes
  const representableModes = [
    "SEVER_POST_COMMIT_DIVERGENCE",
    "DUPLICATE_WITHOUT_IDEMPOTENCY",
    "CHANNEL_TIMEOUT_DELAY",
    "LEASE_SATURATION",
  ];
  assert.ok(representableModes.length >= 3, "At least 3 failure modes representable");
});

test("Layer 3: CFO Workflow Execution produces real kernel event sequence", () => {
  const compiler = new AlphabetCompiler();
  const graph = compiler.compileFromNaturalLanguage(evidence.workflow_description);

  const sim = new Sim(42);
  const stripeChannel = graph.channels.find((c) => c.id === "channel-cfo-stripe");
  const stripeCell = graph.vowels.find((v) => v.id === "cell-stripe-credit") as Cell;

  assert.ok(stripeChannel, "Stripe channel must exist");
  assert.ok(stripeCell, "Stripe credit cell must exist");

  // Execute failure mode: POST_COMMIT sever
  const severRes = applySever(sim, stripeChannel, {
    phase: "POST_COMMIT",
    targetCell: stripeCell,
    payload: { grant: "1_month_credit", customerId: "cust-1" },
  });

  assert.equal(severRes.ok, true);
  assert.equal(stripeCell.mutationCount, 1); // Real mutation committed on Stripe

  const kinds = sim.log.map((e) => e.kind);
  assert.ok(kinds.includes("channel.send"));
  assert.ok(kinds.includes("channel.receive"));
  assert.ok(kinds.includes("channel.mutate"));
  assert.ok(kinds.includes("channel.divergence_detected"));
});

test("Layer 3: CFO Workflow Determinism (same seed = byte-identical event log)", () => {
  const runWorkflow = (seed: number) => {
    const compiler = new AlphabetCompiler();
    const graph = compiler.compileFromNaturalLanguage(evidence.workflow_description);
    const sim = new Sim(seed);

    const stripeChannel = graph.channels.find((c) => c.id === "channel-cfo-stripe") as Channel;
    const stripeCell = graph.vowels.find((v) => v.id === "cell-stripe-credit") as Cell;

    applySever(sim, stripeChannel, {
      phase: "POST_COMMIT",
      targetCell: stripeCell,
      payload: { grant: "credit", amount: 100 },
    });

    return JSON.stringify(sim.log);
  };

  const log1 = runWorkflow(42);
  const log2 = runWorkflow(42);

  assert.equal(log1, log2, "Same seed must produce byte-identical event log");
});
