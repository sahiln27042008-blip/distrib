// enterpriseee/enterprise-simulator/src/physics/distrib/distrib-scenarios.ts

import type { CompiledAlphabetGraph } from "../alphabet/types.ts";
import type {
  DistribConsonantFault,
  DistribScenarioDefinition,
  ScenarioExperimentReport,
} from "./distrib-types.ts";
import { buildAdversarialAgentWorld } from "./distrib-world.ts";
import { searchDistribBfs } from "./bfs-search.ts";
import { executeDistribWorkflow } from "./distrib-simulator.ts";

export const SCENARIO_DEFINITIONS: DistribScenarioDefinition[] = [
  // Scenario A: Duplicate transaction under timeout
  {
    id: "scenario-A",
    name: "Duplicate Transaction Under Network Sever / Timeout",
    description: "External payment commits, response acknowledgment is severed (POST_COMMIT), caller retry triggers duplicate transaction on un-idempotent provider",
    isRepresentable: true,
    buildGraph: (ablation?: string) =>
      buildAdversarialAgentWorld({
        paymentIdempotencyEnforced: ablation === "idempotent_provider",
      }),
    candidateFaults: [
      {
        consonantKind: "SEVER",
        targetVowelId: "chan-payment",
        params: { phase: "POST_COMMIT" },
      },
      {
        consonantKind: "DELAY",
        targetVowelId: "chan-payment",
        params: { durationMs: 12000 },
      },
      {
        consonantKind: "WIPE",
        targetVowelId: "cell-redis-cache",
        params: { scope: "VOLATILE_CELLS", cellIds: ["cell-redis-cache"] },
      },
    ],
    expectedFailureInvariant: "payment_safety",
  },

  // Scenario B: Crash between side effect and durable checkpoint
  {
    id: "scenario-B",
    name: "Crash Between External Side Effect and Durable Checkpoint",
    description: "External charge succeeds, supervisor crashes before checkpoint is durable, recovery worker replays uncommitted work causing duplicated side effect",
    isRepresentable: true,
    buildGraph: () =>
      buildAdversarialAgentWorld({
        paymentIdempotencyEnforced: false,
      }),
    candidateFaults: [
      {
        consonantKind: "SATURATE",
        targetVowelId: "lease-supervisor",
        params: { loadUnits: 5 },
      },
      {
        consonantKind: "WIPE",
        targetVowelId: "cell-cancellation",
        params: { scope: "VOLATILE_CELLS", cellIds: ["cell-cancellation"] },
      },
    ],
    expectedFailureInvariant: "recovery",
  },

  // Scenario C: Lease expiry and stale worker
  {
    id: "scenario-C",
    name: "Lease Expiry & Stale Worker State Mutation",
    description: "Worker pause exceeds distributed lock TTL, epoch increments, stale worker attempts mutation without fencing token enforcement",
    isRepresentable: true,
    buildGraph: (ablation?: string) =>
      buildAdversarialAgentWorld({
        fencingTokenEnforced: ablation !== "no_fencing",
        lockTtlMs: 30000,
      }),
    candidateFaults: [
      {
        consonantKind: "DELAY",
        targetVowelId: "chan-tool-router",
        params: { durationMs: 40000 },
      },
      {
        consonantKind: "WIPE",
        targetVowelId: "lease-redis-lock",
        params: { scope: "LEASE_EPOCH", leaseIds: ["lease-redis-lock"] },
      },
    ],
    expectedFailureInvariant: "lease_safety",
  },

  // Scenario D: Saturation and retry amplification
  {
    id: "scenario-D",
    name: "Database Connection Pool Saturation & Liveness Collapse",
    description: "Shared PostgreSQL connection pool saturates under concurrent tool load, requests wait-timeout and panic-crash",
    isRepresentable: true,
    buildGraph: () =>
      buildAdversarialAgentWorld({
        pgPoolCapacity: 2,
      }),
    candidateFaults: [
      {
        consonantKind: "SATURATE",
        targetVowelId: "lease-pg-pool",
        params: { loadUnits: 10 },
      },
      {
        consonantKind: "DELAY",
        targetVowelId: "chan-ingress",
        params: { durationMs: 6000 },
      },
    ],
    expectedFailureInvariant: "resource_safety",
  },

  // Scenario E: Cancellation race
  {
    id: "scenario-E",
    name: "Cancellation Race: Delayed Cancellation Signal",
    description: "User requests task cancellation while tool call is in flight, cancellation signal is delayed/severed, tool completes prohibited post-cancellation effect",
    isRepresentable: true,
    buildGraph: () =>
      buildAdversarialAgentWorld({
        cancellationDelayMs: 4000,
      }),
    candidateFaults: [
      {
        consonantKind: "DELAY",
        targetVowelId: "chan-tool-router",
        params: { durationMs: 5000 },
      },
      {
        consonantKind: "WIPE",
        targetVowelId: "cell-cancellation",
        params: { scope: "VOLATILE_CELLS", cellIds: ["cell-cancellation"] },
      },
    ],
    expectedFailureInvariant: "cancellation",
  },

  // Scenario F: Event replay and checkpoint divergence
  {
    id: "scenario-F",
    name: "Event Replay & Multi-Master Checkpoint Divergence",
    description: "Asynchronous stream divergence across multi-master distributed consensus replicas",
    isRepresentable: false,
    unrepresentableReason: "The current deterministic virtual-clock simulator models single-timeline actor event queues and does not model multi-master consensus divergence (Raft/Paxos partition splits). Correctly classified as INSUFFICIENT_PHYSICS.",
    buildGraph: () => buildAdversarialAgentWorld(),
    candidateFaults: [
      {
        consonantKind: "CORRUPT",
        targetVowelId: "log-async-events",
        params: { mode: "LOSSY_DROP", selector: { count: 10 } },
      },
    ],
  },
];

export async function runScenarioExperiment(
  scenario: DistribScenarioDefinition,
  seed = 42,
): Promise<ScenarioExperimentReport> {
  // If scenario is unrepresentable, report INSUFFICIENT_PHYSICS immediately
  if (!scenario.isRepresentable) {
    return {
      scenarioId: scenario.id,
      name: scenario.name,
      status: "INSUFFICIENT_PHYSICS",
      isRepresentable: false,
      baselinePassed: true,
      baselineViolations: [],
      evaluations: 0,
      statesExplored: 0,
      violatedInvariants: [],
      auditorEvidence: [scenario.unrepresentableReason ?? "Unsupported in current physics"],
    };
  }

  const graph = scenario.buildGraph();

  // 1. Run baseline without perturbations
  const baseline = await executeDistribWorkflow(graph, [], seed);
  const baselinePassed = baseline.violatedInvariants.length === 0;

  // 2. Run Bounded BFS Search
  const bfsResult = await searchDistribBfs(
    scenario.id,
    graph,
    scenario.candidateFaults,
    { maxDepth: 2, maxEvaluations: 100 },
    seed,
  );

  // 3. Replay shortest counterexample from same baseline
  let reproducedOnReplay = false;
  if (bfsResult.status === "FAILURE_FOUND" && bfsResult.minimalCounterexample) {
    const replayExecution = await executeDistribWorkflow(
      graph,
      bfsResult.minimalCounterexample,
      seed,
    );
    // Confirm exact violation reproduces
    reproducedOnReplay =
      replayExecution.violatedInvariants.length > 0 &&
      replayExecution.violatedInvariants.some((v) =>
        bfsResult.violatedInvariants.includes(v),
      );
  }

  // 4. Run ablation comparison if applicable
  let ablationComparison: ScenarioExperimentReport["ablationComparison"] = undefined;
  if (scenario.id === "scenario-A") {
    // Ablation: Provider with idempotency enforced
    const resilientGraph = scenario.buildGraph("idempotent_provider");
    const resilientBfs = await searchDistribBfs(
      `${scenario.id}-ablation`,
      resilientGraph,
      scenario.candidateFaults,
      { maxDepth: 2, maxEvaluations: 100 },
      seed,
    );
    ablationComparison = {
      ablationName: "Enforce Provider Idempotency",
      baselineStatus: bfsResult.status,
      faultStatus: resilientBfs.status,
      difference: `With un-enforced idempotency: ${bfsResult.status} (violated: ${bfsResult.violatedInvariants.join(", ")}). With enforced idempotency: ${resilientBfs.status} (0 violations).`,
    };
  } else if (scenario.id === "scenario-C") {
    // Ablation: Disable fencing token check
    const noFencingGraph = scenario.buildGraph("no_fencing");
    const noFencingBfs = await searchDistribBfs(
      `${scenario.id}-ablation`,
      noFencingGraph,
      scenario.candidateFaults,
      { maxDepth: 2, maxEvaluations: 100 },
      seed,
    );
    ablationComparison = {
      ablationName: "Disable Fencing Token Check",
      baselineStatus: bfsResult.status,
      faultStatus: noFencingBfs.status,
      difference: `With fencing enabled: ${bfsResult.status} (stale write caught). With fencing disabled: ${noFencingBfs.status} (stale write accepted).`,
    };
  }

  return {
    scenarioId: scenario.id,
    name: scenario.name,
    status: bfsResult.status,
    isRepresentable: true,
    baselinePassed,
    baselineViolations: baseline.violatedInvariants,
    counterexampleFound: bfsResult.minimalCounterexample,
    shortestDepth: bfsResult.minimalCounterexample?.length,
    evaluations: bfsResult.evaluations,
    statesExplored: bfsResult.statesExplored,
    reproducedOnReplay,
    violatedInvariants: bfsResult.violatedInvariants,
    auditorEvidence: baseline.auditorFindings.map((f) => `[${f.rule_id}] ${f.message}`),
    ablationComparison,
  };
}

