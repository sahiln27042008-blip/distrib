import assert from "node:assert/strict";
import test from "node:test";
import { FIXED_BASELINE_SEQUENCES, BUDGET } from "../scripts/phase5-benchmark.ts";
import { INTERVENTIONS } from "../src/interventions/primitives.ts";
import { blindCases } from "./phase5-benchmark-cases.ts";

test("blind cases contain no answer labels or case-specific baseline actions", () => {
  for (const testCase of blindCases) {
    assert.equal("invariant" in testCase, false);
    assert.equal("baselineInterventionKeys" in testCase, false);
  }
});

test("fixed baseline uses the same valid sequences within the Scientist budget", () => {
  assert.equal(FIXED_BASELINE_SEQUENCES.length, BUDGET);
  for (const sequence of FIXED_BASELINE_SEQUENCES) {
    assert.ok(sequence.length > 0);
    for (const key of sequence) {
      assert.ok(key in INTERVENTIONS, `baseline intervention ${key} is registered`);
    }
  }
  assert.equal(new Set(FIXED_BASELINE_SEQUENCES.map((sequence) => JSON.stringify(sequence))).size, BUDGET);
});
