import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MATRIX_PRESETS } from "../src/matrix-copy.ts";
import { selectPhysics } from "../src/scientist/physics-selector.ts";
import { detectPhysicsGaps } from "../src/scientist/physics-gap-detector.ts";
import { runAdaptiveFlow } from "../src/scientist/adaptive-flow.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

test("Case Cloudflare 2025-11-18 - Files existence and integrity check", () => {
  const publicEvidencePath = path.join(here, "public-evidence.json");
  const hiddenOutcomePath = path.join(here, "hidden-outcome.json");
  const predictionPath = path.join(here, "prediction.json");
  const reportPath = path.join(here, "experiment-report.md");

  assert.ok(fs.existsSync(publicEvidencePath), "public-evidence.json must exist");
  assert.ok(fs.existsSync(hiddenOutcomePath), "hidden-outcome.json must exist");
  assert.ok(fs.existsSync(predictionPath), "prediction.json must exist");
  assert.ok(fs.existsSync(reportPath), "experiment-report.md must exist");
});

test("Case Cloudflare 2025-11-18 - Public evidence blindness verification", () => {
  const publicEvidence = JSON.parse(
    fs.readFileSync(path.join(here, "public-evidence.json"), "utf8"),
  );

  const text = JSON.stringify(publicEvidence).toLowerCase();
  assert.ok(!text.includes("postmortem"), "Must not contain postmortem");
  assert.ok(!text.includes("root cause"), "Must not contain root cause");
  assert.ok(!text.includes("502"), "Must not contain 502 status code");
  assert.ok(!text.includes("outage"), "Must not contain outage label in evidence");
  assert.ok(!text.includes("panic"), "Must not leak panic");
  assert.ok(!text.includes("buffer overflow"), "Must not leak buffer overflow");
});

test("Case Cloudflare 2025-11-18 - P4 Adaptive Physics Selection & Gap Detection", async () => {
  const publicEvidence = JSON.parse(
    fs.readFileSync(path.join(here, "public-evidence.json"), "utf8"),
  );
  const arch = publicEvidence.architecture;
  const description = [
    publicEvidence.system_name,
    "Domain: " + publicEvidence.domain,
    "Actors:",
    ...arch.actors.map((a: any) => `- ${a.name}: ${a.role ?? ""} ${a.documented_behavior ?? ""} ${a.in_memory_limits ?? ""}`),
    "Limits and Constraints:",
    ...arch.stated_limits_and_constraints.map((l: string) => `- ${l}`),
    "Physical Assumptions:",
    ...arch.physical_assumptions.map((p: string) => `- ${p}`),
  ].join("\n");

  const baseConfig = {
    ...MATRIX_PRESETS.double_charge_2ms_drop!,
    seed: 42,
    runId: "cf-blind-test",
    B: "B5_in_doubt_zombie_tx" as const,
    D: "D4_unmapped_schema_drift" as const,
  };

  // 1. Selector must NOT select payment physics (zero false positives)
  const selection = await selectPhysics(baseConfig, description);
  const selectedIds = selection.selected.map((s) => s.primitiveId);
  assert.ok(!selectedIds.includes("payment.idempotency"), "Must not select payment.idempotency");
  assert.ok(!selectedIds.includes("transaction.partial_commit"), "Must not select transaction.partial_commit");

  // 2. Gap detector must identify missing bounded resource consumer
  const gaps = detectPhysicsGaps(baseConfig, selection.selected, description);
  assert.equal(gaps.hasGap, true, "Gap detector must trigger on unmodeled physical bounds");
  assert.ok(
    gaps.missingMechanisms.some((m) =>
      m.description.toLowerCase().includes("bounded resource consumer"),
    ),
    "Must detect missing bounded resource consumer mechanism",
  );

  // 3. Adaptive flow must return INSUFFICIENT_PHYSICS without inventing a failure
  const flowResult = await runAdaptiveFlow(
    baseConfig,
    ["r11", "r04-network-idempotency", "r05-distributed-sagas", "r10-unit-economics"],
    100,
    description,
  );
  assert.equal(flowResult.status, "INSUFFICIENT_PHYSICS");
  if (flowResult.status === "INSUFFICIENT_PHYSICS") {
    assert.ok(flowResult.missingMechanisms.length > 0);
    assert.ok(flowResult.proposedPhysics.length > 0);
  }
});

test("Case Cloudflare 2025-11-18 - Deterministic Replay byte-identical verification", async () => {
  const publicEvidence = JSON.parse(
    fs.readFileSync(path.join(here, "public-evidence.json"), "utf8"),
  );
  const arch = publicEvidence.architecture;
  const description = [
    publicEvidence.system_name,
    "Domain: " + publicEvidence.domain,
    "Actors:",
    ...arch.actors.map((a: any) => `- ${a.name}: ${a.role ?? ""} ${a.documented_behavior ?? ""} ${a.in_memory_limits ?? ""}`),
    "Limits and Constraints:",
    ...arch.stated_limits_and_constraints.map((l: string) => `- ${l}`),
    "Physical Assumptions:",
    ...arch.physical_assumptions.map((p: string) => `- ${p}`),
  ].join("\n");

  const baseConfig = {
    ...MATRIX_PRESETS.double_charge_2ms_drop!,
    seed: 42,
    runId: "cf-det-check",
    B: "B5_in_doubt_zombie_tx" as const,
    D: "D4_unmapped_schema_drift" as const,
  };

  const run1 = await runAdaptiveFlow(baseConfig, ["r11", "r04-network-idempotency"], 100, description);
  const run2 = await runAdaptiveFlow(baseConfig, ["r11", "r04-network-idempotency"], 100, description);

  assert.equal(JSON.stringify(run1), JSON.stringify(run2), "Repeated runs must be byte-identical");
});

