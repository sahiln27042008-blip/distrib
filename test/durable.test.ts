import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  COMPACT_CHECKPOINT_BYTES,
  DURABLE_STEP_NAMES,
  DurableScenario,
  NAIVE_STATE_WRITE_BYTES,
  WorkflowLedger,
  canonicalJson,
  type CompactAudit,
  type DurableConfigInput,
  type DurableMode,
} from "../src/durable.ts";

function run(mode: DurableMode, config: Partial<DurableConfigInput> = {}) {
  const scenario = new DurableScenario({ mode, seed: 7, runId: `${mode}-run`, ...config });
  scenario.start();
  scenario.run();
  return scenario;
}

function digestOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function auditFacts(audit: CompactAudit): Record<string, unknown> {
  return {
    algorithm: audit.algorithm,
    cumulativeBytes: audit.cumulativeBytes,
    digest: audit.digest,
    kind: audit.kind,
    lostBytes: audit.lostBytes,
    lostCheckpoints: audit.lostCheckpoints,
    mode: audit.mode,
    runId: audit.runId,
    stepCount: audit.stepCount,
    steps: audit.steps,
  };
}

function assertAuditContract(audit: CompactAudit): void {
  assert.equal(audit.kind, "workflow-ledger-audit");
  assert.equal(audit.algorithm, "sha256");
  assert.match(audit.digest, /^[0-9a-f]{64}$/);
  assert.equal(Buffer.byteLength(audit.document, "utf8"), audit.totalBytes);
  assert.ok(audit.totalBytes >= 3_500 && audit.totalBytes <= 4_500);
  assert.equal(Buffer.byteLength(canonicalJson(auditFacts(audit)), "utf8"), audit.meaningfulBytes);
  assert.equal(audit.digest, digestOf(canonicalJson({
    cumulativeBytes: audit.cumulativeBytes,
    lostBytes: audit.lostBytes,
    lostCheckpoints: audit.lostCheckpoints,
    mode: audit.mode,
    runId: audit.runId,
    stepCount: audit.stepCount,
    steps: audit.steps,
  })));
  const parsed = JSON.parse(audit.document) as { digest?: string; padding?: string; paddingKind?: string; steps?: unknown };
  assert.equal(parsed.digest, audit.digest);
  assert.deepEqual(parsed.steps, audit.steps);
  const overhead = audit.totalBytes - audit.meaningfulBytes - audit.paddingBytes;
  assert.ok(overhead >= 0 && overhead < 80);
  if (audit.paddingKind === "none") {
    assert.equal(audit.paddingBytes, 0);
    assert.equal(audit.padding, "");
    assert.equal(audit.meaningfulBytes, audit.totalBytes);
    assert.equal(Object.hasOwn(parsed, "padding"), false);
    assert.equal(audit.document, canonicalJson(auditFacts(audit)));
  } else {
    assert.equal(audit.paddingKind, "explicit-padding");
    assert.equal(audit.totalBytes, 4_096);
    assert.equal(audit.padding, "=".repeat(audit.paddingBytes));
    assert.equal(parsed.paddingKind, "explicit-padding");
    assert.equal(parsed.padding, audit.padding);
    assert.equal(audit.document.includes(`"padding":"${audit.padding}"`), true);
    assert.equal(audit.digest.includes("="), false);
  }
}

test("M9 defaults, required identity, and config bounds", () => {
  const resilient = new DurableScenario({ mode: "resilient", seed: 1, runId: "defaults" });
  assert.equal(resilient.cfg.totalSteps, 30);
  assert.equal(resilient.cfg.crashAtStep, 8);
  assert.equal(resilient.cfg.stepTokenCost, 6_000);
  assert.equal(resilient.cfg.stepDurationMs, 1_000);
  assert.equal(resilient.cfg.payloadBytesPerStep, COMPACT_CHECKPOINT_BYTES);
  assert.equal(new DurableScenario({ mode: "naive", seed: 1, runId: "defaults-naive" }).cfg.payloadBytesPerStep, NAIVE_STATE_WRITE_BYTES);
  assert.equal(DURABLE_STEP_NAMES.length, 30);
  assert.throws(() => new DurableScenario({ mode: "nope" as DurableMode, seed: 1, runId: "bad-mode" }), /mode/);
  assert.throws(() => new DurableScenario({ mode: "resilient", seed: -1, runId: "bad-seed" }), /seed/);
  assert.throws(() => new DurableScenario({ mode: "resilient", seed: 1.5, runId: "bad-seed" }), /seed/);
  assert.throws(() => new DurableScenario({ mode: "resilient", seed: 1, runId: "bad run" }), /runId/);
  assert.throws(() => new DurableScenario({ mode: "resilient", seed: 1, runId: "short", totalSteps: 5 }), /crashAtStep/);
  assert.throws(() => new DurableScenario({ mode: "resilient", seed: 1, runId: "short", crashAtStep: 0 }), /crashAtStep/);
  assert.throws(() => new DurableScenario({ mode: "naive", seed: 1, runId: "payload", payloadBytesPerStep: 100 }), /payloadBytesPerStep/);
  assert.throws(() => new DurableScenario({ mode: "naive", seed: 1, runId: "payload", payloadBytesPerStep: 500_001 }), /payloadBytesPerStep/);
  assert.throws(() => new DurableScenario({ mode: "resilient", seed: 1, runId: "steps", totalSteps: 31, crashAtStep: 1 }), /totalSteps/);
});

test("M9 ledger rejects bad steps and bytes, distinguishes missing checkpoints, and hides mutable state", () => {
  const ledger = new WorkflowLedger({ maxStep: 30, runId: "ledger-1", mode: "resilient" });
  assert.deepEqual(ledger.resumeFrom(1), { found: false, step: 1, reason: "missing-checkpoint" });
  assert.equal(ledger.hasCheckpoint(1), false);
  assert.throws(() => ledger.appendStep(0, {}, 2), /step/);
  assert.throws(() => ledger.appendStep(1.5, {}, 2), /step/);
  assert.throws(() => ledger.appendStep(31, {}, 2), /step/);
  assert.throws(() => ledger.resumeFrom(0), /step/);
  assert.throws(() => ledger.hasCheckpoint(0), /step/);
  assert.throws(() => ledger.appendStep(1, {}, -1), /bytesWritten/);
  assert.throws(() => ledger.appendStep(1, {}, 1), /bytesWritten/);
  assert.throws(() => ledger.appendStep(1, [], 2), /plain object/);
  assert.throws(() => ledger.appendStep(1, null as unknown as Record<string, unknown>, 4), /plain object/);

  const weird = { found: false, reason: "missing-checkpoint" };
  ledger.appendStep(1, weird, Buffer.byteLength(JSON.stringify(weird), "utf8"));
  const present = ledger.resumeFrom(1);
  assert.equal(present.found, true);
  if (!present.found) return;
  assert.equal(present.state.reason, "missing-checkpoint");
  present.state.reason = "mutated";
  assert.equal(ledger.resumeFrom(1).found, true);
  const reread = ledger.resumeFrom(1);
  if (!reread.found) return;
  assert.equal(reread.state.reason, "missing-checkpoint");
  weird.reason = "caller-mutated";
  const isolated = ledger.resumeFrom(1);
  if (!isolated.found) return;
  assert.equal(isolated.state.reason, "missing-checkpoint");

  const state = { value: 1 };
  const recorded = ledger.appendStep(2, state, Buffer.byteLength(JSON.stringify(state), "utf8"));
  state.value = 9;
  assert.throws(() => ledger.appendStep(2, { value: 1 }, recorded.bytesWritten), /already exists/);
  const second = ledger.resumeFrom(2);
  if (!second.found) return;
  assert.equal(second.state.value, 1);
  assert.equal(ledger.totals().cumulativeBytes, present.bytesWritten + recorded.bytesWritten);

  const lost = ledger.discardVolatile();
  assert.equal(lost.steps, 2);
  assert.equal(ledger.hasCheckpoint(1), false);
  assert.deepEqual(ledger.resumeFrom(1), { found: false, step: 1, reason: "missing-checkpoint" });
  assert.equal(ledger.totals().cumulativeBytes, lost.bytes);
  ledger.appendStep(2, { value: 1 }, Buffer.byteLength(JSON.stringify({ value: 1 }), "utf8"));
  assert.equal(ledger.totals().cumulativeBytes, lost.bytes + Buffer.byteLength(JSON.stringify({ value: 1 }), "utf8"));
  assert.equal(ledger.totals().lostCheckpoints, 2);
});

test("M9 compaction is a deterministic SHA-256 audit with explicit padding excluded from content", () => {
  const empty = new WorkflowLedger({ maxStep: 30, runId: "audit-empty", mode: "resilient" }).compact();
  assertAuditContract(empty);
  assert.equal(empty.totalBytes, 4_096);
  assert.equal(empty.paddingKind, "explicit-padding");
  assert.equal(empty.stepCount, 0);

  const ledger = new WorkflowLedger({ maxStep: 30, runId: "audit-steps", mode: "naive" });
  const before = ledger.compact();
  ledger.appendStep(1, { value: 1 }, Buffer.byteLength(JSON.stringify({ value: 1 }), "utf8"));
  const after = ledger.compact();
  assertAuditContract(after);
  assert.notEqual(before.digest, after.digest);
  assert.deepEqual(after, ledger.compact());
  assert.equal(after.cumulativeBytes, after.steps[0]?.bytesWritten);
  assert.equal(after.document.includes("h".repeat(50)), false);
});

test("M9 same seed is byte-identical and a different seed changes the run", () => {
  const left = run("resilient", { runId: "determinism", seed: 44, payloadBytesPerStep: 136 });
  const right = run("resilient", { runId: "determinism", seed: 44, payloadBytesPerStep: 136 });
  const other = run("resilient", { runId: "determinism", seed: 45, payloadBytesPerStep: 136 });
  assert.equal(left.snapshot().life, "finished");
  assert.deepEqual(left.snapshot(), right.snapshot());
  assert.equal(digestOf(JSON.stringify(left.snapshot())), digestOf(JSON.stringify(right.snapshot())));
  assert.equal(digestOf(JSON.stringify(left.exportTrace())), digestOf(JSON.stringify(right.exportTrace())));
  assert.notEqual(digestOf(JSON.stringify(left.snapshot())), digestOf(JSON.stringify(other.snapshot())));
  assert.equal(left.sim.log.length, right.sim.log.length);
});

test("M9 naive crash rewrites full state and resilient replay resumes from the last checkpoint", () => {
  const naive = run("naive", { runId: "naive-acceptance" });
  const resilient = run("resilient", { runId: "resilient-acceptance" });
  const naiveSnap = naive.snapshot();
  const resilientSnap = resilient.snapshot();
  const preCrash = 7;

  assert.equal(naiveSnap.life, "finished");
  assert.equal(resilientSnap.life, "finished");
  assert.equal(naiveSnap.worker, "recovered");
  assert.equal(resilientSnap.worker, "recovered");
  assert.equal(naiveSnap.phase, "completed");
  assert.equal(naiveSnap.crashCount, 1);
  assert.equal(resilientSnap.crashCount, 1);
  assert.equal(naiveSnap.resumedFromStep, 0);
  assert.equal(resilientSnap.resumedFromStep, preCrash);
  assert.equal(naiveSnap.completedSteps, 30);
  assert.equal(resilientSnap.completedSteps, 30);
  assert.equal(naiveSnap.virtualTimeMs, (preCrash + 30) * 1_000);
  assert.equal(resilientSnap.virtualTimeMs, 30 * 1_000);

  assert.equal(naiveSnap.metrics.payloadBytesPerStep, 500_000);
  assert.equal(resilientSnap.metrics.payloadBytesPerStep, 136);
  assert.equal(naiveSnap.metrics.cumulativeBytes, (preCrash + 30) * 500_000);
  assert.equal(naiveSnap.metrics.volatileBytesLost, preCrash * 500_000);
  assert.equal(naiveSnap.metrics.checkpointBytes, 30 * 500_000);
  assert.equal(resilientSnap.metrics.cumulativeBytes, 30 * 136);
  assert.equal(resilientSnap.metrics.volatileBytesLost, 0);
  assert.equal(resilientSnap.metrics.checkpointBytes, 30 * 136);

  assert.equal(naiveSnap.metrics.tokensConsumed, (preCrash + 30) * 6_000);
  assert.equal(resilientSnap.metrics.tokensConsumed, 30 * 6_000);
  assert.equal(naiveSnap.metrics.wastedTokens, preCrash * 6_000);
  assert.equal(resilientSnap.metrics.wastedTokens, 0);
  assert.equal(resilientSnap.metrics.tokensAvoidedByReplay, preCrash * 6_000);
  assert.equal(naiveSnap.metrics.tokensAvoidedByReplay, 0);
  assert.equal(naiveSnap.metrics.duplicateSideEffects, preCrash);
  assert.equal(resilientSnap.metrics.duplicateSideEffects, 0);
  assert.equal(naiveSnap.metrics.sideEffects, preCrash + 30);
  assert.equal(resilientSnap.metrics.sideEffects, 30);
  assert.equal(naiveSnap.metrics.replayedSteps, 0);
  assert.equal(resilientSnap.metrics.replayedSteps, preCrash);
  assert.equal(naiveSnap.steps.reduce((sum, step) => sum + step.tokenCost, 0), naiveSnap.metrics.tokensConsumed);
  assert.equal(resilientSnap.steps.reduce((sum, step) => sum + step.tokenCost, 0), resilientSnap.metrics.tokensConsumed);

  assert.equal(naiveSnap.steps[0]?.effect, "accept-order");
  assert.equal(naiveSnap.steps[7]?.effect, "pack-shipment");
  assert.equal(naiveSnap.steps[29]?.effect, "complete-order");
  assert.equal(naiveSnap.steps[0]?.executions, 2);
  assert.equal(naiveSnap.steps[7]?.executions, 1);
  assert.equal(naiveSnap.steps[0]?.generation, 2);
  assert.equal(resilientSnap.steps[0]?.replayed, true);
  assert.equal(resilientSnap.steps[7]?.replayed, false);
  assert.equal(resilientSnap.steps.every((step) => step.generation === 1 && step.executions === 1), true);

  const naiveKeys = naive.sim.log.filter((event) => event.kind === "durable.side_effect" && event.data.step === 1).map((event) => event.data.key);
  const resilientKeys = resilient.sim.log.filter((event) => event.kind === "durable.side_effect" && event.data.step === 1).map((event) => event.data.key);
  assert.equal(naiveKeys.length, 2);
  assert.notEqual(naiveKeys[0], naiveKeys[1]);
  assert.deepEqual(resilientKeys, [`sha256:${digestOf(canonicalJson({ op: "enterprise-side-effect", runId: "resilient-acceptance", step: 1 }))}`]);
  assert.equal(naive.sim.log.filter((event) => event.kind === "durable.checkpoint").length, preCrash + 30);
  assert.equal(resilient.sim.log.filter((event) => event.kind === "durable.checkpoint").length, 30);
  assert.equal(resilient.sim.log.filter((event) => event.kind === "durable.step.replay").length, preCrash);
  assert.equal(naive.sim.log.filter((event) => event.kind === "durable.crash" && event.data.checkpointsRetained === false).length, 1);
  assert.equal(resilient.sim.log.filter((event) => event.kind === "durable.crash" && event.data.checkpointsRetained === true && event.data.step === 8).length, 1);

  const naiveBytes = naive.sim.log.filter((event) => event.kind === "durable.checkpoint").reduce((sum, event) => sum + Number(event.data.bytesWritten), 0);
  const resilientBytes = resilient.sim.log.filter((event) => event.kind === "durable.checkpoint").reduce((sum, event) => sum + Number(event.data.bytesWritten), 0);
  assert.equal(naiveBytes, naiveSnap.metrics.cumulativeBytes);
  assert.equal(resilientBytes, resilientSnap.metrics.cumulativeBytes);

  const naiveState = naive.ledger.resumeFrom(30);
  const resilientState = resilient.ledger.resumeFrom(1);
  assert.equal(naiveState.found, true);
  assert.equal(resilientState.found, true);
  if (naiveState.found) {
    assert.equal(naiveState.bytesWritten, 500_000);
    assert.equal(typeof naiveState.state.history, "string");
    assert.equal(Buffer.byteLength(JSON.stringify(naiveState.state), "utf8"), 500_000);
  }
  if (resilientState.found) {
    assert.equal(resilientState.bytesWritten, 136);
    assert.equal(Buffer.byteLength(JSON.stringify(resilientState.state), "utf8"), 136);
    assert.equal(Object.hasOwn(resilientState.state, "history"), false);
    assert.equal(resilientState.state.effect, "step-01");
    assert.equal(resilientState.state.tag, "m9");
  }
  assert.equal(naive.ledger.hasCheckpoint(30), true);
  assert.throws(() => naive.ledger.resumeFrom(31), /step/);

  for (const scenario of [naive, resilient]) {
    const snap = scenario.snapshot();
    assertAuditContract(scenario.ledger.compact());
    assert.ok(JSON.stringify(snap).length < 200_000);
    assert.equal(JSON.stringify(snap).includes("h".repeat(1_000)), false);
    assert.equal(JSON.stringify(scenario.exportTrace()).includes("h".repeat(1_000)), false);
    for (const event of scenario.sim.log) assert.ok(JSON.stringify(event.data).length <= 4096);
    const trace = scenario.exportTrace();
    assert.equal(trace.schema, "sim-trace/0");
    assert.equal(trace.simulated, true);
    assert.equal(trace.virtualTime, true);
    assert.equal(trace.spans.length, scenario.sim.log.length);
  }
});

test("M9 crash is one-indexed and a shorter workflow still recovers on the virtual clock", () => {
  const naive = run("naive", { runId: "short-naive", totalSteps: 3, crashAtStep: 2, payloadBytesPerStep: 136, stepDurationMs: 1_000, stepTokenCost: 6_000 });
  const resilient = run("resilient", { runId: "short-resilient", totalSteps: 3, crashAtStep: 2, payloadBytesPerStep: 200 });
  assert.equal(naive.snapshot().virtualTimeMs, 4_000);
  assert.equal(resilient.snapshot().virtualTimeMs, 3_000);
  assert.equal(naive.snapshot().metrics.duplicateSideEffects, 1);
  assert.equal(resilient.snapshot().metrics.replayedSteps, 1);
  assert.equal(resilient.snapshot().metrics.cumulativeBytes, 3 * 200);
  const resumed = resilient.ledger.resumeFrom(1);
  assert.equal(resumed.found, true);
  if (resumed.found) {
    assert.equal(resumed.bytesWritten, 200);
    assert.equal(typeof resumed.state.history, "string");
  }
  assert.equal(naive.sim.log.find((event) => event.kind === "durable.crash")?.data.step, 2);
});

test("M9 retains resilient checkpoints at the crash and drops naive volatile state", () => {
  const resilient = new DurableScenario({ mode: "resilient", seed: 7, runId: "mid-resilient", payloadBytesPerStep: 136 });
  resilient.start();
  for (let count = 0; count < 8; count += 1) assert.equal(resilient.step(), true);
  assert.equal(resilient.snapshot().worker, "crashed");
  assert.equal(resilient.snapshot().phase, "recovering");
  assert.equal(resilient.snapshot().completedSteps, 7);
  assert.equal(resilient.ledger.hasCheckpoint(7), true);
  assert.equal(resilient.ledger.hasCheckpoint(8), false);
  resilient.run();
  assert.equal(resilient.snapshot().life, "finished");
  assert.equal(resilient.snapshot().worker, "recovered");
  assert.equal(resilient.ledger.hasCheckpoint(8), true);

  const naive = new DurableScenario({ mode: "naive", seed: 7, runId: "mid-naive", payloadBytesPerStep: 136 });
  naive.start();
  for (let count = 0; count < 8; count += 1) naive.step();
  assert.equal(naive.ledger.hasCheckpoint(1), false);
  assert.equal(naive.snapshot().metrics.volatileBytesLost, 7 * 136);
  assert.equal(naive.snapshot().completedSteps, 0);
  naive.run();
  assert.equal(naive.snapshot().steps[0]?.executions, 2);
});

test("M9 snapshots and traces are copies, and reset replays the same run", () => {
  const scenario = run("resilient", { runId: "reset-case", payloadBytesPerStep: 136 });
  const first = scenario.snapshot();
  const trace = scenario.exportTrace();
  first.steps[0]!.effect = "corrupted";
  first.metrics.tokensConsumed = -1;
  first.events[0]!.data.mode = "corrupted";
  trace.spans[0]!.attrs.mode = "corrupted";
  const second = scenario.snapshot();
  assert.equal(second.steps[0]?.effect, "accept-order");
  assert.equal(second.metrics.tokensConsumed, 180_000);
  assert.equal(second.events[0]?.data.mode, "resilient");
  assert.equal(scenario.exportTrace().spans[0]?.attrs.mode, "resilient");
  scenario.reset();
  assert.equal(scenario.life, "idle");
  assert.equal(scenario.phase, "idle");
  assert.equal(scenario.sim.pending(), 0);
  assert.equal(scenario.snapshot().eventsCount, 0);
  assert.equal(scenario.ledger.hasCheckpoint(1), false);
  scenario.start();
  scenario.run();
  assert.deepEqual(scenario.snapshot(), second);
});

test("M9 event and scheduler limits stop safely and leave the run resettable", () => {
  const limited = new DurableScenario({ mode: "resilient", seed: 3, runId: "event-bound", maxEvents: 5, payloadBytesPerStep: 136 });
  limited.start();
  limited.run();
  assert.equal(limited.life, "error");
  assert.match(limited.error ?? "", /event limit/);
  assert.equal(limited.sim.log.length, 5);
  limited.reset();
  assert.equal(limited.life, "idle");
  assert.equal(limited.sim.pending(), 0);
  assert.equal(limited.snapshot().eventsCount, 0);

  const stepped = new DurableScenario({ mode: "naive", seed: 3, runId: "step-bound", maxSteps: 1, payloadBytesPerStep: 136, totalSteps: 3, crashAtStep: 1 });
  stepped.start();
  stepped.run();
  assert.equal(stepped.life, "error");
  assert.match(stepped.error ?? "", /step limit/);
  assert.throws(() => stepped.start(), /cannot start/);
});

test("M9 history cap keeps snapshot events bounded without dropping the log", () => {
  const scenario = run("resilient", { runId: "history-cap", payloadBytesPerStep: 136, eventHistoryLimit: 3 });
  const snap = scenario.snapshot();
  assert.ok(snap.eventsCount > 3);
  assert.equal(snap.events.length, 3);
  assert.equal(snap.events[0]?.id, scenario.sim.log.at(-3)?.id);
});
