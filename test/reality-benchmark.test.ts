import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { runRealityBenchmark } from "../scripts/reality-benchmark.ts";
import fixtures from "./reality-benchmark/fixtures/index.ts";

const fixtureMap = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

function assertObservedValues(obj: Record<string, unknown>) {
  for (const value of Object.values(obj)) {
    if (typeof value === "number") {
      assert.ok(Number.isFinite(value), `Expected finite numeric observed value, got ${String(value)}`);
      continue;
    }
    if (value === null || typeof value === "string") {
      continue;
    }
    assert.fail(`Observed field used a non-number / non-string value: ${String(value)}`);
  }
}

test("A. FIXTURE_LOAD: all fixtures load and contain valid observed values", () => {
  assert.equal(fixtures.length, 6);
  for (const fixture of fixtures) {
    assert.ok(fixture.id);
    assert.ok(fixture.source?.url);
    assert.ok(fixture.observed);
    assert.ok(fixture.reconstruction);
    assert.ok(fixture.expected);
    assertObservedValues(fixture.observed as Record<string, unknown>);
  }
});

test("B. HONEST_MODEL_GAP_REPORTING", async () => {
  const report = await runRealityBenchmark();
  const github = report.incidents.find((incident) => incident.id === "github-2018-mysql-partition");
  const stripe = report.incidents.find((incident) => incident.id === "stripe-double-charge");
  const gitlab = report.incidents.find((incident) => incident.id === "gitlab-database-deletion");
  assert.ok(github, "GitHub fixture must appear in the report");
  assert.ok(stripe, "Stripe fixture must appear in the report");
  assert.ok(gitlab, "GitLab fixture must appear in the report");
  assert.equal(report.totalIncidents, 6);
  assert.equal(report.predictionAccuracy, 0.8);
  assert.equal(report.reproducedCount, 4);
  assert.equal(report.modelGapCount, 1);
  assert.ok(report.modelGapCount >= 1, "At least one fixture should be classified as a model gap");
  assert.ok(report.reproducedCount >= 0 && report.reproducedCount <= report.totalIncidents, "Reproduced count must stay within credible bounds");
  assert.equal(report.partialReproductionCount, 1);
  assert.equal(report.falseNegativeCount, report.totalIncidents - report.modelGapCount - report.reproducedCount - report.partialReproductionCount - report.falsePositiveCount);
  const cloudflare = report.incidents.find((incident) => incident.id === "cloudflare-edge-proxy-overflow");
  const aws = report.incidents.find((incident) => incident.id === "aws-dynamodb-us-east-1-overload");
  const knight = report.incidents.find((incident) => incident.id === "knight-capital-retry-storm");
  assert.equal(cloudflare.reproduced, true);
  assert.equal(cloudflare.actualRuleId, "native-lease-capacity-overflow");
  assert.equal(aws.reproduced, true);
  assert.equal(aws.actualRuleId, "native-channel-cascade");
  assert.equal(github.partialReproduction, true);
  assert.equal(github.actualRuleId, "r04-network-idempotency");
  assert.equal(cloudflare.modelGap, false);
  assert.equal(aws.modelGap, false);
  assert.equal(knight.reproduced, true);
  assert.equal(knight.modelGap, false);
  assert.equal(knight.actualRuleId, "native-cost-burn");
});

test("C. MODEL_GAP_GITLAB", async () => {
  const report = await runRealityBenchmark();
  const gitlab = report.incidents.find((incident) => incident.id === "gitlab-database-deletion");
  assert.ok(gitlab, "GitLab fixture must appear in the report");
  assert.equal(gitlab.modelGap, true);
  assert.match(gitlab.notes, /MODEL_GAP|not representable|human-initiated/i);
});

test("D. ACCURACY_REPORT", async () => {
  const report = await runRealityBenchmark();
  assert.equal(report.totalIncidents, 6);
  assert.ok(Number.isFinite(report.predictionAccuracy));
  assert.ok(report.predictionAccuracy >= 0 && report.predictionAccuracy <= 1);
  assert.equal(
    report.predictionAccuracy,
    Number((report.reproducedCount / Math.max(1, report.totalIncidents - report.modelGapCount)).toFixed(4)),
    "Accuracy should equal the honest reproduction ratio for representable incidents",
  );
  assert.equal(report.reproducedCount, report.incidents.filter((incident) => incident.reproduced).length);
  assert.equal(report.partialReproductionCount, report.incidents.filter((incident) => incident.partialReproduction).length);
  assert.ok(report.modelGapHonestCount >= 1);
  const jsonPath = "test/reality-benchmark-results.json";
  assert.ok(existsSync(jsonPath), "Benchmark results JSON should be written");
});
