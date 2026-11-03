// src/verification/patch-verifier.ts

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MatrixScenario } from "../matrix-copy.ts";
import type { MatrixConfig } from "../matrix-copy.ts";
import { exportChaosLangChainJsonl } from "../chaos-auditor-adapter.ts";
import type { Trace } from "../trace.ts";
import type { Finding } from "../../../../resilient-agent-invariants/src/types/finding.ts";
import type { CodePatch, PatchVerificationResult } from "../repair/patch-types.ts";

interface AuditorModule {
  parseLangChainCallbackJsonl: (jsonl: string) => any;
  auditTrace: (trace: any) => Finding[];
}

const VALID_DIAL_KEYS = new Set(["A", "B", "C", "D", "E", "F"]);
const VALID_DIAL_VALUES: Record<string, Set<string>> = {
  A: new Set([
    "A1_single_task",
    "A2_mixed_saas",
    "A3_exec_demo_burst",
    "A4_bulk_crm_swarm",
    "A5_marathon_30step",
  ]),
  B: new Set([
    "B1_zero_hold_2ms",
    "B2_stream_hog_30s",
    "B3_write_amp_15mb",
    "B4_hydration_freeze_4s",
    "B5_in_doubt_zombie_tx",
  ]),
  C: new Set([
    "C1_clean_20ms",
    "C2_socket_drop_2ms_late",
    "C3_rate_limit_429_brownout",
    "C4_bulk_50_poison_pill",
    "C5_legacy_erp_no_idem",
  ]),
  D: new Set([
    "D1_raw_json_80k_flood",
    "D2_append_only_quadratic",
    "D3_lossy_llm_summary",
    "D4_unmapped_schema_drift",
    "D5_cqrs_duckdb_blackboard_o1",
  ]),
  E: new Set([
    "E1_god_mode_main_thread",
    "E2_walled_garden_stuck",
    "E3_hitl_fatigue_global_bool",
    "E4_state_leases_ipc_worker",
    "E5_audit_log_only_no_enforcement",
  ]),
  F: new Set([
    "F1_blind_retry_unbounded_spend",
    "F2_ask_llm_to_undo",
    "F3_resilient_invariant_runtime",
    "F4_checkpoint_resume_limited",
    "F5_graceful_handoff_cascade",
  ]),
};

function validatePatchDialEquivalent(
  patch: CodePatch,
  originalConfig: MatrixConfig,
): { dial: keyof MatrixConfig; from: string; to: string } {
  const dialEquivalent = patch?.dialEquivalent;
  if (!dialEquivalent || typeof dialEquivalent !== "object") {
    throw new Error("patch.dialEquivalent is required to verify a patch");
  }

  const dial = String(dialEquivalent.dial ?? "");
  if (!VALID_DIAL_KEYS.has(dial)) {
    throw new Error(`patch.dialEquivalent.dial must be one of A-F; received ${dial || "<empty>"}`);
  }

  const fromValue = dialEquivalent.from;
  const toValue = dialEquivalent.to;
  if (typeof fromValue !== "string" || typeof toValue !== "string") {
    throw new Error(`patch.dialEquivalent values for dial ${dial} must be strings`);
  }

  const allowedValues = VALID_DIAL_VALUES[dial];
  if (!allowedValues || !allowedValues.has(fromValue) || !allowedValues.has(toValue)) {
    throw new Error(
      `patch.dialEquivalent values for dial ${dial} must be valid MatrixConfig settings; got from=${fromValue}, to=${toValue}`,
    );
  }

  const originalValue = originalConfig[dial as keyof MatrixConfig];
  if (originalValue !== fromValue) {
    throw new Error(
      `patch.dialEquivalent.from value (${fromValue}) does not match the original ${dial} dial (${String(originalValue)})`,
    );
  }

  if (fromValue === toValue) {
    throw new Error(`patch.dialEquivalent must change the ${dial} dial value; no-op patches are rejected`);
  }

  return { dial: dial as keyof MatrixConfig, from: fromValue, to: toValue };
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

  // Reject malformed or no-op dial-equivalent patches before running the simulator.
  const validatedEquivalent = validatePatchDialEquivalent(patch, originalConfig);

  // Build the fixed config by applying the dial equivalent
  const fixedConfig: MatrixConfig = {
    ...originalConfig,
    runId: `${originalConfig.runId}-patched-${Date.now()}`,
  };
  (fixedConfig as any)[validatedEquivalent.dial] = validatedEquivalent.to;

  // Run the original config
  const originalScenario = new MatrixScenario(originalConfig);
  originalScenario.run();
  const originalTrace = originalScenario.exportTrace() as Trace;
  const originalSnapshot = originalScenario.snapshot() as any;
  const originalJsonl = exportChaosLangChainJsonl(originalTrace);
  const originalInternal = auditor.parseLangChainCallbackJsonl(originalJsonl);
  let originalFindings = auditor.auditTrace(originalInternal);

  // Run the fixed config
  const fixedScenario = new MatrixScenario(fixedConfig);
  fixedScenario.run();
  const fixedTrace = fixedScenario.exportTrace() as Trace;
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
    ? `Original had ${originalMatching.length} proven ${patch.ruleId} finding(s). ${beforeImpact}. After simulating the patch's dial equivalent (${validatedEquivalent.dial}: ${validatedEquivalent.from} -> ${validatedEquivalent.to}), fixed config has ${fixedMatching.length} findings. ${afterImpact}. Fix verified.`
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

