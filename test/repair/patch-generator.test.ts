import test from "node:test";
import assert from "node:assert/strict";
import { generatePatch } from "../../src/repair/patch-generator.ts";
import { MATRIX_PRESETS, type MatrixConfig } from "../../src/matrix-copy.ts";
import type { Finding } from "../../../../resilient-agent-invariants/src/types/finding.ts";

const baseConfig: MatrixConfig = {
  ...MATRIX_PRESETS.double_charge_2ms_drop,
  seed: 42,
  runId: "test-repair",
  C: "C5_legacy_erp_no_idem",
  F: "F1_blind_retry_unbounded_spend",
};

test("generatePatch for R04 returns patch with idempotency key diff", async () => {
  const finding: Finding = {
    rule_id: "r04-network-idempotency",
    pillar: "P02",
    status: "proven",
    severity: "critical",
    message: "POST non-idempotent call retried",
    evidence: { span_ids: ["span-r04-1"] },
    repro: "run with C5 + F1",
    suggested_fix: "Use idempotent endpoint (C1)",
  };

  const patch = await generatePatch(
    finding,
    "ERP retried without idempotency key causing double-charge.",
    baseConfig,
  );

  assert.equal(patch.ruleId, "r04-network-idempotency");
  assert.ok(patch.diff.includes("idempotency_key") || patch.diff.includes("idempotencyKey"));
  assert.ok(patch.description.toLowerCase().includes("idempotency"));
  assert.equal(patch.dialEquivalent.dial, "C");
  assert.equal(patch.dialEquivalent.to, "C1_clean_20ms");
});

test("generatePatch for R05 returns patch with LIFO compensation diff", async () => {
  const finding: Finding = {
    rule_id: "r05-distributed-sagas",
    pillar: "P03",
    status: "proven",
    severity: "critical",
    message: "Orphaned resources left after saga failure",
    evidence: { span_ids: ["span-r05-1"] },
    repro: "run with F2",
    suggested_fix: "Apply LIFO saga compensation",
  };

  const patch = await generatePatch(
    finding,
    "Saga compensation did not run in reverse order.",
    baseConfig,
  );

  assert.equal(patch.ruleId, "r05-distributed-sagas");
  assert.ok(patch.diff.includes("reverse()") || patch.diff.includes("LIFO"));
  assert.ok(patch.description.toLowerCase().includes("lifo"));
  assert.equal(patch.dialEquivalent.dial, "F");
  assert.equal(patch.dialEquivalent.to, "F3_resilient_invariant_runtime");
});

test("generatePatch for R10 returns patch with budget envelope diff", async () => {
  const finding: Finding = {
    rule_id: "r10-unit-economics",
    pillar: "P04",
    status: "proven",
    severity: "critical",
    message: "Compute cost exceeded budget limit",
    evidence: { span_ids: ["span-r10-1"] },
    repro: "run with F1",
    suggested_fix: "Add budget envelope",
  };

  const patch = await generatePatch(
    finding,
    "No budget envelope was enforced during retry storm.",
    baseConfig,
  );

  assert.equal(patch.ruleId, "r10-unit-economics");
  assert.ok(patch.diff.includes("BUDGET_USD") || patch.diff.includes("0.25"));
  assert.ok(patch.description.toLowerCase().includes("budget"));
  assert.equal(patch.dialEquivalent.dial, "F");
  assert.equal(patch.dialEquivalent.to, "F3_resilient_invariant_runtime");
});

test("Patch includes dialEquivalent mapping", async () => {
  const finding: Finding = {
    rule_id: "r04-network-idempotency",
    pillar: "P02",
    status: "proven",
    severity: "critical",
    message: "POST non-idempotent call retried",
    evidence: { span_ids: ["span-123"] },
    repro: "run with C5 + F1",
    suggested_fix: "Use idempotent endpoint (C1)",
  };

  const patch = await generatePatch(finding, "No idempotency key", baseConfig);
  assert.ok(patch.dialEquivalent);
  assert.equal(patch.dialEquivalent.dial, "C");
  assert.equal(patch.dialEquivalent.from, "C5_legacy_erp_no_idem");
  assert.equal(patch.dialEquivalent.to, "C1_clean_20ms");
});

test("Patch includes affectedFile and changedLines", async () => {
  const finding: Finding = {
    rule_id: "r04-network-idempotency",
    pillar: "P02",
    status: "proven",
    severity: "critical",
    message: "POST non-idempotent call retried",
    evidence: { span_ids: ["span-123"] },
    repro: "run with C5 + F1",
    suggested_fix: "Use idempotent endpoint (C1)",
  };

  const patch = await generatePatch(finding, "No idempotency key", baseConfig);
  assert.equal(patch.affectedFile, "src/refund.ts");
  assert.ok(typeof patch.changedLines === "number");
  assert.ok(patch.changedLines > 0);
});

test("Patch includes explanation grounded in finding evidence", async () => {
  const finding: Finding = {
    rule_id: "r04-network-idempotency",
    pillar: "P02",
    status: "proven",
    severity: "critical",
    message: "POST non-idempotent call retried",
    evidence: { span_ids: ["span-evidence-99"] },
    repro: "run with C5 + F1",
    suggested_fix: "Use idempotent endpoint (C1)",
  };

  const patch = await generatePatch(finding, "Retry path without idempotency key", baseConfig);
  assert.ok(typeof patch.explanation === "string");
  assert.ok(patch.explanation.length > 10);
  assert.equal(patch.findingId, "span-evidence-99");
});

test("Determinism: same finding + config → same patch (mock)", async () => {
  const finding: Finding = {
    rule_id: "r04-network-idempotency",
    pillar: "P02",
    status: "proven",
    severity: "critical",
    message: "POST non-idempotent call retried",
    evidence: { span_ids: ["span-det-1"] },
    repro: "run with C5 + F1",
    suggested_fix: "Use idempotent endpoint (C1)",
  };

  const patch1 = await generatePatch(finding, "Explanation test", baseConfig);
  const patch2 = await generatePatch(finding, "Explanation test", baseConfig);

  assert.deepEqual(patch1, patch2);
});

