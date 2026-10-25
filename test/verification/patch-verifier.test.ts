import test from "node:test";
import assert from "node:assert/strict";
import { verifyPatch } from "../../src/verification/patch-verifier.ts";
import { MATRIX_PRESETS, type MatrixConfig } from "../../src/matrix-copy.ts";
import type { CodePatch } from "../../src/repair/patch-types.ts";

const originalR04Config: MatrixConfig = {
  ...MATRIX_PRESETS.double_charge_2ms_drop,
  seed: 42,
  runId: "verify-r04",
  C: "C5_legacy_erp_no_idem",
  F: "F1_blind_retry_unbounded_spend",
};

const validR04Patch: CodePatch = {
  id: "patch-r04-1",
  ruleId: "r04-network-idempotency",
  findingId: "span-1",
  description: "Add stable idempotency key derived from refund operation ID",
  diff: "--- a/src/refund.ts\n+++ b/src/refund.ts\n@@ -45,6 +45,10 @@\n+  idempotency_key: idempotencyKey,",
  affectedFile: "src/refund.ts",
  changedLines: 5,
  explanation: "Generates a stable key ensuring retries are idempotent.",
  dialEquivalent: {
    dial: "C",
    from: "C5_legacy_erp_no_idem",
    to: "C1_clean_20ms",
  },
};

const nonFixingPatch: CodePatch = {
  id: "patch-noop-1",
  ruleId: "r04-network-idempotency",
  findingId: "span-1",
  description: "No-op patch that does not fix the idempotency violation",
  diff: "--- a/src/refund.ts\n+++ b/src/refund.ts\n",
  affectedFile: "src/refund.ts",
  changedLines: 0,
  explanation: "Does nothing.",
  dialEquivalent: {
    dial: "C",
    from: "C5_legacy_erp_no_idem",
    to: "C5_legacy_erp_no_idem",
  },
};

test("verifyPatch for R04 (C5→C1) returns isFixed=true", async () => {
  const result = await verifyPatch(validR04Patch, originalR04Config);
  assert.equal(result.isFixed, true);
  assert.equal(result.findingRuleId, "r04-network-idempotency");
});

test("verifyPatch returns before/after business impact", async () => {
  const result = await verifyPatch(validR04Patch, originalR04Config);
  assert.ok(typeof result.beforeBusinessImpact === "string");
  assert.ok(typeof result.afterBusinessImpact === "string");
  assert.ok(result.beforeBusinessImpact.length > 0);
});

test("verifyPatch returns proof string", async () => {
  const result = await verifyPatch(validR04Patch, originalR04Config);
  assert.ok(typeof result.proof === "string");
  assert.ok(result.proof.includes("Fix verified"));
  assert.ok(result.proof.includes(validR04Patch.description));
});

test("verifyPatch returns replay handle", async () => {
  const result = await verifyPatch(validR04Patch, originalR04Config);
  assert.ok(result.replayHandle);
  assert.equal(result.replayHandle.seed, (result.fixedConfig as MatrixConfig).seed);
  assert.ok(result.replayHandle.config);
});

test("verifyPatch with non-fixing patch returns isFixed=false", async () => {
  const result = await verifyPatch(nonFixingPatch, originalR04Config);
  assert.equal(result.isFixed, false);
  assert.ok(result.proof.includes("did NOT resolve"));
});

test("verifyPatch includes beforeFindings and afterFindings counts", async () => {
  const result = await verifyPatch(validR04Patch, originalR04Config);
  assert.ok(typeof result.beforeFindings === "number");
  assert.ok(typeof result.afterFindings === "number");
  assert.ok(result.beforeFindings > 0);
  assert.equal(result.afterFindings, 0);
});

test("verifyPatch for R04: before has duplicateDollars, after has 0", async () => {
  const result = await verifyPatch(validR04Patch, originalR04Config);
  assert.ok(result.beforeBusinessImpact.includes("duplicate charges"));
  assert.ok(!result.afterBusinessImpact.includes("duplicate charges"));
});

