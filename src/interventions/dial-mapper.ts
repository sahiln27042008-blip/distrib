import type { Intervention, InterventionType } from "./primitives.ts";
import type { MatrixConfig } from "../matrix-copy.ts";

export function interventionsToConfig(
  baseConfig: MatrixConfig,
  interventions: Intervention[],
): MatrixConfig {
  const config = { ...baseConfig };
  const injectedInterventions = new Set(config.injectedInterventions ?? []);

  for (const intervention of interventions) {
    switch (intervention.type) {
      case "missing_idempotency_key":
        injectedInterventions.add(intervention.type);
        break;
      case "drop_response":
      case "delay_response":
      case "timeout":
      case "rate_limit":
        if (config.C !== "C5_legacy_erp_no_idem") {
          config.C = intervention.type === "rate_limit"
            ? "C3_rate_limit_429_brownout"
            : "C2_socket_drop_2ms_late";
        }
        break;
      case "kill_worker":
        if (config.E !== "E4_state_leases_ipc_worker") {
          config.E = "E1_god_mode_main_thread";
        }
        break;
      case "lose_state":
        if (config.F !== "F3_resilient_invariant_runtime" && config.F !== "F5_graceful_handoff_cascade" && config.F !== "F2_ask_llm_to_undo") {
          config.F = "F1_blind_retry_unbounded_spend";
        }
        break;
      case "duplicate_request":
        if (config.F !== "F3_resilient_invariant_runtime" && config.F !== "F5_graceful_handoff_cascade" && config.F !== "F2_ask_llm_to_undo") {
          config.F = "F1_blind_retry_unbounded_spend";
        }
        break;
      case "context_bloat":
        config.D = "D1_raw_json_80k_flood";
        break;
      case "write_amplification":
        config.B = "B3_write_amp_15mb";
        break;
      case "stale_read":
        config.B = "B5_in_doubt_zombie_tx";
        break;
      case "partial_failure":
        config.C = "C4_bulk_50_poison_pill";
        break;
      case "expire_lease":
      case "deny_authority":
        config.E = "E3_hitl_fatigue_global_bool";
        break;
      case "reorder_event":
      case "change_external_state":
        break;
    }
  }

  config.runId = baseConfig.runId?.startsWith("adaptive-")
    ? baseConfig.runId
    : `experiment-${baseConfig.seed ?? 0}`;
  if (injectedInterventions.size > 0) {
    config.injectedInterventions = [...injectedInterventions];
  }
  return config;
}

export function configToInterventions(config: MatrixConfig): InterventionType[] {
  const active: InterventionType[] = [...(config.injectedInterventions ?? [])];

  if (config.C === "C5_legacy_erp_no_idem") active.push("missing_idempotency_key");
  if (config.C === "C2_socket_drop_2ms_late") active.push("drop_response");
  if (config.C === "C3_rate_limit_429_brownout") active.push("rate_limit");
  if (config.C === "C4_bulk_50_poison_pill") active.push("partial_failure");
  if (config.E === "E1_god_mode_main_thread") active.push("kill_worker");
  if (config.F === "F1_blind_retry_unbounded_spend") {
    active.push("duplicate_request", "lose_state");
  }
  if (config.D === "D1_raw_json_80k_flood") active.push("context_bloat");
  if (config.B === "B3_write_amp_15mb") active.push("write_amplification");
  if (config.B === "B5_in_doubt_zombie_tx") active.push("stale_read");
  if (config.E === "E3_hitl_fatigue_global_bool") active.push("expire_lease");

  return active;
}
