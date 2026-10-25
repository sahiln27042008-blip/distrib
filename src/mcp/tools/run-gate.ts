import { runReliabilityGate } from "../../gate/reliability-gate.ts";
import type { GateRequest } from "../../gate/gate-types.ts";
import type { MatrixConfig } from "../../matrix-copy.ts";

export const runGateTool = {
  name: "run_gate",
  description:
    "Run the reliability gate: discover invariant failures, minimize counterexamples, generate repairs, and return a deployment decision with evidence.",
  inputSchema: {
    type: "object",
    properties: {
      config: { type: "object", description: "MatrixConfig describing the user's system" },
      systemDescription: { type: "string", description: "System context for proposed repairs" },
      maxExperiments: { type: "number", description: "Maximum experiments to run (default 10)" },
      invariants: { type: "array", items: { type: "string" }, description: "Invariant rule IDs to check" },
    },
    required: ["config"],
  },
  async handler(args: Record<string, unknown>) {
    const config = args.config as MatrixConfig | undefined;
    if (!config || !config.A) {
      return { success: false, error: "config with dials is required" };
    }

    const request: GateRequest = {
      config,
      systemDescription: typeof args.systemDescription === "string" ? args.systemDescription : undefined,
      maxExperiments: typeof args.maxExperiments === "number" ? args.maxExperiments : 10,
      invariants: Array.isArray(args.invariants) ? args.invariants.filter((value): value is string => typeof value === "string") : undefined,
    };

    try {
      const evidence = await runReliabilityGate(request);
      return {
        success: true,
        status: evidence.status,
        reason: evidence.reason,
        discoveredFailures: evidence.discoveredFailures.length,
        patches: evidence.patches.length,
        allPatchesVerified: evidence.patches.length > 0 && evidence.patches.every((patch) => patch.isVerified),
        experimentsRun: evidence.experimentsRun,
        provenFindingsTotal: evidence.provenFindingsTotal,
        evidence,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Gate execution failed" };
    }
  },
};