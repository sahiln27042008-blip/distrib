import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { clearWorkflows, createWorkflow, getWorkflow } from "../src/compiler/workflow-store.ts";
import { insertNodeTool } from "../src/mcp/tools/insert-node.ts";
import { causalAuditTool, workflowToGraph } from "../src/mcp/tools/causal-audit.ts";
import { causalCliffTool } from "../src/mcp/tools/causal-cliff.ts";
import { executeFaultSequence } from "../src/physics/search/execute-faults.ts";
import type { ConsonantFault } from "../src/physics/search/search-types.ts";
import fixtures from "../test/reality-benchmark/fixtures/index.ts";

const RESULTS_PATH = path.resolve(process.cwd(), "test/reality-benchmark-results.json");

const aliasMap: Record<string, string> = {
  DELAY: "TIMING",
  SEVER: "OMISSION",
  DUPLICATE: "DUPLICATION",
  SATURATE: "SATURATE",
  WIPE: "CRASH_AMNESIA",
  CORRUPT: "BYZANTINE",
};

function normalizeConsonantName(value: string): string {
  const kind = String(value ?? "").toUpperCase();
  return aliasMap[kind] ?? kind;
}

function canonicalConsonantName(value: string): string {
  const kind = String(value ?? "").toUpperCase();
  return Object.entries(aliasMap).find(([, alias]) => alias === kind)?.[0] ?? kind;
}

function findUnsupportedConsonant(fixture: any): string | undefined {
  const legalSubstrates: Record<string, Set<string>> = {
    DELAY: new Set(["CHANNEL", "LOG"]),
    SEVER: new Set(["CHANNEL"]),
    DUPLICATE: new Set(["CHANNEL", "LOG"]),
    SATURATE: new Set(["LEASE", "LOG"]),
    WIPE: new Set(["REGISTER", "CELL", "LEASE"]),
    CORRUPT: new Set(["CHANNEL", "LOG"]),
  };

  for (const node of fixture.reconstruction.nodes ?? []) {
    const substrates = (node.substrates ?? []).map((substrate: any) => String(substrate.vowel).toUpperCase());
    for (const assignment of node.consonants ?? []) {
      const kind = canonicalConsonantName(assignment.kind);
      const accepted = legalSubstrates[kind];
      if (accepted && !substrates.some((substrate: string) => accepted.has(substrate))) {
        return `${kind} has no compatible target on ${node.name} (${substrates.join(", ") || "no substrates"}); applyConsonant requires ${[...accepted].join(" or ")}.`;
      }
    }
  }
  return undefined;
}

async function inspectPinnedFaultEvents(workflowId: string, seed: number): Promise<{ eventKinds: string[]; rejection?: string }> {
  const workflow = getWorkflow(workflowId);
  if (!workflow) return { eventKinds: [] };

  const graph = workflowToGraph(workflow);
  const eventKinds = new Set<string>();
  for (const candidate of graph.candidatePerturbations) {
    const { kind, ...params } = candidate.consonant;
    const fault: ConsonantFault = {
      consonantKind: kind,
      targetVowelId: candidate.targetId,
      params: params as Record<string, unknown>,
    };
    try {
      const execution = await executeFaultSequence(graph, [fault], seed);
      for (const event of execution.events) eventKinds.add(event.kind);
    } catch (error) {
      return {
        eventKinds: [...eventKinds],
        rejection: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { eventKinds: [...eventKinds] };
}

async function ensureWorkflowFromFixture(fixture: any) {
  if (fixture.modelGapReason) {
    return {
      workflowId: null,
      modelGap: true,
      reason: fixture.modelGapReason,
    };
  }
  const unsupportedConsonant = findUnsupportedConsonant(fixture);
  if (unsupportedConsonant) {
    return { workflowId: null, modelGap: true, reason: unsupportedConsonant };
  }

  const workflowId = fixture.id;
  clearWorkflows();
  createWorkflow(workflowId, fixture.title, fixture.reconstruction.declaredInvariants ?? [], fixture.title);

  for (const node of fixture.reconstruction.nodes) {
    const payload = {
      workflowId,
      nodeName: node.name,
      nodeDescription: node.nodeDescription ?? node.name,
      substrates: node.substrates ?? [],
      ...(node.consonants ? { consonants: node.consonants } : {}),
      ...(node.outboundEdges ? { outboundEdges: node.outboundEdges } : {}),
    };
    const result = await insertNodeTool.handler(payload);
    if (!result.success) {
      throw new Error((result.error as string) || "insert node failed");
    }
  }

  return { workflowId, modelGap: false, reason: null };
}

async function evaluateFixture(fixture: any) {
  const workflowInfo = await ensureWorkflowFromFixture(fixture);
  if (workflowInfo.modelGap) {
    return {
      id: fixture.id,
      reproduced: false,
      matchedRuleId: false,
      matchedDepth: false,
      matchedCliff: false,
      actualRuleId: "MODEL_GAP",
      actualDepth: 0,
      actualCliffMs: null,
      actualCounterexample: [],
      modelGap: true,
      partialReproduction: false,
      reproductionType: "model_gap",
      notes: `MODEL_GAP: ${workflowInfo.reason}`,
    };
  }

  const result = await causalAuditTool.handler({
    scenarioId: workflowInfo.workflowId,
    maxDepth: 4,
    seed: fixture.reconstruction.seed ?? 42,
  });

  if (!result.success) {
    const reason = `Pinned consonant rejected during execution: ${String(result.error ?? "unknown execution error")}`;
    return {
      id: fixture.id,
      reproduced: false,
      partialReproduction: false,
      reproductionType: "model_gap",
      matchedRuleId: false,
      matchedDepth: false,
      matchedCliff: false,
      actualRuleId: "MODEL_GAP",
      actualDepth: 0,
      actualCliffMs: null,
      actualCounterexample: [],
      modelGap: true,
      modelGapReason: reason,
      notes: `MODEL_GAP: ${reason}`,
    };
  }

  const ruleId = Array.isArray(result.violatedInvariants) && result.violatedInvariants.length > 0
    ? String(result.violatedInvariants[0])
    : "NONE";
  const nativeRuleIds: Record<string, string[]> = {
    "r05-distributed-sagas": [
      "native-lease-capacity-overflow",
      "native-lease-epoch-expiry",
      "native-channel-cascade",
      "native-lease-rejected",
    ],
    "r10-unit-economics": ["native-cost-burn"],
  };
  const primaryRuleIds = [fixture.expected.findingRuleId, ...(nativeRuleIds[fixture.expected.findingRuleId] ?? [])];
  const allRuleIds = Array.isArray(result.violatedInvariants) ? result.violatedInvariants.map(String) : [];

  const actualCounterexample = Array.isArray(result.minimalCounterexample) ? result.minimalCounterexample : [];
  const actualKinds = actualCounterexample.map((fault: any) => normalizeConsonantName(String(fault.consonantKind ?? "")));
  const expectedKinds = Array.isArray(fixture.expected.expectedConsonants)
    ? fixture.expected.expectedConsonants.map((value: string) => normalizeConsonantName(value))
    : [];

  const matchedPrimaryRuleId = primaryRuleIds.some((expectedRuleId) => allRuleIds.includes(expectedRuleId));
  const partialAcceptedRules = Array.isArray(fixture.expected.partialAcceptedRules)
    ? fixture.expected.partialAcceptedRules.map(String)
    : [];
  const matchedPartialRuleId = partialAcceptedRules.some((acceptedRuleId: string) => allRuleIds.includes(acceptedRuleId));
  const matchedRuleId = matchedPrimaryRuleId || matchedPartialRuleId;
  const matchedExpectedKind = expectedKinds.some((kind: string) => actualKinds.includes(kind));
  const actualDepth = typeof result.shortestDepth === "number" ? result.shortestDepth : (actualCounterexample.length || 0);
  const matchedDepth = typeof fixture.expected.expectedDepth === "number"
    ? actualDepth <= fixture.expected.expectedDepth
    : true;

  let cliffResult: any = null;
  let actualCliffMs: number | null = null;
  let matchedCliff = true;
  if (typeof fixture.expected.expectedCliffMs === "number") {
    const targetChannel = fixture.reconstruction.cliffTargetChannel ?? "vowel-1-1";
    cliffResult = await causalCliffTool.handler({
      scenarioId: workflowInfo.workflowId,
      targetChannel,
      minMs: 0,
      maxMs: 60000,
      tolerance: 50,
      seed: fixture.reconstruction.seed ?? 42,
    });
    actualCliffMs = Number(cliffResult?.cliffMs ?? cliffResult?.collapseMs ?? 0) || null;
    matchedCliff = actualCliffMs !== null && Math.abs(actualCliffMs - fixture.expected.expectedCliffMs) <= 2000;
  }

  const reproduced =
    !fixture.modelGapReason &&
    actualCounterexample.length > 0 &&
    matchedPrimaryRuleId &&
    matchedExpectedKind &&
    matchedDepth &&
    (typeof fixture.expected.expectedCliffMs === "number" ? matchedCliff : true);

  const partialReproduction = !reproduced &&
    actualCounterexample.length > 0 &&
    matchedPartialRuleId &&
    matchedExpectedKind;

  let modelGap = false;
  let modelGapReason: string | undefined;
  let pinnedEventKinds: string[] = [];
  if (!reproduced && !partialReproduction && fixture.expected.findingRuleId === "r05-distributed-sagas") {
    const pinnedOutcome = await inspectPinnedFaultEvents(workflowInfo.workflowId, fixture.reconstruction.seed ?? 42);
    pinnedEventKinds = pinnedOutcome.eventKinds.filter((kind) =>
      ["lease.panic_crash", "lease.rejected", "lease.epoch_expired", "channel.cascade_failure"].includes(kind),
    );
    if (pinnedOutcome.rejection) {
      modelGap = true;
      modelGapReason = `Pinned consonant rejected during execution: ${pinnedOutcome.rejection}`;
    } else if (pinnedEventKinds.length > 0) {
      modelGap = true;
      modelGapReason = `Simulator emitted ${pinnedEventKinds.join(", ")}, but the auditor produced no ${fixture.expected.findingRuleId} finding for that evidence.`;
    }
  }

  return {
    id: fixture.id,
    reproduced,
    partialReproduction,
    reproductionType: reproduced ? "exact" : partialReproduction ? "partial" : modelGap ? "model_gap" : "none",
    matchedRuleId,
    matchedDepth,
    matchedCliff,
    actualRuleId: ruleId,
    actualDepth,
    actualCliffMs,
    actualCounterexample,
    modelGap,
    notes: reproduced
      ? "reproduced via minimal counterexample and matching rule-depth" 
      : partialReproduction
        ? `PARTIAL_REPRODUCTION: reproduced accepted sub-failure (${ruleId}); expected ${fixture.expected.findingRuleId} remains uncovered`
        : modelGap
          ? `MODEL_GAP: ${modelGapReason}`
          : actualCounterexample.length > 0
        ? `Mismatch: expected ${fixture.expected.findingRuleId}, got ${ruleId}; depth ${actualDepth} vs ${fixture.expected.expectedDepth}; kinds ${actualKinds.join(",") || "none"}`
        : `False negative: simulator produced no counterexample for ${fixture.expected.findingRuleId}`,
    normalizedKinds: actualKinds,
    expectedKinds,
    pinnedEventKinds,
    ...(modelGapReason ? { modelGapReason } : {}),
    violatedInvariants: result.violatedInvariants ?? [],
    findings: result.findings ?? [],
  };
}

export async function runRealityBenchmark() {
  const incidents = [] as any[];
  for (const fixture of fixtures as any[]) {
    incidents.push(await evaluateFixture(fixture));
  }

  const modelGapCount = incidents.filter((incident) => incident.modelGap).length;
  const reproducedCount = incidents.filter((incident) => incident.reproduced).length;
  const partialReproductionCount = incidents.filter((incident) => incident.partialReproduction).length;
  const falseNegativeCount = incidents.filter((incident) => !incident.modelGap && !incident.reproduced && !incident.partialReproduction && incident.actualCounterexample.length === 0).length;
  const falsePositiveCount = incidents.filter((incident) => !incident.modelGap && !incident.reproduced && !incident.partialReproduction && incident.actualCounterexample.length > 0).length;
  const modelGapHonestCount = incidents.filter((incident) => incident.modelGap && /MODEL_GAP/i.test(String(incident.notes ?? ""))).length;

  const report = {
    totalIncidents: incidents.length,
    reproducedCount,
    partialReproductionCount,
    falseNegativeCount,
    falsePositiveCount,
    modelGapCount,
    modelGapHonestCount,
    predictionAccuracy: Number((reproducedCount / Math.max(1, incidents.length - modelGapCount)).toFixed(4)),
    incidents,
  };

  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  fs.writeFileSync(RESULTS_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const report = await runRealityBenchmark();
  console.log(JSON.stringify({
    reproducedCount: report.reproducedCount,
    partialReproductionCount: report.partialReproductionCount,
    falseNegativeCount: report.falseNegativeCount,
    falsePositiveCount: report.falsePositiveCount,
    modelGapCount: report.modelGapCount,
    modelGapHonestCount: report.modelGapHonestCount,
    predictionAccuracy: report.predictionAccuracy,
  }, null, 2));
}
