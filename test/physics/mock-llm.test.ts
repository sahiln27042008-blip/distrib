import test from "node:test";
import assert from "node:assert/strict";

import { MockLLM, type ContextMode, type ToolDefinition } from "../../src/physics/mock-llm.ts";
import { MockLLM as LegacyMockLLM } from "../../src/agent-lab.ts";
import { Sim } from "../../src/kernel.ts";

const TOOLS: ToolDefinition[] = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1,
  name: `crm_tool_${index + 1}`,
  category: "CRM",
  requiredPermission: "support:read",
  relevanceKeywords: ["customer"],
}));

function state(turn: number): Record<string, unknown> {
  return { query: `query for turn ${turn}`, workflowStep: `step-${turn}` };
}

function runTurns(llm: MockLLM, turns = 10): void {
  for (let turn = 1; turn <= turns; turn++) {
    llm.respond(`prompt body for turn ${turn}`, TOOLS, turn, state(turn));
  }
}

function modeLlm(contextMode: ContextMode, seed = 7): MockLLM {
  return new MockLLM("naive", seed, { contextMode });
}

test("default constructor matches the legacy MockLLM output exactly", () => {
  for (const mode of ["naive", "resilient"] as const) {
    for (const seed of [7, 17, 23]) {
      const legacy = new LegacyMockLLM(mode, seed);
      const physics = new MockLLM(mode, seed);
      let legacyHallucinations = 0;
      for (let turn = 1; turn <= 10; turn++) {
        const prompt = `workflow prompt ${turn} ${"x".repeat(turn * 100)}`;
        const expected = legacy.respond(prompt, TOOLS, turn, state(turn));
        const actual = physics.respond(prompt, TOOLS, turn, state(turn));
        assert.deepEqual(actual, expected);
        legacyHallucinations += expected.hallucinationCount;
      }
      assert.equal(physics.hallucinationCount, legacyHallucinations);
    }
  }
});

test("undefined contextMode in dialConfig behaves like no dialConfig", () => {
  const plain = new MockLLM("naive", 11);
  const dialed = new MockLLM("naive", 11, { promptSizeCap: 5 });
  runTurns(plain);
  runTurns(dialed);
  assert.deepEqual(dialed.getStats(), plain.getStats());
});

test("raw_json_80k_flood reaches 80k tokens per prompt and far more cumulatively", () => {
  const llm = modeLlm("raw_json_80k_flood");
  runTurns(llm);
  const stats = llm.getStats();
  assert.equal(stats.turn10Tokens, 80_000);
  assert.ok(stats.promptTokens > 80_000);
});

test("append_only_quadratic grows turn10 above 4x turn1", () => {
  const llm = modeLlm("append_only_quadratic");
  runTurns(llm);
  const stats = llm.getStats();
  assert.ok(stats.turn10Tokens > stats.turn1Tokens * 4);
});

test("lossy_llm_summary stays bounded and loses accounts", () => {
  const llm = modeLlm("lossy_llm_summary");
  runTurns(llm);
  const stats = llm.getStats();
  assert.ok(stats.turn10Tokens < stats.turn1Tokens * 2);
  assert.ok(stats.accountsLost > 0);
  assert.ok(stats.signalPct < 100);
});

test("unmapped_schema_drift raises hallucinationCount", () => {
  for (const seed of [7, 8, 9]) {
    const llm = modeLlm("unmapped_schema_drift", seed);
    runTurns(llm);
    assert.ok(llm.hallucinationCount > 0);
    assert.ok(llm.getStats().hallucinationCount > 0);
  }
});

test("cqrs_duckdb_blackboard_o1 stays bounded and marks a resume", () => {
  const llm = modeLlm("cqrs_duckdb_blackboard_o1");
  runTurns(llm);
  const stats = llm.getStats();
  assert.ok(stats.turn10Tokens < 1000);
  assert.equal(stats.turn1Tokens, stats.turn10Tokens);
  assert.equal(llm.hallucinationCount, 0);
  const sim = new Sim(1);
  llm.emitTraceSpans(sim);
  const resumed = sim.log.filter((event) => event.kind === "model_call" && typeof event.data.resume_of === "string");
  assert.ok(resumed.length >= 1);
  const priorId = String(resumed[0]!.data.resume_of);
  assert.ok(sim.log.some((event) => event.id === priorId && event.kind === "model_call"));
});

test("non-cqrs modes never emit resume_of", () => {
  const llm = modeLlm("append_only_quadratic");
  runTurns(llm);
  const sim = new Sim(1);
  llm.emitTraceSpans(sim);
  assert.ok(sim.log.every((event) => event.data.resume_of === undefined));
});

test("same config and seed produce deepEqual stats", () => {
  const modes: ContextMode[] = [
    "raw_json_80k_flood",
    "append_only_quadratic",
    "lossy_llm_summary",
    "unmapped_schema_drift",
    "cqrs_duckdb_blackboard_o1",
  ];
  for (const contextMode of modes) {
    const first = modeLlm(contextMode, 13);
    const second = modeLlm(contextMode, 13);
    runTurns(first);
    runTurns(second);
    assert.deepEqual(first.getStats(), second.getStats());
  }
});

test("stats expose cost, signal and ttft consistently", () => {
  const llm = modeLlm("cqrs_duckdb_blackboard_o1");
  runTurns(llm);
  const stats = llm.getStats();
  assert.equal(stats.totalTokens, stats.inputTokens + stats.outputTokens);
  assert.equal(stats.costUsd, stats.totalTokens * 0.00003);
  assert.ok(stats.signalPct > 0 && stats.signalPct <= 100);
  assert.ok(stats.ttftMs > 0);
});

test("promptSizeCap and maxExecutionSteps are honored in contextMode", () => {
  const capped = new MockLLM("naive", 7, { contextMode: "raw_json_80k_flood", promptSizeCap: 1000 });
  runTurns(capped);
  assert.equal(capped.getStats().turn10Tokens, 1000);
  const limited = new MockLLM("naive", 7, { contextMode: "cqrs_duckdb_blackboard_o1", maxExecutionSteps: 3 });
  assert.throws(() => runTurns(limited), RangeError);
});

test("emitTraceSpans emits model_call events with required attrs", () => {
  const llm = modeLlm("lossy_llm_summary");
  runTurns(llm, 3);
  const sim = new Sim(1);
  const parent = sim.emit("root", "c1");
  llm.emitTraceSpans(sim, parent);
  const calls = sim.log.filter((event) => event.kind === "model_call");
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.parent, parent);
    assert.equal(call.data.model, "mock-llm");
    assert.equal(typeof call.data.tokens_in, "number");
    assert.equal(typeof call.data.tokens_out, "number");
    assert.equal(typeof call.data.cost, "number");
    assert.match(String(call.data.input_hash), /^[0-9a-f]{64}$/);
    assert.match(String(call.data.output_hash), /^[0-9a-f]{64}$/);
  }
});
