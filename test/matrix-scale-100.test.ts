import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Trace } from "../src/trace.ts";
import { MatrixScenario, type DialA, type DialB, type DialC, type DialD, type DialE, type DialF, type MatrixConfig } from "../src/matrix-copy.ts";
import { exportChaosLangChainJsonl } from "../src/chaos-auditor-adapter.ts";

function enumerateConfigs(count: number): MatrixConfig[] {
  const A: DialA[] = [
    "A1_single_task",
    "A2_mixed_saas",
    "A3_exec_demo_burst",
    "A4_bulk_crm_swarm",
    "A5_marathon_30step",
  ];
  const B: DialB[] = [
    "B1_zero_hold_2ms",
    "B2_stream_hog_30s",
    "B3_write_amp_15mb",
    "B4_hydration_freeze_4s",
    "B5_in_doubt_zombie_tx",
  ];
  const C: DialC[] = [
    "C1_clean_20ms",
    "C2_socket_drop_2ms_late",
    "C3_rate_limit_429_brownout",
    "C4_bulk_50_poison_pill",
    "C5_legacy_erp_no_idem",
  ];
  const D: DialD[] = [
    "D1_raw_json_80k_flood",
    "D2_append_only_quadratic",
    "D3_lossy_llm_summary",
    "D4_unmapped_schema_drift",
    "D5_cqrs_duckdb_blackboard_o1",
  ];
  const E: DialE[] = [
    "E1_god_mode_main_thread",
    "E2_walled_garden_stuck",
    "E3_hitl_fatigue_global_bool",
    "E4_state_leases_ipc_worker",
    "E5_audit_log_only_no_enforcement",
  ];
  const F: DialF[] = [
    "F1_blind_retry_unbounded_spend",
    "F2_ask_llm_to_undo",
    "F3_resilient_invariant_runtime",
    "F4_checkpoint_resume_limited",
    "F5_graceful_handoff_cascade",
  ];

  const configs: MatrixConfig[] = [];
  let i = 0;
  for (const a of A) {
    for (const b of B) {
      for (const c of C) {
        for (const d of D) {
          for (const e of E) {
            for (const f of F) {
              if (configs.length >= count) return configs;
              configs.push({
                seed: 42 + i,
                runId: `scale-${i}`,
                A: a,
                B: b,
                C: c,
                D: d,
                E: e,
                F: f,
                humanUsers: 50,
                concurrentAgents: 10,
                dbPoolSize: 20,
                workflowSteps: 10,
                saasPriceUsd: 20,
                ticketValueUsd: 5,
              });
              i++;
            }
          }
        }
      }
    }
  }
  return configs;
}

const repoDir = process.env.SIM_AUDITOR_REPO ?? fileURLToPath(new URL("../../resilient-agent-invariants", import.meta.url));
const auditorAvailable = !!process.env.SIM_AUDITOR_REPO || existsSync(repoDir);
let auditorMod: { parseLangChainCallbackJsonl: (input: string) => unknown; auditTrace: (trace: unknown) => Array<{ rule_id?: string }> } | null = null;

if (auditorAvailable) {
  try {
    auditorMod = await import(pathToFileURL(`${repoDir}/dist/src/index.js`).href);
  } catch {
    auditorMod = null;
  }
}

test("100 matrix configs all run with no exceptions", () => {
  const configs = enumerateConfigs(100);
  assert.equal(configs.length, 100);
  for (const cfg of configs) {
    const sc = new MatrixScenario(cfg);
    sc.run();
    const snap = sc.snapshot();
    assert.ok(typeof snap === "object" && snap !== null);
  }
});

test("100 matrix configs are deterministic", () => {
  const configs = enumerateConfigs(100);
  for (const cfg of configs) {
    const sc1 = new MatrixScenario(cfg);
    sc1.run();
    const sc2 = new MatrixScenario(cfg);
    sc2.run();
    assert.deepEqual(sc1.snapshot(), sc2.snapshot(), `config ${cfg.runId} not deterministic`);
  }
});

test("At least 50 of 100 configs produce at least one auditor finding", () => {
  const configs = enumerateConfigs(100);
  let withFindings = 0;

  for (const cfg of configs) {
    const sc = new MatrixScenario(cfg);
    sc.run();
    const trace = sc.exportTrace() as Trace;
    const jsonl = exportChaosLangChainJsonl(trace);

    if (!auditorMod) {
      continue;
    }

    try {
      const parsed = auditorMod.parseLangChainCallbackJsonl(jsonl);
      const findings = auditorMod.auditTrace(parsed);
      if (findings.length > 0) withFindings++;
    } catch {
      // Auditor not available — skip this assertion's count.
    }
  }

  if (!auditorMod && withFindings === 0) {
    console.log("Skipping finding count: auditor not available");
    return;
  }

  assert.ok(withFindings >= 50, `expected at least 50 configs with findings, got ${withFindings}`);
});
