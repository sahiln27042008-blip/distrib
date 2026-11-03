// src/scientist/experiment-runner.ts

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MatrixScenario } from "../matrix-copy.ts";
import type { MatrixConfig } from "../matrix-copy.ts";
import { exportChaosLangChainJsonl } from "../chaos-auditor-adapter.ts";
import type { Finding } from "../../../../resilient-agent-invariants/src/types/finding.ts";
import type { Trace } from "../trace.ts";
import type { FailureHypothesis, ExperimentResult } from "./types.ts";
import { interventionsToConfig } from "../interventions/dial-mapper.ts";

function resolveAuditorRepoRoot(): string {
  const envRepo = process.env.SIM_AUDITOR_REPO;
  if (envRepo && envRepo.trim().length > 0) {
    return path.resolve(envRepo);
  }

  const here = fileURLToPath(new URL("../../../../", import.meta.url));
  return path.resolve(here, "resilient-agent-invariants");
}

let auditorRuntimePromise: Promise<{
  parseLangChainCallbackJsonl: (jsonl: string) => any;
  auditTrace: (trace: any) => Finding[];
}> | null = null;

async function loadAuditorRuntime() {
  if (!auditorRuntimePromise) {
    auditorRuntimePromise = (async () => {
      const repoRoot = resolveAuditorRepoRoot();
      const distRoot = path.join(repoRoot, "dist", "src");

      const parseUrl = pathToFileURL(
        path.join(distRoot, "adapters", "langchain-callback-jsonl.js"),
      ).href;
      const auditUrl = pathToFileURL(
        path.join(distRoot, "rules", "audit-trace.js"),
      ).href;

      const [{ parseLangChainCallbackJsonl }, { auditTrace }] =
        await Promise.all([import(parseUrl), import(auditUrl)]);

      return { parseLangChainCallbackJsonl, auditTrace };
    })();
  }
  return auditorRuntimePromise;
}

export async function runExperiment(
  hypothesis: FailureHypothesis,
  baseConfig: MatrixConfig,
): Promise<ExperimentResult> {
  // Map hypothesis interventions → MatrixConfig
  const experimentConfig = interventionsToConfig(
    baseConfig,
    hypothesis.interventionSequence.interventions,
  );

  // Run the matrix
  const scenario = new MatrixScenario(experimentConfig);
  scenario.run();
  const snapshot = scenario.snapshot();
  const trace = scenario.exportTrace() as Trace;

  // Audit the trace
  const jsonl = exportChaosLangChainJsonl(trace);
  const runtime = await loadAuditorRuntime();
  const internalTrace = runtime.parseLangChainCallbackJsonl(jsonl);
  const findings: Finding[] = runtime.auditTrace(internalTrace);
  const provenFindings = findings.filter((f) => f.status === "proven");

  // Check if the expected invariant fired
  const matchedHypothesis = provenFindings.some(
    (f) => f.rule_id === hypothesis.expectedInvariant,
  );

  // Extract business impact from snapshot
  const snap = snapshot as any;
  const duplicateDollars = Number.isFinite(snap?.network?.duplicateDollars)
    ? snap.network.duplicateDollars as number
    : undefined;
  const orphanedResources = Number.isFinite(snap?.recovery?.orphansLeft)
    ? snap.recovery.orphansLeft as number
    : undefined;
  const costUsd = Number.isFinite(snap?.economics?.costUsd)
    ? snap.economics.costUsd as number
    : undefined;

  return {
    hypothesisId: hypothesis.id,
    config: experimentConfig,
    snapshot,
    trace,
    findings,
    provenFindings,
    matchedHypothesis,
    duplicateDollars,
    orphanedResources,
    costUsd,
  };
}

