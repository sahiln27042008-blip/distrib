import test from "node:test";
import assert from "node:assert/strict";
import { Sim } from "../../src/kernel.ts";
import { MockProcessSupervisor, type IsolationMode } from "../../src/physics/mock-process-supervisor.ts";

function drive(mode: IsolationMode, calls = 10): MockProcessSupervisor {
  const sup = new MockProcessSupervisor({ isolationMode: mode });
  for (let i = 0; i < calls; i++) sup.callTool({ sigsegv: i === 0 });
  return sup;
}

test("default constructor keeps old failNative behavior (naive)", () => {
  const sup = new MockProcessSupervisor();
  const r = sup.failNative("naive");
  assert.deepEqual(r, { hostState: "crashed", workerId: "main-host", contained: false });
  assert.equal(sup.hostState, "crashed");
  assert.equal(sup.workerState, "idle");
  assert.equal(sup.mainHostCrashes, 1);
  assert.equal(sup.containedWorkerCrashes, 0);
});

test("default constructor keeps old failNative behavior (resilient) and reset", () => {
  const sup = new MockProcessSupervisor({});
  const r = sup.failNative("resilient");
  assert.deepEqual(r, { hostState: "online", workerId: "native-worker-1", contained: true });
  assert.equal(sup.hostState, "online");
  assert.equal(sup.workerState, "crashed");
  assert.equal(sup.mainHostCrashes, 0);
  assert.equal(sup.containedWorkerCrashes, 1);
  sup.reset();
  assert.equal(sup.workerState, "idle");
  assert.equal(sup.containedWorkerCrashes, 0);
  assert.equal(sup.toolCallsAllowed, 0);
});

test("god_mode_main_thread: SIGSEGV crashes host", () => {
  const sup = new MockProcessSupervisor({ isolationMode: "god_mode_main_thread" });
  sup.callTool({ sigsegv: true });
  const s = sup.getStats();
  assert.ok(s.mainHostCrashes >= 1);
  assert.equal(s.containedWorkerCrashes, 0);
  assert.equal(sup.hostState, "crashed");
});

test("state_leases_ipc_worker: SIGSEGV contained to worker", () => {
  const sup = new MockProcessSupervisor({ isolationMode: "state_leases_ipc_worker" });
  sup.callTool({ sigsegv: true });
  const s = sup.getStats();
  assert.ok(s.containedWorkerCrashes >= 1);
  assert.equal(s.mainHostCrashes, 0);
  assert.equal(sup.hostState, "online");
  assert.equal(sup.workerState, "crashed");
});

test("state_leases_ipc_worker blocks injection attempts; god_mode lets them through", () => {
  const leased = new MockProcessSupervisor({ isolationMode: "state_leases_ipc_worker" });
  leased.callTool({ injection: true });
  assert.equal(leased.getStats().injectionAttempts, 1);
  assert.equal(leased.getStats().injectionBlocked, 1);
  const god = new MockProcessSupervisor({ isolationMode: "god_mode_main_thread" });
  god.callTool({ injection: true });
  assert.equal(god.getStats().injectionBlocked, 0);
});

test("walled_garden: all tool calls blocked, no crashes", () => {
  const sup = drive("walled_garden");
  const s = sup.getStats();
  assert.ok(s.toolCallsBlocked > 0);
  assert.equal(s.toolCallsBlocked, 10);
  assert.equal(s.toolCallsAllowed, 0);
  assert.equal(s.mainHostCrashes, 0);
  assert.equal(s.containedWorkerCrashes, 0);
});

test("hitl_fatigue: roughly half of tool calls blocked", () => {
  const sup = new MockProcessSupervisor({ isolationMode: "hitl_fatigue" });
  for (let i = 0; i < 100; i++) sup.callTool();
  const s = sup.getStats();
  assert.ok(s.toolCallsBlocked >= 40 && s.toolCallsBlocked <= 60, `blocked=${s.toolCallsBlocked}`);
  assert.equal(s.toolCallsAllowed + s.toolCallsBlocked, 100);
});

test("determinism: same config + seed gives deepEqual stats and events", () => {
  const run = (): { stats: unknown; log: unknown } => {
    const sim = new Sim(7);
    const sup = drive("state_leases_ipc_worker");
    sup.emitTraceSpans(sim);
    return { stats: sup.getStats(), log: sim.log };
  };
  assert.deepEqual(run(), run());
});

test("emitTraceSpans emits worker.exit / main_host.crashed with isolation_mode, once", () => {
  const sim = new Sim(1);
  const contained = drive("state_leases_ipc_worker");
  contained.emitTraceSpans(sim, "e0");
  contained.emitTraceSpans(sim, "e0");
  const exits = sim.log.filter((e) => e.kind === "worker.exit");
  assert.equal(exits.length, 1);
  assert.equal(exits[0]!.data.isolation_mode, "state_leases_ipc_worker");

  const sim2 = new Sim(1);
  drive("god_mode_main_thread").emitTraceSpans(sim2);
  const crash = sim2.log.find((e) => e.kind === "process.main_host.crashed");
  assert.ok(crash);
  assert.equal(crash.data.isolation_mode, "god_mode_main_thread");
});
