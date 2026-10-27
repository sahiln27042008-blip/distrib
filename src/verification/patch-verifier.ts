// src/verification/patch-verifier.ts

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MatrixScenario } from "../matrix-copy.ts";
import type { MatrixConfig } from "../matrix-copy.ts";
import { exportChaosLangChainJsonl } from "../chaos-auditor-adapter.ts";
import type { Finding } from "../../../../resilient-agent-invariants/src/types/finding.ts";
import type { CodePatch, PatchVerificationResult } from "../repair/patch-types.ts";

interface AuditorModule {
  parseLangChainCallbackJsonl: (jsonl: string) => any;
  auditTrace: (trace: any) => Finding[];
}

function resolveAuditor(): AuditorModule {
  const envRepo = process.env.SIM_AUDITOR_REPO;
  const candidates = [
    envRepo,
    fileURLToPath(new URL("../../../../../resilient-agent-invariants", import.meta.url)),
    fileURLToPath(new URL("../../../../resilient-agent-invariants", import.meta.url)),
    fileURLToPath(new URL("../../../resilient-agent-invariants", import.meta.url)),
    fileURLToPath(new URL("../../resilient-agent-invariants", import.meta.url)),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  const repo = candidates.find((c) => existsSync(c));
  if (!repo) {
    throw new Error("Could not resolve resilient-agent-invariants repository");
  }

  const require = createRequire(import.meta.url);
  const distEntry = `${repo}/dist/src/index.js`;

  if (existsSync(distEntry)) {
    const mod = require(distEntry);
    return {
      parseLangChainCallbackJsonl: mod.parseLangChainCallbackJsonl,
      auditTrace: mod.auditTrace,
    };
  }

  throw new Error(`Auditor dist entry not found at ${distEntry}`);
}

function matchesFinding(f: Finding, ruleId: string): boolean {
  if (f.status !== "proven") return false;
  const fId = (f.rule_id || "").toLowerCase();
  const target = (ruleId || "").toLowerCase();
  if (fId === target) return true;
  if (target.startsWith("r04") && fId.startsWith("r04")) return true;
  if (target.startsWith("r05") && fId.startsWith("r05")) return true;
  if (target.startsWith("r10") && fId.startsWith("r10")) return true;
  if (target.startsWith("r11") && fId.startsWith("r11")) return true;
  return false;
}

function formatImpact(snap: any): string {
  const parts: string[] = [];
  if (snap?.network?.duplicateDollars > 0) {
    parts.push(`$${snap.network.duplicateDollars} in duplicate charges`);
  }
  if (snap?.recovery?.orphansLeft > 0) {
    parts.push(`${snap.recovery.orphansLeft} orphaned resources`);
  }
  if (snap?.economics?.costUsd > 0) {
    parts.push(`$${snap.economics.costUsd.toFixed(2)} compute cost`);
  }
  return parts.join(", ") || "No measurable business impact";
}

export async function verifyPatch(
  patch: CodePatch,
  originalConfig: MatrixConfig,
): Promise<PatchVerificationResult> {
  const auditor = resolveAuditor();

  // Build the fixed config by applying the dial equivalent
  const fixedConfig: MatrixConfig = {
    ...originalConfig,
    runId: `${originalConfig.runId}-patched-${Date.now()}`,
  };
  if (patch.dialEquivalent?.dial && patch.dialEquivalent?.to) {
    (fixedConfig as any)[patch.dialEquivalent.dial] = patch.dialEquivalent.to;
  }

  // Run the original config
  const originalScenario = new MatrixScenario(originalConfig);
  originalScenario.run();
  const originalTrace = originalScenario.exportTrace();
  const originalSnapshot = originalScenario.snapshot() as any;
  const originalJsonl = exportChaosLangChainJsonl(originalTrace);
  const originalInternal = auditor.parseLangChainCallbackJsonl(originalJsonl);
  let originalFindings = auditor.auditTrace(originalInternal);

  // Run the fixed config
  const fixedScenario = new MatrixScenario(fixedConfig);
  fixedScenario.run();
  const fixedTrace = fixedScenario.exportTrace();
  const fixedSnapshot = fixedScenario.snapshot() as any;
  const fixedJsonl = exportChaosLangChainJsonl(fixedTrace);
  const fixedInternal = auditor.parseLangChainCallbackJsonl(fixedJsonl);
  let fixedFindings = auditor.auditTrace(fixedInternal);

  // Real matching findings only (NO synthesis)
  const originalMatching = originalFindings.filter((f) => matchesFinding(f, patch.ruleId));
  const fixedMatching = fixedFindings.filter((f) => matchesFinding(f, patch.ruleId));

  const beforeImpact = formatImpact(originalSnapshot);
  const afterImpact = formatImpact(fixedSnapshot);

  // If the auditor returns 0 proven findings for both original and fixed configs
  if (originalMatching.length === 0 && fixedMatching.length === 0) {
    return {
      patchId: patch.id,
      originalConfig,
      fixedConfig,
      findingRuleId: patch.ruleId,
      beforeFindings: 0,
      afterFindings: 0,
      beforeBusinessImpact: beforeImpact,
      afterBusinessImpact: afterImpact,
      isFixed: false,
      proof: "NO_REAL_FINDING: auditor produced no proven findings for either config",
      replayHandle: {
        seed: fixedConfig.seed,
        config: fixedConfig,
      },
    };
  }

  // A patch can ONLY be declared isFixed: true if:
  // 1. The auditor returned >= 1 real proven finding on the original config, AND
  // 2. The auditor returned 0 proven findings on the fixed config, AND
  // 3. Both runs used the same seed.
  const isFixed =
    originalMatching.length >= 1 &&
    fixedMatching.length === 0 &&
    originalConfig.seed === fixedConfig.seed;

  const proof = isFixed
    ? `Original had ${originalMatching.length} proven ${patch.ruleId} finding(s). ${beforeImpact}. After applying patch (${patch.description}), fixed config has ${fixedMatching.length} findings. ${afterImpact}. Fix verified.`
    : `Original had ${originalMatching.length}. Fixed still has ${fixedMatching.length}. Fix did NOT resolve the finding.`;

  return {
    patchId: patch.id,
    originalConfig,
    fixedConfig,
    findingRuleId: patch.ruleId,
    beforeFindings: originalMatching.length,
    afterFindings: fixedMatching.length,
    beforeBusinessImpact: beforeImpact,
    afterBusinessImpact: afterImpact,
    isFixed,
    proof,
    replayHandle: {
      seed: fixedConfig.seed,
      config: fixedConfig,
    },
  };
}

