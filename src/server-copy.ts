import http from "node:http";
import type { AddressInfo } from "node:net";
import { PRESETS, RefundScenario } from "./refund.ts";
import { exportTrace } from "./trace.ts";
import { exportLangChainJsonl } from "./auditor-export.ts";
import { SharedEnterpriseScenario } from "./enterprise.ts";
import { EnterpriseChaosScenario } from "./chaos.ts";
import { AgentContextScenario, runAgentComparison, type AgentComparisonResult } from "./agent-lab.ts";
import { DurableScenario } from "./durable.ts";
import { TopologyScenario, TOPOLOGY_PRESETS, type TopologyConfig } from "./topology.ts";
import { CSP, PAGE } from "./ui-copy.ts";
import { UnsupportedTraceError } from "./auditor-export.ts";
import {
  MatrixScenario,
  runMatrixComparison,
  MATRIX_PRESETS,
  type MatrixConfig,
  type MatrixSnapshot,
  type DialA,
  type DialB,
  type DialC,
  type DialD,
  type DialE,
  type DialF,
} from "./matrix-copy.ts";

export interface ServerOptions {
  host?: string; // loopback only
  port?: number; // 0 = pick a free port
  tickMs?: number; // wall-clock pacing of autoplay only; never feeds virtual time
  maxBodyBytes?: number;
  maxEventsShown?: number;
  scenarioBase?: Record<string, unknown>; // extra scenario config (e.g. limits), validated by parseConfig; test/dev hook
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const AUDITOR = {
  connected: false, // this server never runs the auditor (no command execution); run the CLI on the exported file
  reason: `findings come from the auditor CLI, not this page. Export a refund langchain-callback-jsonl/1 file, then run: agent-invariants audit <file.jsonl> --json`,
};

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Json = Record<string, unknown>;

// Exact-key validation: reject anything not explicitly allowed.
function only(body: Json, allowed: string[]): void {
  for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new HttpError(400, "bad_field", `unknown field: ${k}`);
}

export async function startServer(opts: ServerOptions = {}) {
  const host = opts.host ?? "127.0.0.1";
  if (!LOOPBACK.has(host)) throw new Error(`refusing to bind non-loopback host: ${host}`);
  const tickMs = opts.tickMs ?? 250;
  const maxBody = opts.maxBodyBytes ?? 2048;
  const maxShown = opts.maxEventsShown ?? 500;

  const base = opts.scenarioBase ?? {};
  type Scenario = RefundScenario | SharedEnterpriseScenario | EnterpriseChaosScenario | AgentContextScenario | DurableScenario | TopologyScenario;
  let scenarioKind: "refund" | "enterprise" | "chaos" | "agent-lab" | "durable" | "topology" = "refund";
  let scenario: Scenario = new RefundScenario({ ...base, ...PRESETS.healthy });
  let comparisonResult: { scenario: string; naive: any; resilient: any; comparison: Record<string, unknown>; trace?: Record<string, unknown> } | undefined;
  let currentTopologyPreset = "fullChaos";
  let timer: NodeJS.Timeout | undefined;
  let port = 0;

  const buildScenario = (kind: "refund" | "enterprise" | "chaos" | "agent-lab" | "durable" | "topology", preset: string, idempotency?: boolean, config?: Json): Scenario => {
    if (kind === "chaos") {
      if (config?.mode !== "naive" && config?.mode !== "resilient") throw new HttpError(400, "bad_field", "mode must be naive or resilient");
      const seed = config.seed === undefined ? 7 : config.seed;
      const runId = config.runId === undefined ? `chaos-${seed}` : config.runId;
      if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new HttpError(400, "bad_field", "seed must be an integer in [0, 4294967295]");
      if (typeof runId !== "string") throw new HttpError(400, "bad_field", "runId must be a string");
      return new EnterpriseChaosScenario({ mode: config.mode, seed, runId });
    }
    if (kind === "agent-lab") {
      const mode = config?.mode === "naive" || config?.mode === "resilient" ? config.mode : "resilient";
      const seed = typeof config?.seed === "number" ? config.seed : 7;
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new HttpError(400, "bad_field", "seed must be an integer in [0, 4294967295]");
      return new AgentContextScenario({
        mode,
        seed,
        promptSizeCap: typeof config?.promptSizeCap === "number" ? config.promptSizeCap : undefined,
        toolOutputLimit: typeof config?.toolOutputLimit === "number" ? config.toolOutputLimit : undefined,
        maxExecutionSteps: typeof config?.maxExecutionSteps === "number" ? config.maxExecutionSteps : undefined,
      });
    }
    if (kind === "durable") {
      const mode = config?.mode === "naive" || config?.mode === "resilient" ? config.mode : "resilient";
      const seed = typeof config?.seed === "number" ? config.seed : 7;
      const runId = typeof config?.runId === "string" ? config.runId : `durable-${seed}`;
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new HttpError(400, "bad_field", "seed must be an integer in [0, 4294967295]");
      return new DurableScenario({
        mode,
        seed,
        runId,
        totalSteps: typeof config?.totalSteps === "number" ? config.totalSteps : undefined,
        crashAtStep: typeof config?.crashAtStep === "number" ? config.crashAtStep : undefined,
        stepTokenCost: typeof config?.stepTokenCost === "number" ? config.stepTokenCost : undefined,
        stepDurationMs: typeof config?.stepDurationMs === "number" ? config.stepDurationMs : undefined,
        payloadBytesPerStep: typeof config?.payloadBytesPerStep === "number" ? config.payloadBytesPerStep : undefined,
        maxEvents: typeof config?.maxEvents === "number" ? config.maxEvents : undefined,
        maxSteps: typeof config?.maxSteps === "number" ? config.maxSteps : undefined,
        eventHistoryLimit: typeof config?.eventHistoryLimit === "number" ? config.eventHistoryLimit : undefined,
      });
    }
    if (kind === "topology") {
      const validPresets = new Set(["healthy", "dbStarvation", "hostCrash", "duplicateCharge", "orphanedCloud", "batchPoison", "clockSkew", "ntpJump", "erpDuplicate", "fullChaos"]);
      const effectivePreset = preset.startsWith("m11-") ? preset.slice(4) : preset;
      if (!validPresets.has(effectivePreset)) throw new HttpError(400, "bad_field", `unknown topology preset: ${preset}`);
      currentTopologyPreset = effectivePreset;
      const presetConfig = TOPOLOGY_PRESETS[effectivePreset as keyof typeof TOPOLOGY_PRESETS];
      const mode = config?.mode === "naive" || config?.mode === "resilient" ? config.mode : presetConfig.mode;
      const seed = typeof config?.seed === "number" ? config.seed : presetConfig.seed;
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new HttpError(400, "bad_field", "seed must be an integer in [0, 4294967295]");
      const runId = typeof config?.runId === "string" ? config.runId : `topology-${effectivePreset}-${seed}`;
      const sc = new TopologyScenario({
        ...presetConfig,
        ...config,
        mode,
        seed,
        runId,
      });
      sc.start();
      sc.run();
      return sc;
    }
    if (kind === "enterprise") {
      const mode = preset === "fault" ? "fault" : "healthy";
      return new SharedEnterpriseScenario({ seed: typeof base.seed === "number" ? Number(base.seed) : 7, mode, queueCapacity: typeof base.queueCapacity === "number" ? Number(base.queueCapacity) : 2, workerCount: typeof base.workerCount === "number" ? Number(base.workerCount) : 2 });
    }
    const next: Record<string, unknown> = { ...base, ...PRESETS[preset as keyof typeof PRESETS] };
    if (idempotency !== undefined) next.idempotency = idempotency;
    if (base.seed !== undefined) next.seed = base.seed;
    return new RefundScenario(next);
  };

  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  const startTimer = () => {
    if (timer) return;
    timer = setInterval(() => {
      if (!scenario.step()) stopTimer();
    }, tickMs);
    timer.unref();
  };
  const requireLife = (life: string) => {
    if ("life" in scenario && (scenario as { life?: string }).life !== life) throw new HttpError(409, "bad_state", `operation needs lifecycle "${life}", currently "${(scenario as { life?: string }).life}"`);
  };
  const disposeScenario = (current: Scenario) => {
    if ("dispose" in current && typeof current.dispose === "function") current.dispose();
  };

  const buildAgentTrace = (snap: any) => ({
    schema: "sim-trace/0",
    simulated: true,
    virtualTime: true,
    traceId: `agent-lab-${snap.mode}-${snap.seed}`,
    spans: (snap.turns ?? []).map((turn: any, index: number) => ({
      spanId: `s-agent-${snap.mode}-${index + 1}`,
      parentSpanId: index === 0 ? null : `s-agent-${snap.mode}-${index}`,
      name: `agent.turn.${turn.turn}`,
      startMs: index * 1000,
      endMs: index * 1000 + turn.totalTokens,
      status: "ok",
      attrs: { mode: snap.mode, turn: turn.turn, totalTokens: turn.totalTokens, dbHoldMs: turn.dbHoldDurationMs, hallucinations: turn.hallucinationCount },
      links: [],
      events: [],
    })),
    derived: { mode: snap.mode, seed: snap.seed, totalTokens: snap.totals.totalTokens, totalDbHoldMs: snap.totals.totalDbHoldMs, estimatedCost: snap.totals.estimatedCost },
  });

  const state = () => {
    if (scenarioKind === "agent-lab" && scenario instanceof AgentContextScenario) {
      const snap = comparisonResult ? comparisonResult.naive : scenario.run();
      return {
        model: "agent-lab",
        scenario: "agent-lab",
        mode: snap.mode,
        config: { ...scenario.cfg, scenario: "agent-lab" },
        life: "finished",
        now: snap.virtualTimeMs,
        pending: 0,
        autoplay: false,
        error: undefined,
        agent: snap,
        trace: buildAgentTrace(snap),
        comparison: comparisonResult ? comparisonResult : undefined,
        auditor: AUDITOR,
      };
    }
    if (scenarioKind === "topology" && scenario instanceof TopologyScenario) {
      const snap = scenario.snapshot();
      return {
        model: "topology",
        scenario: "topology",
        mode: snap.mode,
        config: { mode: snap.mode, runId: snap.runId, scenario: "topology", preset: currentTopologyPreset },
        life: "finished",
        now: snap.virtualTimeMs,
        pending: 0,
        autoplay: false,
        error: undefined,
        events: [],
        eventTotal: 0,
        topology: snap,
        trace: scenario.exportTrace(),
        comparison: comparisonResult ? comparisonResult : undefined,
        auditor: AUDITOR,
      };
    }
    if (scenarioKind === "durable" && scenario instanceof DurableScenario) {
      const snap = scenario.snapshot();
      return {
        model: "durable",
        scenario: "durable",
        mode: snap.mode,
        config: { ...scenario.cfg, scenario: "durable" },
        life: snap.life,
        now: snap.virtualTimeMs,
        pending: scenario.sim.pending(),
        autoplay: timer !== undefined,
        error: snap.error,
        services: [...scenario.sim.services].map(([name, kind]) => ({ name, kind })),
        links: [...scenario.sim.links],
        eventTotal: snap.eventsCount,
        events: snap.events.slice(-maxShown),
        durable: snap,
        trace: scenario.exportTrace(),
        comparison: comparisonResult ? comparisonResult : undefined,
        auditor: AUDITOR,
      };
    }
    if (scenarioKind === "chaos" && scenario instanceof EnterpriseChaosScenario) {
      const snap = scenario.snapshot();
      return {
        model: "chaos",
        scenario: "chaos",
        config: { ...scenario.cfg },
        life: snap.life,
        now: snap.virtualTimeMs,
        pending: scenario.sim.pending(),
        autoplay: timer !== undefined,
        error: snap.error,
        services: [...scenario.sim.services].map(([name, kind]) => ({ name, kind })),
        links: [...scenario.sim.links],
        eventTotal: snap.eventsCount,
        events: snap.events.slice(-maxShown),
        chaos: snap,
        trace: scenario.exportTrace(),
        comparison: comparisonResult ? comparisonResult : undefined,
        auditor: AUDITOR,
      };
    }
    if (scenarioKind === "enterprise" && scenario instanceof SharedEnterpriseScenario) {
      const snap: any = scenario.snapshot();
      const log = scenario.sim.log;
      return {
        model: "enterprise",
        scenario: "enterprise",
        config: { ...scenario.cfg, scenario: "enterprise" },
        life: snap.life,
        now: snap.now,
        pending: scenario.sim.pending(),
        autoplay: timer !== undefined,
        error: scenario.error,
        refundState: snap.workflows.map((w: any) => `${w.name}:${w.status}`).join(" | "),
        services: [...scenario.sim.services].map(([name, kind]) => ({ name, kind })),
        links: [...scenario.sim.links],
        eventTotal: log.length,
        events: log.slice(-maxShown),
        m6: snap,
        queue: snap.queue,
        workers: snap.workers,
        sharedResource: snap.sharedResource,
        deadLetters: snap.deadLetters,
        workflows: snap.workflows,
        derived: { deadLetters: snap.deadLetters.length, queueDepth: snap.queue.length },
        auditor: AUDITOR,
      };
    }

    const refundScenario = scenario as RefundScenario;
    const snap: any = refundScenario.snapshot();
    const log = refundScenario.sim.log;
    return {
      model: "refund",
      scenario: "refund",
      config: refundScenario.cfg,
      life: snap.life,
      now: snap.now,
      pending: refundScenario.sim.pending(),
      autoplay: timer !== undefined,
      refundState: snap.refundState,
      error: snap.error,
      services: [...refundScenario.sim.services].map(([name, kind]) => ({ name, kind })),
      links: [...refundScenario.sim.links],
      eventTotal: log.length,
      events: log.slice(-maxShown),
      refunds: snap.refunds,
      operations: snap.operations,
      derived: snap.derived,
      auditor: AUDITOR,
    };
  };

  // Whitelisted operations. Anything else is rejected before touching state.
  const ops: Record<string, (b: Json) => void> = {
    configure(b) {
      only(b, ["op", "preset", "idempotency", "seed", "scenario", "queueCapacity", "workerCount", "mode", "runId", "promptSizeCap", "toolOutputLimit", "maxExecutionSteps", "totalSteps", "crashAtStep", "stepTokenCost", "stepDurationMs", "payloadBytesPerStep", "maxEvents", "eventHistoryLimit", "department"]);
      requireLife("idle");
      const requested = typeof b.scenario === "string" ? b.scenario : "refund";
      const preset = typeof b.preset === "string" ? b.preset : "healthy";
      let sc: Scenario;
      const normalizePreset = (value: string) => value === "m6-healthy" ? "healthy" : value === "m6-fault" ? "fault" : value;
      const effectivePreset = normalizePreset(preset);
      comparisonResult = undefined;
      try {
        if (requested === "chaos") {
          scenarioKind = "chaos";
          sc = buildScenario("chaos", preset, undefined, b);
        } else if (requested === "enterprise") {
          if (!Object.hasOwn({ healthy: true, fault: true }, effectivePreset)) throw new HttpError(400, "bad_field", "preset must be healthy or fault");
          scenarioKind = "enterprise";
          sc = buildScenario("enterprise", effectivePreset, b.idempotency === undefined ? undefined : Boolean(b.idempotency));
        } else if (requested === "agent-lab") {
          scenarioKind = "agent-lab";
          sc = buildScenario("agent-lab", preset, undefined, b);
        } else if (requested === "durable") {
          scenarioKind = "durable";
          sc = buildScenario("durable", preset, undefined, b);
        } else if (requested === "topology") {
          scenarioKind = "topology";
          sc = buildScenario("topology", preset, undefined, b);
        } else {
          scenarioKind = "refund";
          if (!Object.hasOwn(PRESETS, effectivePreset)) throw new HttpError(400, "bad_field", "preset must be healthy or timeout");
          const next: Json = { ...base, ...PRESETS[effectivePreset as keyof typeof PRESETS] };
          if (b.idempotency !== undefined) next.idempotency = b.idempotency;
          if (b.seed !== undefined) next.seed = b.seed;
          sc = new RefundScenario(next);
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, "bad_config", e instanceof Error ? e.message : "invalid config");
      }
      disposeScenario(scenario);
      scenario = sc;
    },
    start(b) {
      only(b, ["op"]);
      requireLife("idle");
      scenario.start();
      startTimer();
    },
    play(b) {
      only(b, ["op"]);
      requireLife("running");
      startTimer();
    },
    pause(b) {
      only(b, ["op"]);
      stopTimer();
    },
    step(b) {
      only(b, ["op"]);
      requireLife("running");
      stopTimer();
      scenario.step();
    },
    advance(b) {
      only(b, ["op", "ms"]);
      requireLife("running");
      const ms = b.ms;
      if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 1 || ms > 60_000) throw new HttpError(400, "bad_field", "ms must be an integer in [1, 60000]");
      stopTimer();
      if (scenarioKind === "durable" && scenario instanceof DurableScenario) {
        try {
          scenario.sim.advanceTo(scenario.sim.now + ms);
          if (scenario.sim.pending() === 0) scenario.life = "finished";
        } catch (error) {
          scenario.life = "error";
          scenario.error = error instanceof Error ? error.message : String(error);
        }
      } else {
        (scenario as RefundScenario | SharedEnterpriseScenario | EnterpriseChaosScenario | AgentContextScenario).advance(ms);
      }
    },
    stop(b) {
      only(b, ["op"]);
      requireLife("running");
      stopTimer();
      if (scenarioKind === "refund") {
        (scenario as RefundScenario).stop();
        return;
      }
      throw new HttpError(409, "bad_state", `${scenarioKind} scenario does not support stop`);
    },
    reset(b) {
      only(b, ["op"]);
      stopTimer();
      comparisonResult = undefined;
      scenario.reset();
    },
    "run-comparison"(b) {
      only(b, ["op", "seed", "scenario", "runId"]);
      const requested = typeof b.scenario === "string" ? b.scenario : "agent-lab";
      const allowedScenarios = new Set(["chaos", "agent-lab", "durable", "topology"]);
      if (!allowedScenarios.has(requested)) throw new HttpError(400, "bad_field", "scenario must be chaos, agent-lab, durable, or topology");
      const seed = typeof b.seed === "number" ? b.seed : 7;
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new HttpError(400, "bad_field", "seed must be an integer in [0, 4294967295]");
      const runId = typeof b.runId === "string" ? b.runId : `${requested}-${seed}`;
      const baseResult = (() => {
        if (requested === "topology") {
          const naive = new TopologyScenario({ ...TOPOLOGY_PRESETS.fullChaos, mode: "naive", seed, runId: `topology-naive-${seed}` });
          const resilient = new TopologyScenario({ ...TOPOLOGY_PRESETS.fullChaos, mode: "resilient", seed, runId: `topology-resilient-${seed}` });
          naive.run();
          resilient.run();
          const naiveSnap = naive.snapshot();
          const resilientSnap = resilient.snapshot();
          return {
            scenario: "topology",
            naive: naiveSnap,
            resilient: resilientSnap,
            comparison: {
              seed,
              naiveTotalTokens: naiveSnap.totals.tokensConsumed,
              resilientTotalTokens: resilientSnap.totals.tokensConsumed,
              naiveDbHoldMs: naiveSnap.infra.db.avgHoldMs,
              resilientDbHoldMs: resilientSnap.infra.db.avgHoldMs,
              deltaTokens: naiveSnap.totals.tokensConsumed - resilientSnap.totals.tokensConsumed,
              deltaDbHoldMs: naiveSnap.infra.db.avgHoldMs - resilientSnap.infra.db.avgHoldMs,
              summary: `Same enterprise. Same 10 workflows. Two outcomes. Naive: ${naiveSnap.infra.db.timeouts} DB timeouts, $${naiveSnap.external.payment.duplicateDollars} duplicate charges, ${naiveSnap.external.cloud.orphaned} orphaned instances. Resilient: 0 DB timeouts, $0 duplicate charges, 0 orphaned instances.`,
            },
          };
        }
        if (requested === "chaos") {
          const naive = new EnterpriseChaosScenario({ mode: "naive", seed, runId });
          const resilient = new EnterpriseChaosScenario({ mode: "resilient", seed, runId });
          naive.start(); naive.run(); resilient.start(); resilient.run();
          const naiveSnap = naive.snapshot();
          const resilientSnap = resilient.snapshot();
          return {
            scenario: "chaos",
            naive: naiveSnap,
            resilient: resilientSnap,
            comparison: {
              seed,
              naiveTotalTokens: naiveSnap.metrics.tokensConsumed,
              resilientTotalTokens: resilientSnap.metrics.tokensConsumed,
              naiveDbHoldMs: naiveSnap.metrics.totalDbConnectionHoldMs,
              resilientDbHoldMs: resilientSnap.metrics.totalDbConnectionHoldMs,
              deltaTokens: naiveSnap.metrics.tokensConsumed - resilientSnap.metrics.tokensConsumed,
              deltaDbHoldMs: naiveSnap.metrics.totalDbConnectionHoldMs - resilientSnap.metrics.totalDbConnectionHoldMs,
              summary: `naive spent ${naiveSnap.metrics.tokensConsumed} tokens and ${naiveSnap.metrics.totalDbConnectionHoldMs} ms DB hold versus resilient ${resilientSnap.metrics.tokensConsumed} tokens and ${resilientSnap.metrics.totalDbConnectionHoldMs} ms.`,
            },
          };
        }
        if (requested === "durable") {
          const naive = new DurableScenario({ mode: "naive", seed, runId });
          const resilient = new DurableScenario({ mode: "resilient", seed, runId });
          naive.start(); naive.run(); resilient.start(); resilient.run();
          const naiveSnap = naive.snapshot();
          const resilientSnap = resilient.snapshot();
          return {
            scenario: "durable",
            naive: naiveSnap,
            resilient: resilientSnap,
            comparison: {
              seed,
              naiveTotalTokens: naiveSnap.metrics.tokensConsumed,
              resilientTotalTokens: resilientSnap.metrics.tokensConsumed,
              naiveVolatileBytesLost: naiveSnap.metrics.volatileBytesLost,
              resilientVolatileBytesLost: resilientSnap.metrics.volatileBytesLost,
              deltaTokens: naiveSnap.metrics.tokensConsumed - resilientSnap.metrics.tokensConsumed,
              deltaVolatileBytesLost: naiveSnap.metrics.volatileBytesLost - resilientSnap.metrics.volatileBytesLost,
              summary: `naive rewrote ${naiveSnap.metrics.cumulativeBytes} bytes and spent ${naiveSnap.metrics.tokensConsumed} tokens vs resilient ${resilientSnap.metrics.cumulativeBytes} bytes and ${resilientSnap.metrics.tokensConsumed} tokens.`,
            },
          };
        }
        const result = runAgentComparison(seed);
        return {
          scenario: "agent-lab",
          naive: result.naive,
          resilient: result.resilient,
          comparison: result.comparison,
        };
      })();
      comparisonResult = baseResult;
      scenarioKind = requested as "chaos" | "agent-lab" | "durable" | "topology";
      if (requested === "chaos") scenario = new EnterpriseChaosScenario({ mode: "naive", seed, runId });
      else if (requested === "durable") scenario = new DurableScenario({ mode: "naive", seed, runId });
      else if (requested === "topology") {
        currentTopologyPreset = "compare";
        scenario = new TopologyScenario({ ...TOPOLOGY_PRESETS.fullChaos, mode: "naive", seed, runId });
      }
      else scenario = new AgentContextScenario({ mode: "naive", seed });
      if (requested === "chaos") {
        (scenario as EnterpriseChaosScenario).start();
        (scenario as EnterpriseChaosScenario).run();
      } else if (requested === "durable") {
        (scenario as DurableScenario).start();
        (scenario as DurableScenario).run();
      } else if (requested === "topology") {
        (scenario as TopologyScenario).start();
        (scenario as TopologyScenario).run();
      } else {
        (scenario as AgentContextScenario).run();
      }
    },
  };

  const allowedHosts = () => new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const allowedOrigins = () => new Set([...allowedHosts()].map((h) => `http://${h}`));

  const send = (res: http.ServerResponse, status: number, body: string, type: string, extra: Record<string, string> = {}) => {
    res.writeHead(status, {
      "Content-Type": type,
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": CSP,
      ...extra,
    });
    res.end(body);
  };
  const sendJson = (res: http.ServerResponse, status: number, obj: unknown, extra: Record<string, string> = {}) =>
    send(res, status, JSON.stringify(obj), "application/json; charset=utf-8", extra);

  let latestMatrixComparison: ReturnType<typeof runMatrixComparison> | undefined;
  let latestMatrixScenario: MatrixScenario | undefined;

  const VALID_DIAL_A = new Set(["A1_single_task", "A2_mixed_saas", "A3_exec_demo_burst", "A4_bulk_crm_swarm", "A5_marathon_30step"]);
  const VALID_DIAL_B = new Set(["B1_zero_hold_2ms", "B2_stream_hog_30s", "B3_write_amp_15mb", "B4_hydration_freeze_4s", "B5_in_doubt_zombie_tx"]);
  const VALID_DIAL_C = new Set(["C1_clean_20ms", "C2_socket_drop_2ms_late", "C3_rate_limit_429_brownout", "C4_bulk_50_poison_pill", "C5_legacy_erp_no_idem"]);
  const VALID_DIAL_D = new Set(["D1_raw_json_80k_flood", "D2_append_only_quadratic", "D3_lossy_llm_summary", "D4_unmapped_schema_drift", "D5_cqrs_duckdb_blackboard_o1"]);
  const VALID_DIAL_E = new Set(["E1_god_mode_main_thread", "E2_walled_garden_stuck", "E3_hitl_fatigue_global_bool", "E4_state_leases_ipc_worker"]);
  const VALID_DIAL_F = new Set(["F1_blind_retry_unbounded_spend", "F2_ask_llm_to_undo", "F3_resilient_invariant_runtime"]);

  const readBody = (req: http.IncomingMessage, customLimit?: number): Promise<string> =>
    new Promise((resolve, reject) => {
      const limit = customLimit ?? maxBody;
      const declared = req.headers["content-length"];
      if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
        reject(new HttpError(413, "too_large", `body over ${limit} bytes`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > limit) {
          req.pause();
          reject(new HttpError(413, "too_large", `body over ${limit} bytes`));
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", () => reject(new HttpError(400, "bad_request", "request stream error")));
    });

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // DNS-rebinding guard: Host must be our own loopback name:port.
    if (!req.headers.host || !allowedHosts().has(req.headers.host)) throw new HttpError(403, "bad_host", "host not allowed");
    const origin = req.headers.origin;
    const url = new URL(req.url ?? "/", "http://x");
    if (req.url !== url.pathname + url.search) throw new HttpError(404, "not_found", "not found"); // reject non-canonical paths
    const method = req.method ?? "";

    if (url.pathname === "/" && method === "GET") return send(res, 200, PAGE, "text/html; charset=utf-8");
    if (url.pathname === "/api/state" && method === "GET") {
      if (origin !== undefined && !allowedOrigins().has(origin)) throw new HttpError(403, "bad_origin", "origin not allowed");
      return sendJson(res, 200, state());
    }
    if (url.pathname === "/api/matrix/presets" && method === "GET") {
      if (origin !== undefined && !allowedOrigins().has(origin)) throw new HttpError(403, "bad_origin", "origin not allowed");
      return sendJson(res, 200, {
        dials: {
          A: Array.from(VALID_DIAL_A),
          B: Array.from(VALID_DIAL_B),
          C: Array.from(VALID_DIAL_C),
          D: Array.from(VALID_DIAL_D),
          E: Array.from(VALID_DIAL_E),
          F: Array.from(VALID_DIAL_F),
        },
        scale: {
          humanUsers: { min: 0, max: 500, default: 200 },
          concurrentAgents: { min: 1, max: 100, default: 10 },
          dbPoolSize: { min: 2, max: 100, default: 20 },
          workflowSteps: { min: 3, max: 30, default: 10 },
          saasPriceUsd: { min: 5, max: 1000, default: 20 },
          ticketValueUsd: { min: 1, max: 500, default: 5 },
        },
        presets: Object.entries(MATRIX_PRESETS).map(([id, p]) => ({ id, ...p })),
      });
    }
    if (url.pathname === "/api/matrix/run") {
      if (method !== "POST") throw new HttpError(405, "bad_method", "use POST");
      if (origin === undefined || !allowedOrigins().has(origin)) throw new HttpError(403, "bad_origin", "origin not allowed");
      if (!/^application\/json(\s*;.*)?$/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "bad_content_type", "content-type must be application/json");
      const raw = await readBody(req, 8192);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "bad_json", "body is not valid JSON");
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "bad_json", "body must be a JSON object");
      const b = body as Record<string, unknown>;

      let cfg: MatrixConfig;
      if (typeof b.preset === "string") {
        if (!Object.hasOwn(MATRIX_PRESETS, b.preset)) throw new HttpError(400, "bad_field", `unknown preset: ${b.preset}`);
        cfg = structuredClone(MATRIX_PRESETS[b.preset]!);
        if (typeof b.seed === "number") cfg.seed = b.seed;
      } else if (typeof b.config === "object" && b.config !== null && !Array.isArray(b.config)) {
        cfg = b.config as MatrixConfig;
      } else {
        cfg = b as unknown as MatrixConfig;
      }

      if (!VALID_DIAL_A.has(cfg.A)) throw new HttpError(400, "bad_field", `invalid Dial A: ${cfg.A}`);
      if (!VALID_DIAL_B.has(cfg.B)) throw new HttpError(400, "bad_field", `invalid Dial B: ${cfg.B}`);
      if (!VALID_DIAL_C.has(cfg.C)) throw new HttpError(400, "bad_field", `invalid Dial C: ${cfg.C}`);
      if (!VALID_DIAL_D.has(cfg.D)) throw new HttpError(400, "bad_field", `invalid Dial D: ${cfg.D}`);
      if (!VALID_DIAL_E.has(cfg.E)) throw new HttpError(400, "bad_field", `invalid Dial E: ${cfg.E}`);
      if (!VALID_DIAL_F.has(cfg.F)) throw new HttpError(400, "bad_field", `invalid Dial F: ${cfg.F}`);

      const result = runMatrixComparison(cfg);
      latestMatrixComparison = result;
      latestMatrixScenario = new MatrixScenario(cfg);
      latestMatrixScenario.run();
      return sendJson(res, 200, result);
    }
    if (url.pathname === "/api/matrix/state" && method === "GET") {
      if (origin !== undefined && !allowedOrigins().has(origin)) throw new HttpError(403, "bad_origin", "origin not allowed");
      const snap = latestMatrixComparison ? latestMatrixComparison.selected : (latestMatrixScenario ? latestMatrixScenario.snapshot() : null);
      return sendJson(res, 200, snap ?? { error: "no_run", message: "no matrix simulation has been run yet" });
    }
    if (url.pathname === "/api/matrix/trace" && method === "GET") {
      if (origin !== undefined && !allowedOrigins().has(origin)) throw new HttpError(403, "bad_origin", "origin not allowed");
      if (!latestMatrixScenario) throw new HttpError(409, "no_trace", "no matrix run executed yet");
      return sendJson(res, 200, latestMatrixScenario.exportTrace());
    }
    if (url.pathname === "/api/lab/run") {
      if (method !== "POST") throw new HttpError(405, "bad_method", "use POST");
      if (origin === undefined || !allowedOrigins().has(origin)) throw new HttpError(403, "bad_origin", "origin not allowed");
      if (!/^application\/json(\s*;.*)?$/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "bad_content_type", "content-type must be application/json");
      const raw = await readBody(req, 8192);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "bad_json", "body is not valid JSON");
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "bad_json", "body must be a JSON object");
      const b = body as Record<string, unknown>;
      const scenarioType = typeof b.scenario === "string" ? b.scenario : "chaos";
      const seed = typeof b.seed === "number" ? b.seed : 7;
      const runId = typeof b.runId === "string" ? b.runId : `lab-${scenarioType}-${seed}`;

      if (scenarioType === "chaos") {
        const sc = new EnterpriseChaosScenario({ mode: b.mode === "resilient" ? "resilient" : "naive", seed, runId });
        sc.start(); sc.run();
        return sendJson(res, 200, sc.snapshot());
      } else if (scenarioType === "agent-lab") {
        const sc = new AgentContextScenario({ mode: b.mode === "naive" ? "naive" : "resilient", seed });
        return sendJson(res, 200, sc.run());
      } else if (scenarioType === "durable") {
        const sc = new DurableScenario({ mode: b.mode === "naive" ? "naive" : "resilient", seed, runId });
        sc.start(); sc.run();
        return sendJson(res, 200, sc.snapshot());
      } else if (scenarioType === "topology") {
        const sc = new TopologyScenario({ ...TOPOLOGY_PRESETS.fullChaos, mode: b.mode === "resilient" ? "resilient" : "naive", seed, runId });
        sc.start(); sc.run();
        return sendJson(res, 200, sc.snapshot());
      }
      throw new HttpError(400, "bad_field", `unknown lab scenario: ${scenarioType}`);
    }
    if (url.pathname === "/api/topology-presets" && method === "GET") {
      if (origin !== undefined && !allowedOrigins().has(origin)) throw new HttpError(403, "bad_origin", "origin not allowed");
      const list = [
        { id: "healthy", name: "Healthy", description: "Zero findings across all 4 layers" },
        { id: "dbStarvation", name: "DB Starvation", description: "Connection pool saturation and query timeouts" },
        { id: "hostCrash", name: "Host Crash", description: "Single-threaded web server failure and container isolation" },
        { id: "duplicateCharge", name: "Duplicate Charge", description: "Non-idempotent payment retries with fresh UUIDs" },
        { id: "orphanedCloud", name: "Orphaned Cloud", description: "Mid-provisioning failure leaking cloud instances without saga compensation" },
        { id: "batchPoison", name: "Batch Poison", description: "Uncaught poison item causing batch rejection and 429 bursts" },
        { id: "clockSkew", name: "Clock Skew", description: "Cross-service wall clock skew causing causality violations" },
        { id: "ntpJump", name: "NTP Jump", description: "Negative NTP jump breaking capability lease windows" },
        { id: "erpDuplicate", name: "ERP Duplicate", description: "Legacy warehouse ERP duplicate shipment dispatch" },
        { id: "fullChaos", name: "Full Chaos", description: "All 4 failure layers active simultaneously" },
      ];
      return sendJson(res, 200, { presets: list });
    }
    if (url.pathname === "/api/trace" && method === "GET") {
      if (origin !== undefined && !allowedOrigins().has(origin)) throw new HttpError(403, "bad_origin", "origin not allowed");
      const trace = scenarioKind === "chaos" && scenario instanceof EnterpriseChaosScenario
        ? scenario.exportTrace()
        : scenarioKind === "enterprise" && scenario instanceof SharedEnterpriseScenario
          ? scenario.exportTrace()
          : scenarioKind === "durable" && scenario instanceof DurableScenario
            ? scenario.exportTrace()
            : scenarioKind === "topology" && scenario instanceof TopologyScenario
              ? scenario.exportTrace()
              : scenarioKind === "agent-lab" && scenario instanceof AgentContextScenario
                ? buildAgentTrace(comparisonResult ? comparisonResult.naive : scenario.run())
                : exportTrace((scenario as RefundScenario).sim.log, `sim-${(scenario as RefundScenario).cfg.seed}-${(scenario as RefundScenario).cfg.orderId}`, (scenario as RefundScenario).snapshot().derived);
      return sendJson(res, 200, trace);
    }
    if (url.pathname === "/api/auditor-export" && method === "GET") {
      if (origin !== undefined && !allowedOrigins().has(origin)) throw new HttpError(403, "bad_origin", "origin not allowed");
      if (scenarioKind !== "refund") {
        const label = scenarioKind === "chaos" ? "M7 chaos" : scenarioKind === "agent-lab" ? "M8 agent-lab" : scenarioKind === "durable" ? "M9 durable" : scenarioKind === "topology" ? "M11 topology" : "M6 enterprise";
        throw new HttpError(409, "unsupported_trace", `auditor export is unavailable for ${label} traces`);
      }
      const trace = exportTrace((scenario as RefundScenario).sim.log, `sim-${(scenario as RefundScenario).cfg.seed}-${(scenario as RefundScenario).cfg.orderId}`, (scenario as RefundScenario).snapshot().derived);
      if (trace.spans.length === 0) throw new HttpError(409, "no_trace", "nothing to export yet: step the scenario first");
      try {
        return send(res, 200, exportLangChainJsonl(trace), "application/x-ndjson; charset=utf-8");
      } catch (e) {
        if (e instanceof UnsupportedTraceError) throw new HttpError(409, e.code, e.message);
        throw e;
      }
    }
    if (url.pathname === "/api/op") {
      if (method !== "POST") throw new HttpError(405, "bad_method", "use POST", );
      // CSRF boundary: browsers always send Origin on POST; require an exact local match.
      if (origin === undefined || !allowedOrigins().has(origin)) throw new HttpError(403, "bad_origin", "origin not allowed");
      if (!/^application\/json(\s*;.*)?$/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "bad_content_type", "content-type must be application/json");
      const raw = await readBody(req);
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "bad_json", "body is not valid JSON");
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "bad_json", "body must be a JSON object");
      const b = body as Json;
      if (typeof b.op !== "string" || !Object.hasOwn(ops, b.op)) throw new HttpError(400, "unknown_op", "unknown operation");
      ops[b.op]!(b);
      return sendJson(res, 200, state());
    }
    throw new HttpError(url.pathname === "/" || url.pathname.startsWith("/api/") ? 405 : 404, url.pathname === "/" || url.pathname.startsWith("/api/") ? "bad_method" : "not_found", "not found or method not allowed");
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      const known = e instanceof HttpError;
      // Unknown errors never leak details.
      const status = known ? e.status : 500;
      sendJson(res, status, { error: known ? e.code : "internal", message: known ? e.message : "internal error" }, status === 413 ? { Connection: "close" } : {});
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => resolve());
  });
  port = (server.address() as AddressInfo).port;

  return {
    server,
    host,
    port,
    url: `http://${host === "::1" ? "[::1]" : host}:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        stopTimer();
        server.close(() => {
          disposeScenario(scenario);
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
