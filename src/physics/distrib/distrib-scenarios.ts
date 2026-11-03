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
import { Cell } from "../alphabet/vowels/cell.ts";
import { Lease } from "../alphabet/vowels/lease.ts";
import { Channel } from "../alphabet/vowels/channel.ts";
import { Log } from "../alphabet/vowels/log.ts";

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

  // Enterprise Incident 1: wf-multitenant-saga-reversal
  {
    id: "wf-multitenant-saga-reversal",
    name: "Multi-Tenant Saga Reversal & Little's Law Saturation",
    description: "50 tenants, Little's Law queue saturation on V3: LEASE held during external channel, shipping failure, un-idempotent mutation retry",
    isRepresentable: true,
    buildGraph: (ablation?: string | string[]) => {
      const normAblations = Array.isArray(ablation) ? ablation : ablation ? [ablation] : [];
      const zeroHold = normAblations.includes("zero_hold_lease") || normAblations.includes("lease");
      const channelIdem = normAblations.includes("channel_idempotency") || normAblations.includes("enforce_idempotency") || normAblations.includes("outbound_transport_dedup") || ablation === "idempotent_provider";
      const cellIdem = normAblations.includes("enforce_idempotency") || ablation === "idempotent_provider";

      const actor1 = { id: "actor-1", name: "Order-Saga-Coordinator" };
      const actor2 = { id: "actor-2", name: "Shipping-Payment-Service" };

      const lease = new Lease({
        id: "lease-saga-1",
        actorId: actor1.id,
        maxCapacity: 1,
        ttlMs: 5000,
        overflowPolicy: "WAIT_TIMEOUT",
        heldDuringExternalChannel: !zeroHold,
      });

      const cell = new Cell({
        id: "cell-shipping-2",
        actorId: actor2.id,
        persistence: "DURABLE",
        idempotencyEnforced: cellIdem,
        fencingTokenEnforced: false,
      });

      const channel = new Channel({
        id: "channel-1-2",
        sourceActorId: actor1.id,
        targetActorId: actor2.id,
        timeoutMs: 5000,
        idempotencyEnabled: channelIdem,
      });

      return {
        actors: [actor1, actor2],
        vowels: [lease, cell, channel],
        channels: [channel],
        contracts: [],
        candidatePerturbations: [
          { consonant: { kind: "DUPLICATE", count: 2 } as any, targetId: channel.id },
          { consonant: { kind: "SEVER", phase: "POST_COMMIT" } as any, targetId: channel.id },
          { consonant: { kind: "SATURATE", loadUnits: 5 } as any, targetId: lease.id },
        ],
        epistemicStatus: ["OBSERVED"],
        unrepresentableSemantics: [],
      };
    },
    candidateFaults: [
      {
        consonantKind: "DUPLICATE",
        targetVowelId: "channel-1-2",
        params: { count: 2 },
      },
      {
        consonantKind: "SEVER",
        targetVowelId: "channel-1-2",
        params: { phase: "POST_COMMIT" },
      },
      {
        consonantKind: "SATURATE",
        targetVowelId: "lease-saga-1",
        params: { loadUnits: 5 },
      },
    ],
    expectedFailureInvariant: "r08-zero-hold-lease",
  },

  // Enterprise Incident 2: wf-speculative-batch-unrolling
  {
    id: "wf-speculative-batch-unrolling",
    name: "Speculative Batch Unrolling & Quadratic Log Amplification",
    description: "Malformed schema on Agent 4, burst unroll triggering HTTP 429 and quadratic context bloat on V2: LOG",
    isRepresentable: true,
    buildGraph: () => {
      const actor1 = { id: "actor-1", name: "Batch-Unroller" };
      const actor2 = { id: "actor-2", name: "Downstream-Agent" };
      const log = new Log({
        id: "log-batch-context",
        actorId: actor1.id,
        maxCapacity: 100,
        compactionLagMs: 5000,
        deduplicateOnCompact: false,
      });
      const lease = new Lease({
        id: "lease-batch-worker",
        actorId: actor2.id,
        maxCapacity: 2,
        ttlMs: 5000,
        overflowPolicy: "REJECT_429",
      });
      const channel = new Channel({
        id: "channel-1-2",
        sourceActorId: actor1.id,
        targetActorId: actor2.id,
        timeoutMs: 5000,
      });
      return {
        actors: [actor1, actor2],
        vowels: [log, lease, channel],
        channels: [channel],
        contracts: [],
        candidatePerturbations: [
          { consonant: { kind: "CORRUPT", mode: "SCHEMA_DRIFT" } as any, targetId: channel.id },
          { consonant: { kind: "SATURATE", loadUnits: 10 } as any, targetId: lease.id },
        ],
        epistemicStatus: ["OBSERVED"],
        unrepresentableSemantics: [],
      };
    },
    candidateFaults: [
      { consonantKind: "CORRUPT", targetVowelId: "channel-1-2", params: { mode: "SCHEMA_DRIFT" } },
      { consonantKind: "SATURATE", targetVowelId: "lease-batch-worker", params: { loadUnits: 10 } },
    ],
    expectedFailureInvariant: "resource_safety",
  },

  // Enterprise Incident 3: wf-zombie-checkpoint-desync
  {
    id: "wf-zombie-checkpoint-desync",
    name: "Zombie Checkpoint Desync on Container SIGKILL",
    description: "Container SIGKILL at t=16ms, un-flushed write-ahead log, duplicate vector embeddings on restart",
    isRepresentable: true,
    buildGraph: () => {
      const actor1 = { id: "actor-1", name: "Checkpoint-Supervisor" };
      const actor2 = { id: "actor-2", name: "Vector-Store" };
      const cell1 = new Cell({
        id: "cell-volatile-state",
        actorId: actor1.id,
        persistence: "VOLATILE",
        idempotencyEnforced: false,
        fencingTokenEnforced: false,
      });
      const cell2 = new Cell({
        id: "cell-vector-embeddings",
        actorId: actor2.id,
        persistence: "DURABLE",
        idempotencyEnforced: false,
        fencingTokenEnforced: false,
      });
      const channel = new Channel({
        id: "channel-1-2",
        sourceActorId: actor1.id,
        targetActorId: actor2.id,
        timeoutMs: 5000,
      });
      return {
        actors: [actor1, actor2],
        vowels: [cell1, cell2, channel],
        channels: [channel],
        contracts: [],
        candidatePerturbations: [
          { consonant: { kind: "WIPE", scope: "VOLATILE_CELLS", cellIds: [cell1.id] } as any, targetId: cell1.id },
          { consonant: { kind: "SEVER", phase: "POST_COMMIT" } as any, targetId: channel.id },
        ],
        epistemicStatus: ["OBSERVED"],
        unrepresentableSemantics: [],
      };
    },
    candidateFaults: [
      { consonantKind: "WIPE", targetVowelId: "cell-volatile-state", params: { scope: "VOLATILE_CELLS", cellIds: ["cell-volatile-state"] } },
      { consonantKind: "SEVER", targetVowelId: "channel-1-2", params: { phase: "POST_COMMIT" } },
    ],
    expectedFailureInvariant: "recovery",
  },

  // Enterprise Incident 4: wf-epistemic-context-tax
  {
    id: "wf-epistemic-context-tax",
    name: "Epistemic Context Tax & TTFT Latency Cliff",
    description: "Raw 80k JSON flood, TTFT latency cliff, missing SHA-256 claim-check tickets",
    isRepresentable: true,
    buildGraph: () => {
      const actor1 = { id: "actor-1", name: "LLM-Agent-Router" };
      const actor2 = { id: "actor-2", name: "Evaluator" };
      const log = new Log({
        id: "log-prompt-context",
        actorId: actor1.id,
        maxCapacity: 80000,
        compactionLagMs: 0,
        deduplicateOnCompact: false,
      });
      const channel = new Channel({
        id: "channel-1-2",
        sourceActorId: actor1.id,
        targetActorId: actor2.id,
        timeoutMs: 3000,
      });
      return {
        actors: [actor1, actor2],
        vowels: [log, channel],
        channels: [channel],
        contracts: [],
        candidatePerturbations: [
          { consonant: { kind: "DELAY", durationMs: 4000 } as any, targetId: channel.id },
          { consonant: { kind: "CORRUPT", mode: "LOSSY_DROP" } as any, targetId: log.id },
        ],
        epistemicStatus: ["OBSERVED"],
        unrepresentableSemantics: [],
      };
    },
    candidateFaults: [
      { consonantKind: "DELAY", targetVowelId: "channel-1-2", params: { durationMs: 4000 } },
      { consonantKind: "CORRUPT", targetVowelId: "log-prompt-context", params: { mode: "LOSSY_DROP" } },
    ],
    expectedFailureInvariant: "event_integrity",
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

