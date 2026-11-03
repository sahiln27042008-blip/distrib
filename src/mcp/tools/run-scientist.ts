// src/mcp/tools/run-scientist.ts

import { runScientist } from "../../scientist/discovery-loop.ts";
import type { ScientistConfig } from "../../scientist/types.ts";
import type { MatrixConfig } from "../../matrix-copy.ts";

export const runScientistTool = {
  name: "run_scientist",
  description:
    "Run the AI reliability scientist on a system configuration. The scientist generates failure hypotheses, runs adversarial experiments, and discovers failures with deterministic evidence. Returns discovered failures with business impact and replay handles.",
  inputSchema: {
    type: "object",
    properties: {
      config: {
        type: "object",
        description: "MatrixConfig describing the user's system",
      },
      maxExperiments: {
        type: "number",
        description: "Maximum experiments to run (budget, default 20)",
      },
      invariants: {
        type: "array",
        items: { type: "string" },
        description: "Which invariants to check (default: r04, r05, r10)",
      },
    },
    required: ["config"],
  },
  async handler(args: Record<string, unknown>) {
    const config = args.config as MatrixConfig;
    if (!config || !config.A) {
      return { success: false, error: "config with dials is required" };
    }

    const scientistConfig: ScientistConfig = {
      baseConfig: config,
      maxExperiments: (args.maxExperiments as number) ?? 20,
      maxSteps: 10000,
      invariants: (args.invariants as string[]) ?? [
        "r04-network-idempotency",
        "r05-distributed-sagas",
        "r10-unit-economics",
      ],
    };

    try {
      const result = await runScientist(scientistConfig);
      return {
        success: true,
        status: result.status,
        inconclusiveReasons: result.inconclusiveReasons,
        experimentsRun: result.experimentsRun,
        hypothesesGenerated: result.hypothesesGenerated,
        discoveredFailures: result.discoveredFailures.length,
        provenFindingsTotal: result.provenFindingsTotal,
        budgetExhausted: result.budgetExhausted,
        failures: result.discoveredFailures.map((f) => ({
          id: f.id,
          hypothesis: f.hypothesis.description,
          expectedInvariant: f.hypothesis.expectedInvariant,
          businessImpact: f.businessImpact,
          replayHandle: f.replayHandle,
          provenFindings: f.experiment.provenFindings.map((p) => ({
            rule_id: p.rule_id,
            status: p.status,
            severity: p.severity,
          })),
        })),
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },
};

export const tool = runScientistTool;
export default runScientistTool;

