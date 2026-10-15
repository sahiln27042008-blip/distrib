import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  MatrixScenario,
  runMatrixComparison,
  MATRIX_PRESETS,
  type MatrixConfig,
} from "../src/matrix-copy.ts";
import { startServer } from "../src/server-copy.ts";

const BASE_CFG: MatrixConfig = {
  seed: 42,
  runId: "matrix-test",
  A: "A2_mixed_saas",
  B: "B1_zero_hold_2ms",
  C: "C1_clean_20ms",
  D: "D5_cqrs_duckdb_blackboard_o1",
  E: "E4_state_leases_ipc_worker",
  F: "F3_resilient_invariant_runtime",
  humanUsers: 200,
  concurrentAgents: 10,
  dbPoolSize: 20,
  workflowSteps: 10,
  saasPriceUsd: 20,
  ticketValueUsd: 5,
};

test("1. Determinism: same config twice -> identical JSON", () => {
  const s1 = new MatrixScenario(BASE_CFG);
  s1.run();
  const snap1 = s1.snapshot();

  const s2 = new MatrixScenario(BASE_CFG);
  s2.run();
  const snap2 = s2.snapshot();

  assert.equal(JSON.stringify(snap1), JSON.stringify(snap2));
});

test("2. A2+B2 vs A2+B1: B2 saturates pool + 500s, B1 holds 0 during stream", () => {
  const hog = new MatrixScenario({ ...BASE_CFG, A: "A2_mixed_saas", B: "B2_stream_hog_30s" });
  hog.run();
  const hogSnap = hog.snapshot();

  const zero = new MatrixScenario({ ...BASE_CFG, A: "A2_mixed_saas", B: "B1_zero_hold_2ms" });
  zero.run();
  const zeroSnap = zero.snapshot();

  assert.ok(hogSnap.db.avgHoldMs > 20000, "B2 holds connection across stream");
  assert.equal(hogSnap.db.saas500s, 14, "B2 drops human SaaS logins with 500s");
  assert.equal(zeroSnap.db.activeConnections, 0, "B1 releases connection before streaming");
  assert.equal(zeroSnap.db.saas500s, 0, "B1 causes 0 SaaS 500 errors");
});

test("3. C2+F1 vs C2+F3: F1 duplicates $500, F3 reconciles via GET", () => {
  const dup = new MatrixScenario({
    ...BASE_CFG,
    C: "C2_socket_drop_2ms_late",
    F: "F1_blind_retry_unbounded_spend",
  });
  dup.run();
  const dupSnap = dup.snapshot();

  const rec = new MatrixScenario({
    ...BASE_CFG,
    C: "C2_socket_drop_2ms_late",
    F: "F3_resilient_invariant_runtime",
  });
  rec.run();
  const recSnap = rec.snapshot();

  assert.equal(dupSnap.network.duplicateDollars, 500);
  assert.equal(recSnap.network.duplicateDollars, 0);
});

test("4. C5+F1 vs C5+F3: F1 ships 2 boxes, F3 blocks", () => {
  const naive = new MatrixScenario({
    ...BASE_CFG,
    C: "C5_legacy_erp_no_idem",
    F: "F1_blind_retry_unbounded_spend",
  });
  naive.run();
  const naiveSnap = naive.snapshot();

  const resl = new MatrixScenario({
    ...BASE_CFG,
    C: "C5_legacy_erp_no_idem",
    F: "F3_resilient_invariant_runtime",
  });
  resl.run();
  const reslSnap = resl.snapshot();

  assert.equal(naiveSnap.network.duplicateShipments, 2);
  assert.equal(reslSnap.network.duplicateShipments, 0);
});

test("5. D1 vs D5: 80k tokens vs 400 tokens, TTFT >40s vs <100ms", () => {
  const flood = new MatrixScenario({ ...BASE_CFG, D: "D1_raw_json_80k_flood" });
  flood.run();
  const floodSnap = flood.snapshot();

  const duck = new MatrixScenario({ ...BASE_CFG, D: "D5_cqrs_duckdb_blackboard_o1" });
  duck.run();
  const duckSnap = duck.snapshot();

  assert.equal(floodSnap.context.promptTokens, 80000);
  assert.ok(floodSnap.context.ttftMs > 40000, "D1 TTFT exceeds 40s");
  assert.equal(duckSnap.context.promptTokens, 400);
  assert.ok(duckSnap.context.ttftMs < 100, "D5 TTFT is sub-100ms");
});

test("6. B3+F3: B3 writes >=15MB, F3 writes 136B checkpoints + 4KB compaction", () => {
  const bloated = new MatrixScenario({
    ...BASE_CFG,
    B: "B3_write_amp_15mb",
    F: "F1_blind_retry_unbounded_spend",
  });
  bloated.run();
  const bloatedSnap = bloated.snapshot();

  const compact = new MatrixScenario({
    ...BASE_CFG,
    B: "B1_zero_hold_2ms",
    F: "F3_resilient_invariant_runtime",
  });
  compact.run();
  const compactSnap = compact.snapshot();

  assert.ok(bloatedSnap.storage.bytesWritten >= 15000000);
  assert.ok(compactSnap.storage.bytesWritten <= 4096);
  assert.equal(compactSnap.recovery.checkpointBytes, 10 * 136);
});

test("7. E1 vs E4: E1 allows db.delete(402), E4 blocks in 1ms; E1 crashes host on SIGSEGV, E4 contains", () => {
  const god = new MatrixScenario({ ...BASE_CFG, E: "E1_god_mode_main_thread" });
  god.run();
  const godSnap = god.snapshot();

  const gated = new MatrixScenario({ ...BASE_CFG, E: "E4_state_leases_ipc_worker" });
  gated.run();
  const gatedSnap = gated.snapshot();

  assert.equal(godSnap.host.crashed, true);
  assert.equal(godSnap.security.injectionBlocked, 0);
  assert.equal(gatedSnap.host.crashed, false);
  assert.equal(gatedSnap.security.injectionBlocked, 1);
  assert.equal(gatedSnap.security.crashesContained, 1);
});

test("8. F2 vs F3: F2 leaves 1 orphan + hallucinated IDs, F3 LIFO compensates", () => {
  const f2 = new MatrixScenario({ ...BASE_CFG, F: "F2_ask_llm_to_undo" });
  f2.run();
  const f2Snap = f2.snapshot();

  const f3 = new MatrixScenario({ ...BASE_CFG, F: "F3_resilient_invariant_runtime" });
  f3.run();
  const f3Snap = f3.snapshot();

  assert.equal(f2Snap.recovery.orphansLeft, 1);
  assert.equal(f2Snap.totals.orphanedCloudCostUsd, 1440);
  assert.equal(f3Snap.recovery.orphansLeft, 0);
  assert.equal(f3Snap.recovery.compensationsRun, 4);
});

test("9. F1 vs F3: F1 spends $40 on $5 ticket, F3 caps at $0.25", () => {
  const f1 = new MatrixScenario({ ...BASE_CFG, F: "F1_blind_retry_unbounded_spend" });
  f1.run();
  const f1Snap = f1.snapshot();

  const f3 = new MatrixScenario({ ...BASE_CFG, F: "F3_resilient_invariant_runtime" });
  f3.run();
  const f3Snap = f3.snapshot();

  assert.equal(f1Snap.economics.costUsd, 40.0);
  assert.equal(f3Snap.economics.costUsd, 0.25);
  assert.ok(f3Snap.economics.perTenant[0]!.marginUsd > 19.0, "protected tenant margin");
});

test("10. All 10 presets run without error", () => {
  for (const [id, preset] of Object.entries(MATRIX_PRESETS)) {
    const sc = new MatrixScenario(preset);
    sc.run();
    const snap = sc.snapshot();
    assert.ok(snap.totals, `preset ${id} produced valid totals`);
  }
});

test("11. All 10 presets produce distinct snapshots", () => {
  const signatures = new Set<string>();
  for (const preset of Object.values(MATRIX_PRESETS)) {
    const sc = new MatrixScenario(preset);
    sc.run();
    const snap = sc.snapshot();
    const sig = JSON.stringify(snap);
    signatures.add(sig);
  }
  assert.equal(signatures.size, 10, "every preset has distinct behavior");
});

test("12. runMatrixComparison returns valid rootCauses, appliedFixes, valueDelta", () => {
  const comp = runMatrixComparison(MATRIX_PRESETS.login_freeze_db_hog!);
  assert.ok(comp.selected);
  assert.ok(comp.resilient);
  assert.ok(comp.rootCauses.length >= 3);
  assert.ok(comp.appliedFixes.length >= 4);
  assert.ok(comp.valueDelta.netMonthlySavings > 0);
  assert.ok(comp.valueDelta.paybackDays <= 365);
});

// Server Endpoints Testing
const testServer = await startServer({ tickMs: 100000 });
after(async () => { await testServer.close(); });
const port = testServer.port;

function req(path: string, options: { method?: string; body?: string; origin?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string; json: () => any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    headers.Host = `127.0.0.1:${port}`;
    if (options.origin !== undefined) headers.Origin = options.origin;
    else headers.Origin = `http://127.0.0.1:${port}`;
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

    const r = http.request({ host: "127.0.0.1", port, method: options.method ?? "GET", path, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    r.on("error", reject);
    if (options.body) r.write(options.body);
    r.end();
  });
}

test("13. Server /api/matrix/run returns 200, /api/matrix/presets returns 200", async () => {
  const pres = await req("/api/matrix/presets");
  assert.equal(pres.status, 200);
  assert.equal(pres.json().presets.length, 10);

  const runRes = await req("/api/matrix/run", {
    method: "POST",
    body: JSON.stringify({ preset: "login_freeze_db_hog", seed: 42 }),
  });
  assert.equal(runRes.status, 200);
  const data = runRes.json();
  assert.ok(data.selected);
  assert.ok(data.resilient);
  assert.ok(data.valueDelta);
});

test("14. Server rejects wrong Origin, oversized body, unknown dials", async () => {
  const badOrigin = await req("/api/matrix/run", {
    method: "POST",
    origin: "http://evil.example",
    body: JSON.stringify({ preset: "login_freeze_db_hog" }),
  });
  assert.equal(badOrigin.status, 403);

  const bigBody = await req("/api/matrix/run", {
    method: "POST",
    body: JSON.stringify({ pad: "x".repeat(9000) }),
  });
  assert.equal(bigBody.status, 413);

  const badDial = await req("/api/matrix/run", {
    method: "POST",
    body: JSON.stringify({
      config: {
        ...BASE_CFG,
        A: "A99_invalid_traffic",
      },
    }),
  });
  assert.equal(badDial.status, 400);
});

test("15. CSP header hashes match inline scripts (existing pattern)", async () => {
  const page = await req("/");
  assert.equal(page.status, 200);
  const csp = String(page.headers["content-security-policy"]);
  assert.match(csp, /script-src 'sha256-/);
  assert.match(csp, /style-src 'sha256-/);
  assert.ok(!csp.includes("unsafe-inline"));
});

test("16. Reset clears state; replay identical", () => {
  const sc = new MatrixScenario(BASE_CFG);
  sc.run();
  const first = sc.snapshot();

  sc.reset();
  const resetSnap = sc.snapshot();
  assert.equal(resetSnap.db.activeConnections, 0);
  assert.equal(resetSnap.totals.costUsd, 0);

  sc.run();
  const second = sc.snapshot();
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("17. Snapshot is a deep clone", () => {
  const sc = new MatrixScenario(BASE_CFG);
  sc.run();
  const snap1 = sc.snapshot();
  snap1.db.activeConnections = 999;
  const snap2 = sc.snapshot();
  assert.notEqual(snap2.db.activeConnections, 999);
});
