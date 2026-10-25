// src/scientist/hypothesis-generator.ts

import type { Orchestrator } from "../llm/orchestrator.ts";
import { createOrchestrator } from "../llm/orchestrator.ts";
import type { Actor, Contract } from "../world-model/index.ts";
import { buildWorldModel } from "../world-model/adapters.ts";
import type { MatrixConfig } from "../matrix-copy.ts";
import type { FailureHypothesis } from "./types.ts";
import { composeSequence, INTERVENTIONS } from "../interventions/index.ts";
import type { InterventionSequence } from "../interventions/composer.ts";
import type { Intervention } from "../interventions/primitives.ts";

const HYPOTHESIS_PROMPT = `You are an AI reliability scientist.
Your job is to find ways to make an autonomous AI system violate
its reliability invariants.

You are given:
- A world model (actors with contracts)
- The system's invariants (what must hold)
- The system's current configuration

Generate failure hypotheses. For each:
1. Describe the failure scenario
2. Which interventions would trigger it
3. Which invariant would be violated
4. How confident you are (0-1)

Think about:
- Lost responses after committed operations
- Worker restarts losing in-memory state
- Retries without idempotency keys
- Partial failures in batch operations
- Saga compensation ordering violations
- Budget exhaustion from retry storms
- Context bloat causing hallucination

Return JSON array of hypotheses.`;

export async function generateHypotheses(
  config: MatrixConfig,
  invariants: string[],
  budget: number,
): Promise<FailureHypothesis[]> {
  const { actors } = buildWorldModel(config);

  const orchestrator = createOrchestrator();

  const worldModelJson = JSON.stringify(
    {
      actors: actors.map((a) => ({
        name: a.name,
        kind: a.kind,
        contract: a.contract,
      })),
      invariants,
      config: {
        A: config.A,
        B: config.B,
        C: config.C,
        D: config.D,
        E: config.E,
        F: config.F,
      },
    },
    null,
    2,
  );

  const messages = [
    { role: "system" as const, content: HYPOTHESIS_PROMPT },
    {
      role: "user" as const,
      content: `Generate up to ${budget} failure hypotheses for this system:\n\n${worldModelJson}`,
    },
  ];

  const response = await orchestrator.chat(messages, []);

  // Parse hypotheses from LLM response
  // Mock returns canned hypotheses based on config
  // Real Llama returns generated hypotheses
  return parseHypotheses(response, config, invariants, budget);
}

function parseHypotheses(
  response: { text: string; tool_calls: any[] },
  config: MatrixConfig,
  invariants: string[],
  budget?: number,
): FailureHypothesis[] {
  let rawHypotheses: any[] = [];
  try {
    if (response.tool_calls && response.tool_calls.length > 0) {
      rawHypotheses =
        (response.tool_calls[0].arguments as any)?.hypotheses || [];
    } else if (response.text) {
      const parsed = JSON.parse(response.text);
      rawHypotheses = Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch {
    rawHypotheses = getCannedHypotheses(config, invariants);
  }

  if (!rawHypotheses || rawHypotheses.length === 0) {
    rawHypotheses = getCannedHypotheses(config, invariants);
  }

  const translated = rawHypotheses.map((h: any, i: number) =>
    translateHypothesis(h, i, config, invariants),
  );

  return typeof budget === "number" && budget > 0
    ? translated.slice(0, budget)
    : translated;
}

function getCannedHypotheses(
  config: MatrixConfig,
  invariants: string[],
): any[] {
  const hypotheses: any[] = [];

  // If C5 or C2 (unreliable or legacy payment) and r04 is tracked, hypothesize duplicate charge
  if (
    (config.C === "C5_legacy_erp_no_idem" ||
      config.C === "C2_socket_drop_2ms_late") &&
    invariants.includes("r04-network-idempotency")
  ) {
    hypotheses.push({
      description:
        "Payment committed but response lost. Worker restarts. Agent retries without idempotency key. Duplicate charge.",
      interventions: [
        "missing_idempotency_key",
        "drop_response",
        "kill_worker",
        "duplicate_request",
      ],
      expectedInvariant: "r04-network-idempotency",
      confidence: 0.9,
    });
  }

  // If F1 (blind retry), hypothesize budget burn
  if (
    config.F === "F1_blind_retry_unbounded_spend" &&
    invariants.includes("r10-unit-economics")
  ) {
    hypotheses.push({
      description:
        "Retry storm with no budget envelope. Each retry burns tokens. Cost exceeds ticket value.",
      interventions: [
        "missing_idempotency_key",
        "rate_limit",
        "duplicate_request",
      ],
      expectedInvariant: "r10-unit-economics",
      confidence: 0.7,
    });
  }

  // If E1 (god mode), hypothesize host crash
  if (
    config.E === "E1_god_mode_main_thread" &&
    (invariants.includes("r05-distributed-sagas") || invariants.length === 0)
  ) {
    hypotheses.push({
      description:
        "Tool SIGSEGV on main thread. Host crashes. All active sessions severed.",
      interventions: ["kill_worker"],
      expectedInvariant: "r05-distributed-sagas",
      confidence: 0.8,
    });
  }

  // If B3 (write amp), hypothesize storage exhaustion
  if (
    config.B === "B3_write_amp_15mb" &&
    (invariants.includes("r11") || invariants.includes("r11-event-compaction"))
  ) {
    hypotheses.push({
      description:
        "15MB state writes saturate storage IOPS. Primary storage bloats. Query performance degrades.",
      interventions: ["write_amplification"],
      expectedInvariant: "r11",
      confidence: 0.6,
    });
  }

  // Always hypothesize saga orphan if not resilient
  if (
    config.F !== "F3_resilient_invariant_runtime" &&
    invariants.includes("r05-distributed-sagas")
  ) {
    hypotheses.push({
      description:
        "Saga partially completes. Worker loses state before compensation. Orphaned cloud resource left running.",
      interventions: ["partial_failure", "lose_state"],
      expectedInvariant: "r05-distributed-sagas",
      confidence: 0.75,
    });
  }

  return hypotheses;
}

function translateHypothesis(
  raw: any,
  index: number,
  config: MatrixConfig,
  invariants: string[],
): FailureHypothesis {
  const interventionTypes: string[] = raw.interventions || [];
  const interventions: Intervention[] = interventionTypes
    .map((type) => (INTERVENTIONS as any)[type])
    .filter(Boolean);

  const sequence: InterventionSequence = composeSequence(
    interventions,
    raw.description || "Unknown hypothesis",
    raw.expectedInvariant,
  );

  return {
    id: `hyp-${index + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: raw.description || "Unknown",
    interventionSequence: sequence,
    expectedInvariant:
      raw.expectedInvariant || invariants[0] || "unknown",
    confidence: raw.confidence ?? 0.5,
  };
}

