import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScientist } from "../../src/scientist/discovery-loop.ts";
import type { ScientistConfig } from "../../src/scientist/types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const caseDir = path.join(here, "cases", "case-001");

test("Case 001 - Files existence and integrity check", () => {
  const publicEvidencePath = path.join(caseDir, "public-evidence.json");
  const hiddenOutcomePath = path.join(caseDir, "hidden-outcome.json");
  const predictionPath = path.join(caseDir, "prediction.json");
  const reportPath = path.join(caseDir, "experiment-report.md");

  assert.ok(fs.existsSync(publicEvidencePath), "public-evidence.json must exist");
  assert.ok(fs.existsSync(hiddenOutcomePath), "hidden-outcome.json must exist");
  assert.ok(fs.existsSync(predictionPath), "prediction.json must exist");
  assert.ok(fs.existsSync(reportPath), "experiment-report.md must exist");
});

test("Case 001 - Public evidence blindness verification", () => {
  const publicEvidence = JSON.parse(
    fs.readFileSync(path.join(caseDir, "public-evidence.json"), "utf8"),
  );

  // Assert no leakage of incident outcome keywords
  const text = JSON.stringify(publicEvidence).toLowerCase();
  assert.ok(!text.includes("postmortem"), "Must not contain postmortem");
  assert.ok(!text.includes("root cause"), "Must not contain root cause");
  assert.ok(!text.includes("502"), "Must not contain outage status codes");
  assert.ok(!text.includes("2020-11-02"), "Must not contain incident date");
  assert.ok(!text.includes("outage"), "Must not contain outage label");
});

test("Case 001 - Scientist execution on reconstructed pre-incident architecture", async () => {
  const config: ScientistConfig = {
    baseConfig: {
      seed: 42,
      runId: "blind-cf-eval",
      A: "A4_bulk_crm_swarm",
      B: "B3_write_amp_15mb",
      C: "C1_clean_20ms",
      D: "D1_raw_json_80k_flood",
      E: "E1_god_mode_main_thread",
      F: "F1_blind_retry_unbounded_spend",
      humanUsers: 50,
      concurrentAgents: 5,
      dbPoolSize: 20,
      workflowSteps: 10,
      saasPriceUsd: 20,
      ticketValueUsd: 5,
    },
    maxExperiments: 4,
    maxSteps: 10000,
    invariants: [
      "r11",
      "r04-network-idempotency",
      "r05-distributed-sagas",
      "r10-unit-economics",
    ],
  };

  const result = await runScientist(config);

  // Verify that the system ran the experiments independently
  assert.equal(result.experimentsRun, 4);

  // Discovered failure identified via automated exploration
  assert.equal(result.discoveredFailures.length, 1);

  // Prediction recorded reflects this reality honestly
  const prediction = JSON.parse(
    fs.readFileSync(path.join(caseDir, "prediction.json"), "utf8"),
  );
  assert.equal(prediction.discovered_failures.length, 1);
  assert.ok(prediction.prediction.includes("FAILURE_FOUND"));
});

