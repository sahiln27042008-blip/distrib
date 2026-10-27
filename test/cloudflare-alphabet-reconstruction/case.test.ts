// enterpriseee/enterprise-simulator/test/cloudflare-alphabet-reconstruction/case.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Sim } from "../../src/kernel.ts";
import { Log, Lease, applyDelay, applySaturate } from "../../src/physics/alphabet/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const blindEvidencePath = path.resolve(here, "../../p4-cloudflare-blind/public-evidence.json");
const evidence = JSON.parse(fs.readFileSync(blindEvidencePath, "utf8"));

test("Layer 4: Cloudflare Architecture Alphabet Reconstruction", () => {
  // Reconstruct Cloudflare causal chain using the 10-letter alphabet:
  // V2 LOG (ClickHouse unmerged ReplacingMergeTree)
  // + C1 DELAY (compaction lag)
  // + V3 LEASE (Edge Proxy bounded memory array with PANIC_CRASH)
  // + C4 SATURATE (duplicate feature rows saturate capacity)

  const sim = new Sim(42);

  // V2 LOG: ClickHouse partition log with merge compaction lag
  const clickhouseLog = new Log({
    id: "log-clickhouse-partitions",
    actorId: "metadata_store",
    maxCapacity: 500,
    compactionLagMs: 10000,
    deduplicateOnCompact: true,
    sim,
  });

  // V3 LEASE: Edge proxy worker bounded feature capacity with PANIC_CRASH overflow
  const edgeProxyLease = new Lease({
    id: "lease-edge-proxy-table",
    actorId: "edge_proxy_worker",
    maxCapacity: 50, // Bounded production capacity
    ttlMs: 60000,
    overflowPolicy: "PANIC_CRASH",
    sim,
  });

  // Step 1: Ingest feature records with potential duplicates
  for (let i = 0; i < 40; i++) {
    clickhouseLog.append({ featureId: `feat-${i}`, val: 1.0 }, `feat-${i}`, sim);
  }
  // Duplicate unmerged writes
  for (let i = 0; i < 30; i++) {
    clickhouseLog.append({ featureId: `feat-${i}`, val: 2.0 }, `feat-${i}`, sim);
  }

  // Step 2: C1 DELAY on ClickHouse compaction
  applyDelay(sim, clickhouseLog, { durationMs: 5000 });

  // Advance time past the delayed visibility/compaction window
  sim.now = 15000;

  // Read unmerged records before compaction has occurred
  const unmergedFeatures = clickhouseLog.read(sim.now, sim);
  assert.equal(unmergedFeatures.length, 70); // 70 unmerged rows observed

  // Step 3: C4 SATURATE on edge proxy bounded lease with unmerged feature load
  const saturateRes = applySaturate(sim, edgeProxyLease, { loadUnits: unmergedFeatures.length });

  let status: "FAILURE_FOUND" | "INSUFFICIENT_PHYSICS";
  let counterexample: string | undefined;

  const panicCrashEvent = sim.log.find((e) => e.kind === "lease.panic_crash");
  if (panicCrashEvent) {
    status = "FAILURE_FOUND";
    counterexample = `Emergent crash discovered: unmerged ClickHouse records (70 rows) saturated bounded edge proxy table (maxCapacity: 50), triggering LEASE.panic_crash`;
  } else {
    status = "INSUFFICIENT_PHYSICS";
  }

  // Assert genuine emergence from alphabet without product-specific primitives
  assert.equal(status, "FAILURE_FOUND");
  assert.ok(counterexample);
  assert.ok(counterexample.includes("LEASE.panic_crash"));
  assert.equal(saturateRes.ok, false);
});
