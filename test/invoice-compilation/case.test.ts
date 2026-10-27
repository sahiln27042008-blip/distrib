// enterpriseee/enterprise-simulator/test/invoice-compilation/case.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { AlphabetCompiler } from "../../src/physics/alphabet/compiler.ts";
import type { Lease } from "../../src/physics/alphabet/vowels/lease.ts";
import type { InvoiceEvidence } from "../../src/physics/alphabet/types.ts";

test("Layer 5: Invoice Evidence Compilation", () => {
  const compiler = new AlphabetCompiler();

  const evidence: InvoiceEvidence[] = [
    {
      source: "Cloudflare bill",
      sku: "Cloudflare Worker 128MB",
      actorId: "cloudflare-worker",
      evidence: "Memory limit 128MB",
      inferredCapacity: {
        kind: "LEASE",
        maxCapacity: 128,
        confidence: "EXPLICIT",
        evidence: "Cloudflare docs: Worker memory limit 128MB",
      },
    },
    {
      source: "OpenAI invoice",
      sku: "Tier-2 Pay-as-you-go",
      actorId: "openai-api",
      evidence: "Usage limit 5000 RPM",
      inferredCapacity: {
        kind: "LEASE",
        maxCapacity: 5000,
        confidence: "EXPLICIT",
        evidence: "OpenAI rate limits table",
      },
    },
    {
      source: "AWS RDS bill",
      sku: "db.t4g.medium",
      actorId: "aws-rds",
      evidence: "4GB RAM",
      inferredCapacity: {
        kind: "LEASE",
        maxCapacity: 400,
        confidence: "INFERRED",
        evidence: "AWS docs: db.t4g.medium ~400 connections",
      },
    },
  ];

  const graph = compiler.compileFromInvoiceEvidence(evidence);

  const leases = graph.vowels.filter((v): v is Lease => v.kind === "LEASE");
  assert.equal(leases.length, 3, "Must compile 3 LEASE vowels");

  const cfLease = leases.find((l) => l.actorId === "cloudflare-worker");
  const oaLease = leases.find((l) => l.actorId === "openai-api");
  const rdsLease = leases.find((l) => l.actorId === "aws-rds");

  assert.ok(cfLease, "Cloudflare lease must exist");
  assert.ok(oaLease, "OpenAI lease must exist");
  assert.ok(rdsLease, "RDS lease must exist");

  assert.equal(cfLease?.maxCapacity, 128);
  assert.equal(cfLease?.overflowPolicy, "PANIC_CRASH");

  assert.equal(oaLease?.maxCapacity, 5000);
  assert.equal(oaLease?.overflowPolicy, "REJECT_429");

  assert.equal(rdsLease?.maxCapacity, 400);
  assert.equal(rdsLease?.overflowPolicy, "WAIT_TIMEOUT");

  // Provenance verification
  assert.ok(graph.provenance);
  assert.equal(graph.provenance.length, 3);

  const cfProv = graph.provenance.find((p) => p.source === "Cloudflare bill");
  const oaProv = graph.provenance.find((p) => p.source === "OpenAI invoice");
  const rdsProv = graph.provenance.find((p) => p.source === "AWS RDS bill");

  assert.equal(cfProv?.confidence, "EXPLICIT");
  assert.equal(cfProv?.property, "maxCapacity");
  assert.equal(cfProv?.evidence, "Memory limit 128MB");

  assert.equal(oaProv?.confidence, "EXPLICIT");
  assert.equal(oaProv?.property, "maxCapacity");

  assert.equal(rdsProv?.confidence, "INFERRED");
  assert.equal(rdsProv?.property, "maxCapacity");
  assert.equal(rdsProv?.evidence, "4GB RAM");
});

test("Layer 5: Generic capacity and policy inference without vendor hardcoding", () => {
  const compiler = new AlphabetCompiler();

  const evidence: InvoiceEvidence[] = [
    {
      source: "Payment provider invoice",
      sku: "Payment Gateway",
      evidence: "Tier quota 2500 req/s",
    },
    {
      source: "Container host invoice",
      sku: "Serverless Container",
      evidence: "Maximum heap memory limit 512MB",
    },
    {
      source: "Database cluster bill",
      sku: "Managed Postgres",
      evidence: "Max pool size 150 connections",
    },
  ];

  const graph = compiler.compileFromInvoiceEvidence(evidence);
  const leases = graph.vowels.filter((v): v is Lease => v.kind === "LEASE");
  assert.equal(leases.length, 3);

  // Rate limit -> REJECT_429
  assert.equal(leases[0]?.maxCapacity, 2500);
  assert.equal(leases[0]?.overflowPolicy, "REJECT_429");
  assert.equal(graph.provenance?.[0]?.confidence, "EXPLICIT");

  // Memory -> PANIC_CRASH
  assert.equal(leases[1]?.maxCapacity, 512);
  assert.equal(leases[1]?.overflowPolicy, "PANIC_CRASH");
  assert.equal(graph.provenance?.[1]?.confidence, "EXPLICIT");

  // Connections -> WAIT_TIMEOUT
  assert.equal(leases[2]?.maxCapacity, 150);
  assert.equal(leases[2]?.overflowPolicy, "WAIT_TIMEOUT");
  assert.equal(graph.provenance?.[2]?.confidence, "EXPLICIT");
});

