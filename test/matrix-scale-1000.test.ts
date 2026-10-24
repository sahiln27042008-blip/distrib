import test from "node:test";
import assert from "node:assert/strict";
import { MatrixScenario, type MatrixConfig } from "../src/matrix-copy.ts";

function enumerateConfigs(count: number): MatrixConfig[] {
  const A = [
    "A1_single_task",
    "A2_mixed_saas",
    "A3_exec_demo_burst",
    "A4_bulk_crm_swarm",
    "A5_marathon_30step",
  ];
  const B = [
    "B1_zero_hold_2ms",
    "B2_stream_hog_30s",
    "B3_write_amp_15mb",
    "B4_hydration_freeze_4s",
    "B5_in_doubt_zombie_tx",
  ];
  const C = [
    "C1_clean_20ms",
    "C2_socket_drop_2ms_late",
    "C3_rate_limit_429_brownout",
    "C4_bulk_50_poison_pill",
    "C5_legacy_erp_no_idem",
  ];
  const D = [
    "D1_raw_json_80k_flood",
    "D2_append_only_quadratic",
    "D3_lossy_llm_summary",
    "D4_unmapped_schema_drift",
    "D5_cqrs_duckdb_blackboard_o1",
  ];
  const E = [
    "E1_god_mode_main_thread",
    "E2_walled_garden_stuck",
    "E3_hitl_fatigue_global_bool",
    "E4_state_leases_ipc_worker",
    "E5_audit_log_only_no_enforcement",
  ];
  const F = [
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

test("1,000 matrix configs all run with no exceptions", () => {
  const configs = enumerateConfigs(1000);
  assert.equal(configs.length, 1000);
  for (const cfg of configs) {
    const sc = new MatrixScenario(cfg);
    sc.run();
    sc.snapshot();
  }
});

test("1,000 matrix configs complete in under 10 minutes", () => {
  const configs = enumerateConfigs(1000);
  const start = Date.now();
  for (const cfg of configs) {
    const sc = new MatrixScenario(cfg);
    sc.run();
    sc.snapshot();
  }
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 10 * 60 * 1000, `1000 configs took ${elapsed}ms, expected < 600000ms`);
});
