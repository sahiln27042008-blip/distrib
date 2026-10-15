import { test } from "node:test";
import assert from "node:assert/strict";
import { TopologyScenario, TOPOLOGY_PRESETS, type TopologyConfig } from "../src/topology.ts";

test("1. healthy preset -> zero findings in resilient mode", () => {
  const scenario = new TopologyScenario(TOPOLOGY_PRESETS.healthy);
  scenario.run();
  const s = scenario.snapshot();

  assert.equal(s.infra.db.timeouts, 0);
  assert.equal(s.infra.storage.frozenQueries, 0);
  assert.equal(s.infra.web.crashed, false);
  assert.equal(s.external.payment.duplicates, 0);
  assert.equal(s.external.payment.duplicateDollars, 0);
  assert.equal(s.external.cloud.orphaned, 0);
  assert.equal(s.external.crm.rateLimited, 0);
  assert.equal(s.external.erp.duplicateShipments, 0);
  assert.equal(s.clocks.causalityViolations, 0);
});

test("2. dbStarvation preset -> naive has timeouts, resilient doesn't", () => {
  const naive = new TopologyScenario({ ...TOPOLOGY_PRESETS.dbStarvation, mode: "naive" });
  naive.run();
  const naiveSnap = naive.snapshot();
  assert.ok(naiveSnap.infra.db.timeouts >= 12, `expected >= 12 timeouts, got ${naiveSnap.infra.db.timeouts}`);

  const resilient = new TopologyScenario({ ...TOPOLOGY_PRESETS.dbStarvation, mode: "resilient" });
  resilient.run();
  const resSnap = resilient.snapshot();
  assert.equal(resSnap.infra.db.timeouts, 0);
});

test("3. hostCrash preset -> naive crashes main host, resilient contains", () => {
  const naive = new TopologyScenario({ ...TOPOLOGY_PRESETS.hostCrash, mode: "naive" });
  naive.run();
  assert.equal(naive.snapshot().infra.web.crashed, true);

  const resilient = new TopologyScenario({ ...TOPOLOGY_PRESETS.hostCrash, mode: "resilient" });
  resilient.run();
  const resSnap = resilient.snapshot();
  assert.equal(resSnap.infra.web.crashed, false);
  const platformWf = resSnap.workflows.find((w) => w.department === "Platform");
  assert.equal(platformWf?.crashContained, true);
});

test("4. duplicateCharge preset -> naive has duplicate dollars, resilient zero", () => {
  const naive = new TopologyScenario({ ...TOPOLOGY_PRESETS.duplicateCharge, mode: "naive" });
  naive.run();
  assert.equal(naive.snapshot().external.payment.duplicateDollars, 600);

  const resilient = new TopologyScenario({ ...TOPOLOGY_PRESETS.duplicateCharge, mode: "resilient" });
  resilient.run();
  assert.equal(resilient.snapshot().external.payment.duplicateDollars, 0);
});

test("5. orphanedCloud preset -> naive leaks instances, resilient compensates", () => {
  const naive = new TopologyScenario({ ...TOPOLOGY_PRESETS.orphanedCloud, mode: "naive" });
  naive.run();
  assert.equal(naive.snapshot().external.cloud.orphaned, 4);
  assert.equal(naive.snapshot().external.cloud.orphanCostUsd, 1440);

  const resilient = new TopologyScenario({ ...TOPOLOGY_PRESETS.orphanedCloud, mode: "resilient" });
  resilient.run();
  assert.equal(resilient.snapshot().external.cloud.orphaned, 0);
  assert.equal(resilient.snapshot().external.cloud.orphanCostUsd, 0);
});

test("6. batchPoison preset -> naive triggers rate limits/partial failure, resilient stays clean", () => {
  const naive = new TopologyScenario({ ...TOPOLOGY_PRESETS.batchPoison, mode: "naive" });
  naive.run();
  assert.ok(naive.snapshot().external.crm.rateLimited > 0);

  const resilient = new TopologyScenario({ ...TOPOLOGY_PRESETS.batchPoison, mode: "resilient" });
  resilient.run();
  assert.equal(resilient.snapshot().external.crm.rateLimited, 0);
});

test("7. clockSkew preset -> naive has causality violations, resilient none", () => {
  const naive = new TopologyScenario({ ...TOPOLOGY_PRESETS.clockSkew, mode: "naive" });
  naive.run();
  assert.ok(naive.snapshot().clocks.causalityViolations > 0);

  const resilient = new TopologyScenario({ ...TOPOLOGY_PRESETS.clockSkew, mode: "resilient" });
  resilient.run();
  assert.equal(resilient.snapshot().clocks.causalityViolations, 0);
});

test("8. ntpJump preset -> naive has lease expirations, resilient none", () => {
  const naive = new TopologyScenario({ ...TOPOLOGY_PRESETS.ntpJump, mode: "naive" });
  naive.run();
  assert.ok(naive.snapshot().clocks.leaseExpiries > 0);

  const resilient = new TopologyScenario({ ...TOPOLOGY_PRESETS.ntpJump, mode: "resilient" });
  resilient.run();
  assert.equal(resilient.snapshot().clocks.leaseExpiries, 0);
});

test("9. erpDuplicate preset -> naive duplicates shipments, resilient none", () => {
  const naive = new TopologyScenario({ ...TOPOLOGY_PRESETS.erpDuplicate, mode: "naive" });
  naive.run();
  assert.equal(naive.snapshot().external.erp.duplicateShipments, 3);

  const resilient = new TopologyScenario({ ...TOPOLOGY_PRESETS.erpDuplicate, mode: "resilient" });
  resilient.run();
  assert.equal(resilient.snapshot().external.erp.duplicateShipments, 0);
});

test("10. fullChaos preset -> all failures present in naive, all resolved in resilient", () => {
  const naive = new TopologyScenario({ ...TOPOLOGY_PRESETS.fullChaos, mode: "naive" });
  naive.run();
  const n = naive.snapshot();
  assert.equal(n.infra.db.timeouts, 12);
  assert.equal(n.infra.storage.iopsUsed, 100);
  assert.equal(n.infra.storage.bytesWritten, 15000000);
  assert.equal(n.infra.web.crashed, true);
  assert.equal(n.totals.eventLoopFreezes, 3);
  assert.equal(n.external.payment.duplicateDollars, 600);
  assert.equal(n.external.cloud.orphaned, 4);
  assert.equal(n.external.crm.rateLimited, 47);
  assert.equal(n.external.erp.duplicateShipments, 3);
  assert.equal(n.clocks.causalityViolations, 15);
  assert.equal(n.clocks.leaseExpiries, 2);

  const resilient = new TopologyScenario({ ...TOPOLOGY_PRESETS.fullChaos, mode: "resilient" });
  resilient.run();
  const r = resilient.snapshot();
  assert.equal(r.infra.db.timeouts, 0);
  assert.equal(r.infra.storage.iopsUsed, 3);
  assert.equal(r.infra.storage.bytesWritten, 4096);
  assert.equal(r.infra.web.crashed, false);
  assert.equal(r.totals.eventLoopFreezes, 0);
  assert.equal(r.external.payment.duplicateDollars, 0);
  assert.equal(r.external.cloud.orphaned, 0);
  assert.equal(r.external.crm.rateLimited, 0);
  assert.equal(r.external.erp.duplicateShipments, 0);
  assert.equal(r.clocks.causalityViolations, 0);
  assert.equal(r.clocks.leaseExpiries, 0);
});

test("11. same seed + config -> byte-identical snapshot", () => {
  const run1 = new TopologyScenario({ mode: "naive", seed: 42, runId: "test-run" });
  run1.run();
  const snap1 = JSON.stringify(run1.snapshot());

  const run2 = new TopologyScenario({ mode: "naive", seed: 42, runId: "test-run" });
  run2.run();
  const snap2 = JSON.stringify(run2.snapshot());

  assert.equal(snap1, snap2);
});

test("12. different seeds -> different trace or identity", () => {
  const run1 = new TopologyScenario({ mode: "resilient", seed: 42, runId: "run-42" });
  run1.run();
  const snap1 = run1.snapshot();

  const run2 = new TopologyScenario({ mode: "resilient", seed: 99, runId: "run-99" });
  run2.run();
  const snap2 = run2.snapshot();

  assert.notEqual(snap1.runId, snap2.runId);
});

test("13. reset -> clean state, replay identical", () => {
  const scenario = new TopologyScenario(TOPOLOGY_PRESETS.fullChaos);
  scenario.run();
  const snap1 = JSON.stringify(scenario.snapshot());

  scenario.reset();
  scenario.run();
  const snap2 = JSON.stringify(scenario.snapshot());

  assert.equal(snap1, snap2);
});

test("14. presets are all valid configs", () => {
  for (const [name, preset] of Object.entries(TOPOLOGY_PRESETS)) {
    const sc = new TopologyScenario(preset);
    assert.ok(sc, `preset ${name} should construct`);
  }
});

test("15. snapshot is deep clone (mutations don't affect scenario)", () => {
  const scenario = new TopologyScenario(TOPOLOGY_PRESETS.healthy);
  scenario.run();
  const snap1 = scenario.snapshot();
  snap1.infra.db.timeouts = 999;
  snap1.workflows[0]!.status = "failed";

  const snap2 = scenario.snapshot();
  assert.equal(snap2.infra.db.timeouts, 0);
  assert.equal(snap2.workflows[0]!.status, "succeeded");
});

