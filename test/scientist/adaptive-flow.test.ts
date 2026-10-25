import test from "node:test";
import assert from "node:assert/strict";
import { MATRIX_PRESETS, type MatrixConfig } from "../../src/matrix-copy.ts";
import { composeExperiments } from "../../src/scientist/experiment-composer.ts";
import { runAdaptiveFlow } from "../../src/scientist/adaptive-flow.ts";
import { selectPhysics } from "../../src/scientist/physics-selector.ts";

test("adaptive flow discovers a failure in a legacy payment configuration", async () => {
  const config: MatrixConfig = {
    ...MATRIX_PRESETS.double_charge_2ms_drop!,
    C: "C5_legacy_erp_no_idem" as const,
    F: "F1_blind_retry_unbounded_spend" as const,
  };
  const result = await runAdaptiveFlow(config, ["r04-network-idempotency"], 3);
  assert.equal(result.status, "FAILURE_FOUND");
  if (result.status === "FAILURE_FOUND") assert.ok(result.experimentsRun <= 3);
});

test("adaptive flow respects experiment budget", async () => {
  const result = await runAdaptiveFlow(
    MATRIX_PRESETS.double_charge_2ms_drop!,
    ["r04-network-idempotency", "r05-distributed-sagas", "r10-unit-economics"],
    1,
  );
  assert.ok(result.status !== "INSUFFICIENT_PHYSICS");
  assert.ok(result.experimentsRun <= 1);
});

test("composer creates stable, targeted experiments within budget", async () => {
  const config: MatrixConfig = MATRIX_PRESETS.double_charge_2ms_drop!;
  const selection = await selectPhysics(config, "Stripe payment service with background workers.");
  const first = composeExperiments(config, selection.selected, ["r04-network-idempotency"], 2);
  const second = composeExperiments(config, selection.selected, ["r04-network-idempotency"], 2);
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((experiment) => experiment.id), second.map((experiment) => experiment.id));
  assert.deepEqual(first.map((experiment) => experiment.primitiveIds), second.map((experiment) => experiment.primitiveIds));
  assert.ok(first.every((experiment) => experiment.interventions.length > 0));
});

test("identical adaptive runs use the same seed and experiment sequence", async () => {
  const config: MatrixConfig = { ...MATRIX_PRESETS.double_charge_2ms_drop!, seed: 42 };
  const selection1 = await selectPhysics(config, "Stripe payment service");
  const selection2 = await selectPhysics(config, "Stripe payment service");
  assert.deepEqual(selection1.selected, selection2.selected);
});