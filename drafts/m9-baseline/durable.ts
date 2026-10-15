import { createHash } from "node:crypto";
import { Sim, type SimEvent } from "./kernel.ts";
import type { Trace } from "./trace.ts";

// Simulated durable execution only. Time comes from Sim; randomness comes from Rng.
// Checkpoints stay in memory. Nothing here touches the clock, disk, network, or process table.

export type DurableMode = "naive" | "resilient";
export type DurableLife = "idle" | "running" | "finished" | "error";
export type DurablePhase = "idle" | "executing" | "recovering" | "replaying" | "completed";

export const COMPACT_CHECKPOINT_BYTES = 136;
export const NAIVE_STATE_WRITE_BYTES = 500_000;
export const DURABLE_STEP_NAMES = [
  "accept-order",
  "verify-account",
  "reserve-inventory",
  "quote-freight",
  "authorize-payment",
  "allocate-warehouse",
  "pick-items",
  "pack-shipment",
  "purchase-label",
  "schedule-carrier",
  "notify-customer",
  "capture-payment",
  "emit-invoice",
  "sync-ledger",
  "update-crm",
  "reserve-warranty",
  "assign-sla",
  "open-tracking",
  "stage-dock",
  "confirm-handoff",
  "record-asn",
  "archive-pod",
  "release-hold",
  "close-pickwave",
  "reconcile-tax",
  "publish-event",
  "update-forecast",
  "notify-warehouse",
  "seal-audit",
  "complete-order",
] as const;

const DEFAULT_TOTAL_STEPS = 30;
const DEFAULT_CRASH_AT_STEP = 8;
const DEFAULT_STEP_TOKEN_COST = 6_000;
const DEFAULT_STEP_DURATION_MS = 1_000;
const MAX_SCHEDULER_STEPS = 20_000;
const MAX_EVENTS = 10_000;
const AUDIT_TARGET_BYTES = 4_096;
const AUDIT_MIN_BYTES = 3_500;
const AUDIT_MAX_BYTES = 4_500;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export interface DurableConfigInput {
  mode: DurableMode;
  seed: number;
  runId: string;
  totalSteps?: number;
  crashAtStep?: number;
  stepTokenCost?: number;
  stepDurationMs?: number;
  payloadBytesPerStep?: number;
  maxEvents?: number;
  maxSteps?: number;
  eventHistoryLimit?: number;
}

export interface DurableConfig {
  mode: DurableMode;
  seed: number;
  runId: string;
  totalSteps: number;
  crashAtStep: number;
  stepTokenCost: number;
  stepDurationMs: number;
  payloadBytesPerStep: number;
  maxEvents: number;
  maxSteps: number;
  eventHistoryLimit: number;
}

export interface StepRecord {
  step: number;
  effect: string;
  effectKey: string;
  decision: number;
  generation: number;
  executions: number;
  replayed: boolean;
  bytesWritten: number;
  stateDigest: string;
  tokenCost: number;
  virtualTimeMs: number;
}

export interface DurableMetrics {
  tokensConsumed: number;
  wastedTokens: number;
  tokensAvoidedByReplay: number;
  sideEffects: number;
  duplicateSideEffects: number;
  replayedSteps: number;
  checkpointBytes: number;
  volatileBytesLost: number;
  cumulativeBytes: number;
  payloadBytesPerStep: number;
}

export interface DurableAuditSummary {
  algorithm: "sha256";
  digest: string;
  document: string;
  meaningfulBytes: number;
  paddingBytes: number;
  paddingKind: "explicit-padding" | "none";
  totalBytes: number;
}

export interface DurableSnapshot {
  virtualTimeMs: number;
  mode: DurableMode;
  life: DurableLife;
  phase: DurablePhase;
  runId: string;
  seed: number;
  totalSteps: number;
  crashAtStep: number;
  completedSteps: number;
  crashCount: number;
  resumedFromStep: number;
  worker: "online" | "crashed" | "recovered";
  metrics: DurableMetrics;
  steps: StepRecord[];
  audit: DurableAuditSummary;
  eventsCount: number;
  events: SimEvent[];
  error?: string;
}

export interface LedgerSnapshot {
  runId: string;
  mode: DurableMode;
  steps: Array<{ step: number; bytesWritten: number; stateDigest: string; state: Record<string, unknown> }>;
  checkpointBytes: number;
  lostBytes: number;
  lostCheckpoints: number;
  cumulativeBytes: number;
}

export interface CompactAudit {
  kind: "workflow-ledger-audit";
  algorithm: "sha256";
  digest: string;
  runId: string;
  mode: DurableMode;
  stepCount: number;
  cumulativeBytes: number;
  lostBytes: number;
  lostCheckpoints: number;
  steps: Array<{ step: number; bytesWritten: number; stateDigest: string }>;
  meaningfulBytes: number;
  paddingBytes: number;
  paddingKind: "explicit-padding" | "none";
  padding: string;
  document: string;
  totalBytes: number;
}

export type CheckpointLookup =
  | { found: true; step: number; state: Record<string, unknown>; bytesWritten: number; stateDigest: string }
  | { found: false; step: number; reason: "missing-checkpoint" };

interface StoredCheckpoint {
  step: number;
  state: Record<string, unknown>;
  bytesWritten: number;
  stateDigest: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number in canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new TypeError("checkpoint state is not JSON data");
}

function requireInt(name: string, value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function assertPlainObject(state: unknown): Record<string, unknown> {
  if (state === null || typeof state !== "object" || Array.isArray(state) || Object.getPrototypeOf(state) !== Object.prototype) {
    throw new TypeError("checkpoint state must be a plain object");
  }
  return state as Record<string, unknown>;
}

function buildCheckpoint(step: number, decision: number, inputDigest: string, targetBytes: number): Record<string, unknown> {
  if (!Number.isInteger(step) || step < 1 || step > DURABLE_STEP_NAMES.length) throw new RangeError(`step must be an integer in [1, ${DURABLE_STEP_NAMES.length}]`);
  if (!Number.isInteger(decision) || decision < 0 || decision > 999) throw new RangeError("decision must be an integer in [0, 999]");
  if (!/^[0-9a-f]{64}$/.test(inputDigest)) throw new RangeError("input digest must be 64 lowercase hex characters");
  const core: Record<string, unknown> = {
    decision: String(decision).padStart(3, "0"),
    effect: `step-${String(step).padStart(2, "0")}`,
    sha256: inputDigest,
    step: String(step).padStart(2, "0"),
    tag: "m9",
  };
  const coreBytes = Buffer.byteLength(canonicalJson(core), "utf8");
  if (coreBytes !== COMPACT_CHECKPOINT_BYTES) {
    throw new Error(`compact checkpoint template drifted to ${coreBytes} bytes`);
  }
  if (targetBytes === coreBytes) return core;
  if (targetBytes < coreBytes) throw new RangeError(`payloadBytesPerStep ${targetBytes} is below compact checkpoint size ${coreBytes}`);
  const emptyBytes = Buffer.byteLength(canonicalJson({ ...core, history: "" }), "utf8");
  const fill = targetBytes - emptyBytes;
  if (fill < 0) throw new RangeError(`cannot size checkpoint to ${targetBytes} bytes`);
  // history is the simulated full-state rewrite. Every byte counts as a state write, not audit padding.
  const state: Record<string, unknown> = { ...core, history: "h".repeat(fill) };
  const actual = Buffer.byteLength(canonicalJson(state), "utf8");
  if (actual !== targetBytes) throw new Error(`checkpoint size ${actual} does not equal ${targetBytes}`);
  return state;
}

function sealAudit(facts: Record<string, unknown>, meaningfulBytes: number): Pick<CompactAudit, "document" | "padding" | "paddingBytes" | "paddingKind" | "totalBytes"> {
  if (meaningfulBytes > AUDIT_MAX_BYTES) throw new RangeError(`audit content is ${meaningfulBytes} bytes; limit is ${AUDIT_MAX_BYTES}`);
  if (meaningfulBytes >= AUDIT_MIN_BYTES) {
    const document = canonicalJson(facts);
    const totalBytes = Buffer.byteLength(document, "utf8");
    if (totalBytes !== meaningfulBytes) throw new Error(`audit size drifted to ${totalBytes}`);
    return { document, padding: "", paddingBytes: 0, paddingKind: "none", totalBytes };
  }
  const emptyBytes = Buffer.byteLength(canonicalJson({ ...facts, padding: "", paddingKind: "explicit-padding" }), "utf8");
  const fill = AUDIT_TARGET_BYTES - emptyBytes;
  if (fill < 1) throw new RangeError(`audit frame is ${emptyBytes} bytes before padding`);
  const padding = "=".repeat(fill);
  const document = canonicalJson({ ...facts, padding, paddingKind: "explicit-padding" });
  const totalBytes = Buffer.byteLength(document, "utf8");
  if (totalBytes !== AUDIT_TARGET_BYTES) throw new Error(`audit padding drifted to ${totalBytes}`);
  return { document, padding, paddingBytes: padding.length, paddingKind: "explicit-padding", totalBytes };
}

export class WorkflowLedger {
  readonly runId: string;
  readonly mode: DurableMode;
  readonly maxStep: number;
  private readonly checkpoints = new Map<number, StoredCheckpoint>();
  private retainedBytes = 0;
  private lostBytes = 0;
  private lostCheckpoints = 0;

  constructor(options: { maxStep: number; runId: string; mode: DurableMode }) {
    if (options.mode !== "naive" && options.mode !== "resilient") throw new RangeError("mode must be naive or resilient");
    if (typeof options.runId !== "string" || !RUN_ID.test(options.runId)) throw new RangeError("runId must be 1-64 safe identifier characters");
    this.mode = options.mode;
    this.runId = options.runId;
    this.maxStep = requireInt("maxStep", options.maxStep, 1, DURABLE_STEP_NAMES.length);
  }

  appendStep(step: number, state: unknown, bytesWritten: number): { step: number; bytesWritten: number; stateDigest: string } {
    this.assertStep(step);
    this.assertBytes(bytesWritten);
    const stored = structuredClone(assertPlainObject(state));
    const serialized = canonicalJson(stored);
    const actual = Buffer.byteLength(serialized, "utf8");
    if (actual !== bytesWritten) throw new RangeError(`bytesWritten ${bytesWritten} does not match checkpoint size ${actual}`);
    if (this.checkpoints.has(step)) throw new RangeError(`checkpoint already exists for step ${step}`);
    const stateDigest = createHash("sha256").update(serialized).digest("hex");
    this.checkpoints.set(step, { step, state: stored, bytesWritten, stateDigest });
    this.retainedBytes += bytesWritten;
    return { step, bytesWritten, stateDigest };
  }

  resumeFrom(step: number): CheckpointLookup {
    this.assertStep(step);
    const record = this.checkpoints.get(step);
    if (!record) return { found: false, step, reason: "missing-checkpoint" };
    return {
      found: true,
      step,
      bytesWritten: record.bytesWritten,
      stateDigest: record.stateDigest,
      state: structuredClone(record.state),
    };
  }

  hasCheckpoint(step: number): boolean {
    this.assertStep(step);
    return this.checkpoints.has(step);
  }

  discardVolatile(): { steps: number; bytes: number } {
    const discarded = { steps: this.checkpoints.size, bytes: this.retainedBytes };
    this.lostBytes += discarded.bytes;
    this.lostCheckpoints += discarded.steps;
    this.retainedBytes = 0;
    this.checkpoints.clear();
    return discarded;
  }

  totals(): { checkpointBytes: number; lostBytes: number; lostCheckpoints: number; cumulativeBytes: number; checkpointCount: number } {
    return {
      checkpointBytes: this.retainedBytes,
      lostBytes: this.lostBytes,
      lostCheckpoints: this.lostCheckpoints,
      cumulativeBytes: this.retainedBytes + this.lostBytes,
      checkpointCount: this.checkpoints.size,
    };
  }

  compact(): CompactAudit {
    const steps = [...this.checkpoints.values()]
      .sort((left, right) => left.step - right.step)
      .map((record) => ({ bytesWritten: record.bytesWritten, stateDigest: record.stateDigest, step: record.step }));
    const totals = this.totals();
    // Hash the durable facts only. Padding is added later and is not audit content.
    const substance = {
      cumulativeBytes: totals.cumulativeBytes,
      lostBytes: totals.lostBytes,
      lostCheckpoints: totals.lostCheckpoints,
      mode: this.mode,
      runId: this.runId,
      stepCount: steps.length,
      steps,
    };
    const digest = createHash("sha256").update(canonicalJson(substance)).digest("hex");
    const facts: Record<string, unknown> = {
      algorithm: "sha256",
      cumulativeBytes: totals.cumulativeBytes,
      digest,
      kind: "workflow-ledger-audit",
      lostBytes: totals.lostBytes,
      lostCheckpoints: totals.lostCheckpoints,
      mode: this.mode,
      runId: this.runId,
      stepCount: steps.length,
      steps,
    };
    const meaningfulBytes = Buffer.byteLength(canonicalJson(facts), "utf8");
    const sealed = sealAudit(facts, meaningfulBytes);
    return {
      kind: "workflow-ledger-audit",
      algorithm: "sha256",
      digest,
      runId: this.runId,
      mode: this.mode,
      stepCount: steps.length,
      cumulativeBytes: totals.cumulativeBytes,
      lostBytes: totals.lostBytes,
      lostCheckpoints: totals.lostCheckpoints,
      steps,
      meaningfulBytes,
      paddingBytes: sealed.paddingBytes,
      paddingKind: sealed.paddingKind,
      padding: sealed.padding,
      document: sealed.document,
      totalBytes: sealed.totalBytes,
    };
  }

  snapshot(): LedgerSnapshot {
    const totals = this.totals();
    return {
      runId: this.runId,
      mode: this.mode,
      steps: [...this.checkpoints.values()]
        .sort((left, right) => left.step - right.step)
        .map((record) => ({
          step: record.step,
          bytesWritten: record.bytesWritten,
          stateDigest: record.stateDigest,
          state: structuredClone(record.state),
        })),
      checkpointBytes: totals.checkpointBytes,
      lostBytes: totals.lostBytes,
      lostCheckpoints: totals.lostCheckpoints,
      cumulativeBytes: totals.cumulativeBytes,
    };
  }

  private assertStep(step: number): void {
    requireInt("step", step, 1, this.maxStep);
  }

  private assertBytes(bytesWritten: number): void {
    requireInt("bytesWritten", bytesWritten, 0, NAIVE_STATE_WRITE_BYTES);
  }
}

export class DurableScenario {
  readonly cfg: DurableConfig;
  sim: Sim;
  ledger: WorkflowLedger;
  life: DurableLife = "idle";
  phase: DurablePhase = "idle";
  error?: string;
  private stepLog: StepRecord[] = [];
  private executionCounts = new Map<number, number>();
  private tokensConsumed = 0;
  private sideEffects = 0;
  private duplicateSideEffects = 0;
  private replayedSteps = 0;
  private crashCount = 0;
  private resumedFromStep = 0;
  private generation = 1;
  private crashRecorded = false;
  private worker: DurableSnapshot["worker"] = "online";
  private rootId?: string;
  private linkedEffects = false;
  private linkedLedger = false;
  private finished = false;

  constructor(input: DurableConfigInput) {
    this.cfg = Object.freeze(resolveConfig(input));
    this.sim = this.buildSim();
    this.ledger = this.createLedger();
  }

  start(): void {
    if (this.life !== "idle") throw new Error(`cannot start from ${this.life}`);
    this.life = "running";
    this.phase = "executing";
    this.rootId = this.emit("scenario.start", {
      totalSteps: this.cfg.totalSteps,
      crashAtStep: this.cfg.crashAtStep,
      payloadBytesPerStep: this.cfg.payloadBytesPerStep,
      stepTokenCost: this.cfg.stepTokenCost,
      stepDurationMs: this.cfg.stepDurationMs,
    });
    this.plan(1, 1, 0);
  }

  step(): boolean {
    if (this.life !== "running") return false;
    try {
      const did = this.sim.step();
      if (!did || this.sim.pending() === 0) this.life = "finished";
      return did;
    } catch (error) {
      this.life = "error";
      this.error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  run(): void {
    let guard = 0;
    while (this.life === "running" && this.sim.pending() > 0) {
      if (++guard > this.cfg.maxSteps) {
        this.life = "error";
        this.error = `durable execution step limit ${this.cfg.maxSteps} reached`;
        return;
      }
      this.step();
    }
    if (this.life === "running" && this.sim.pending() === 0) this.life = "finished";
  }

  reset(): void {
    this.sim = this.buildSim();
    this.ledger = this.createLedger();
    this.life = "idle";
    this.phase = "idle";
    this.error = undefined;
    this.stepLog = [];
    this.executionCounts = new Map();
    this.tokensConsumed = 0;
    this.sideEffects = 0;
    this.duplicateSideEffects = 0;
    this.replayedSteps = 0;
    this.crashCount = 0;
    this.resumedFromStep = 0;
    this.generation = 1;
    this.crashRecorded = false;
    this.worker = "online";
    this.rootId = undefined;
    this.linkedEffects = false;
    this.linkedLedger = false;
    this.finished = false;
  }

  snapshot(): DurableSnapshot {
    const audit = this.ledger.compact();
    const metrics = this.currentMetrics();
    return {
      virtualTimeMs: this.sim.now,
      mode: this.cfg.mode,
      life: this.life,
      phase: this.phase,
      runId: this.cfg.runId,
      seed: this.cfg.seed,
      totalSteps: this.cfg.totalSteps,
      crashAtStep: this.cfg.crashAtStep,
      completedSteps: this.ledger.totals().checkpointCount,
      crashCount: this.crashCount,
      resumedFromStep: this.resumedFromStep,
      worker: this.worker,
      metrics,
      steps: this.currentSteps(),
      audit: {
        algorithm: audit.algorithm,
        digest: audit.digest,
        document: audit.document,
        meaningfulBytes: audit.meaningfulBytes,
        paddingBytes: audit.paddingBytes,
        paddingKind: audit.paddingKind,
        totalBytes: audit.totalBytes,
      },
      eventsCount: this.sim.log.length,
      events: this.recentEvents(),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  exportTrace(): Trace {
    const byId = new Map(this.sim.log.map((event) => [event.id, event]));
    const audit = this.ledger.compact();
    return {
      schema: "sim-trace/0",
      simulated: true,
      virtualTime: true,
      traceId: `durable-${this.cfg.runId}-${this.cfg.seed}-${this.cfg.mode}`,
      spans: this.sim.log.map((event) => ({
        spanId: `s-${event.id}`,
        parentSpanId: event.parent && byId.has(event.parent) ? `s-${event.parent}` : null,
        name: event.kind,
        startMs: event.t,
        endMs: event.t,
        status: "ok" as const,
        attrs: { ...event.data },
        links: [],
        events: [],
      })),
      derived: {
        audit: {
          digest: audit.digest,
          meaningfulBytes: audit.meaningfulBytes,
          paddingBytes: audit.paddingBytes,
          paddingKind: audit.paddingKind,
          totalBytes: audit.totalBytes,
        },
        completedSteps: this.ledger.totals().checkpointCount,
        crashCount: this.crashCount,
        metrics: this.currentMetrics(),
        mode: this.cfg.mode,
        resumedFromStep: this.resumedFromStep,
        virtualTimeMs: this.sim.now,
      },
    };
  }

  private buildSim(): Sim {
    const sim = new Sim(this.cfg.seed, {
      maxEvents: this.cfg.maxEvents,
      maxSteps: this.cfg.maxSteps,
      maxPayloadBytes: 4096,
    });
    sim.register("durable-orchestrator", "simulated-orchestrator");
    sim.register("workflow-ledger", "durable-checkpoint-log");
    sim.register("side-effect-gateway", "simulated-side-effect-gateway");
    return sim;
  }

  private createLedger(): WorkflowLedger {
    return new WorkflowLedger({ maxStep: this.cfg.totalSteps, runId: this.cfg.runId, mode: this.cfg.mode });
  }

  private emit(kind: string, data: Record<string, unknown> = {}, parent?: string): string {
    return this.sim.emit(kind, `${this.cfg.runId}:${this.cfg.seed}:${this.cfg.mode}`, {
      runId: this.cfg.runId,
      seed: this.cfg.seed,
      mode: this.cfg.mode,
      ...data,
    }, parent);
  }

  private plan(step: number, generation: number, delayMs: number): void {
    this.sim.at(delayMs, `durable.step.${generation}.${step}`, () => this.executeStep(step, generation));
  }

  private planFinish(delayMs: number): void {
    this.sim.at(delayMs, "durable.finish", () => this.complete());
  }

  private executeStep(step: number, generation: number): void {
    if (generation > 1 && this.worker === "crashed") this.worker = "recovered";
    if (!this.crashRecorded && step === this.cfg.crashAtStep && generation === 1) {
      this.crashNow(step);
      return;
    }
    if (generation > 1 && this.cfg.mode === "resilient" && this.ledger.hasCheckpoint(step)) {
      this.replayStep(step, generation);
      return;
    }
    this.performStep(step, generation);
  }

  private crashNow(step: number): void {
    this.crashRecorded = true;
    this.crashCount = 1;
    this.worker = "crashed";
    this.phase = "recovering";
    const lost = this.cfg.mode === "naive" ? this.ledger.discardVolatile() : { steps: 0, bytes: 0 };
    if (this.cfg.mode === "naive") this.stepLog = [];
    this.resumedFromStep = this.cfg.mode === "resilient" ? step - 1 : 0;
    const crash = this.emit("durable.crash", {
      step,
      generation: 1,
      checkpointsRetained: this.cfg.mode === "resilient",
      volatileCheckpointsLost: lost.steps,
      volatileBytesLost: lost.bytes,
    }, this.rootId);
    this.emit("durable.recover", {
      resumeAt: 1,
      resumedFromStep: this.resumedFromStep,
      checkpointsRetained: this.cfg.mode === "resilient",
    }, crash);
    this.generation = 2;
    this.plan(1, 2, 0);
  }

  private replayStep(step: number, generation: number): void {
    this.phase = "replaying";
    const resumed = this.ledger.resumeFrom(step);
    if (!resumed.found) throw new RangeError(`missing checkpoint for replay of step ${step}`);
    const record = this.stepLog.find((item) => item.step === step);
    if (!record) throw new RangeError(`missing step record ${step}`);
    if (record.replayed) throw new RangeError(`step ${step} replayed twice`);
    record.replayed = true;
    this.replayedSteps += 1;
    this.emit("durable.step.replay", {
      step,
      generation,
      effect: record.effect,
      bytesWritten: resumed.bytesWritten,
      stateDigest: resumed.stateDigest,
      replayed: true,
    }, this.rootId);
    this.advance(step, generation, 0);
  }

  private performStep(step: number, generation: number): void {
    this.phase = "executing";
    const effect = DURABLE_STEP_NAMES[step - 1];
    if (effect === undefined) throw new RangeError(`no workflow step ${step}`);
    const decision = this.sim.rng.int(0, 999);
    const effectKey = this.effectKey(step, generation);
    const executions = (this.executionCounts.get(step) ?? 0) + 1;
    this.executionCounts.set(step, executions);
    const duplicate = executions > 1;
    this.sideEffects += 1;
    if (duplicate) this.duplicateSideEffects += 1;
    this.tokensConsumed += this.cfg.stepTokenCost;
    if (!this.linkedEffects) {
      this.sim.link("durable-orchestrator", "side-effect-gateway");
      this.linkedEffects = true;
    }
    const caused = this.emit("durable.side_effect", {
      step,
      generation,
      effect,
      key: effectKey,
      decision,
      duplicate,
    }, this.rootId);
    const inputDigest = createHash("sha256").update(canonicalJson({
      decision,
      effect,
      generation,
      runId: this.cfg.runId,
      step,
    })).digest("hex");
    const state = buildCheckpoint(step, decision, inputDigest, this.cfg.payloadBytesPerStep);
    const bytesWritten = Buffer.byteLength(canonicalJson(state), "utf8");
    const appended = this.ledger.appendStep(step, state, bytesWritten);
    if (!this.linkedLedger) {
      this.sim.link("durable-orchestrator", "workflow-ledger");
      this.linkedLedger = true;
    }
    this.stepLog.push({
      step,
      effect,
      effectKey,
      decision,
      generation: this.cfg.mode === "resilient" ? 1 : generation,
      executions,
      replayed: false,
      bytesWritten: appended.bytesWritten,
      stateDigest: appended.stateDigest,
      tokenCost: executions * this.cfg.stepTokenCost,
      virtualTimeMs: this.sim.now,
    });
    this.emit("durable.checkpoint", {
      step,
      generation,
      effect,
      bytesWritten: appended.bytesWritten,
      stateDigest: appended.stateDigest,
      decision,
    }, caused);
    this.advance(step, generation, this.cfg.stepDurationMs);
  }

  private advance(step: number, generation: number, delayMs: number): void {
    if (step >= this.cfg.totalSteps) this.planFinish(delayMs);
    else this.plan(step + 1, generation, delayMs);
  }

  private complete(): void {
    if (this.finished) return;
    this.finished = true;
    this.phase = "completed";
    const audit = this.ledger.compact();
    const summary = this.emit("durable.audit", {
      digest: audit.digest,
      meaningfulBytes: audit.meaningfulBytes,
      paddingBytes: audit.paddingBytes,
      paddingKind: audit.paddingKind,
      totalBytes: audit.totalBytes,
      cumulativeBytes: audit.cumulativeBytes,
    }, this.rootId);
    this.emit("scenario.finish", {
      completedSteps: this.stepLog.length,
      duplicateSideEffects: this.duplicateSideEffects,
      tokensConsumed: this.tokensConsumed,
    }, summary);
  }

  private effectKey(step: number, generation: number): string {
    const identity = this.cfg.mode === "resilient"
      ? { op: "enterprise-side-effect", runId: this.cfg.runId, step }
      : { attempt: generation, op: "enterprise-side-effect", runId: this.cfg.runId, step };
    return `sha256:${createHash("sha256").update(canonicalJson(identity)).digest("hex")}`;
  }

  private currentMetrics(): DurableMetrics {
    const totals = this.ledger.totals();
    const usefulTokens = this.cfg.totalSteps * this.cfg.stepTokenCost;
    return {
      tokensConsumed: this.tokensConsumed,
      wastedTokens: this.cfg.mode === "naive" && this.crashCount > 0 ? Math.max(0, this.tokensConsumed - usefulTokens) : 0,
      tokensAvoidedByReplay: this.replayedSteps * this.cfg.stepTokenCost,
      sideEffects: this.sideEffects,
      duplicateSideEffects: this.duplicateSideEffects,
      replayedSteps: this.replayedSteps,
      checkpointBytes: totals.checkpointBytes,
      volatileBytesLost: totals.lostBytes,
      cumulativeBytes: totals.cumulativeBytes,
      payloadBytesPerStep: this.cfg.payloadBytesPerStep,
    };
  }

  private currentSteps(): StepRecord[] {
    return [...this.stepLog].sort((left, right) => left.step - right.step).map((record) => ({ ...record }));
  }

  private recentEvents(): SimEvent[] {
    const start = Math.max(0, this.sim.log.length - this.cfg.eventHistoryLimit);
    const events: SimEvent[] = [];
    for (let index = start; index < this.sim.log.length; index += 1) {
      const event = this.sim.log[index];
      if (!event) continue;
      events.push({
        id: event.id,
        t: event.t,
        kind: event.kind,
        corr: event.corr,
        ...(event.parent !== undefined ? { parent: event.parent } : {}),
        data: { ...event.data },
      });
    }
    return events;
  }
}

function resolveConfig(input: DurableConfigInput): DurableConfig {
  if (input.mode !== "naive" && input.mode !== "resilient") throw new RangeError("mode must be naive or resilient");
  if (typeof input.runId !== "string" || !RUN_ID.test(input.runId)) throw new RangeError("runId must be 1-64 safe identifier characters");
  const seed = requireInt("seed", input.seed, 0, 0xffff_ffff);
  const totalSteps = input.totalSteps === undefined ? DEFAULT_TOTAL_STEPS : requireInt("totalSteps", input.totalSteps, 1, DURABLE_STEP_NAMES.length);
  const crashAtStep = input.crashAtStep === undefined ? DEFAULT_CRASH_AT_STEP : requireInt("crashAtStep", input.crashAtStep, 1, totalSteps);
  if (crashAtStep < 1 || crashAtStep > totalSteps) throw new RangeError(`crashAtStep must be an integer in [1, ${totalSteps}]`);
  const payloadDefault = input.mode === "naive" ? NAIVE_STATE_WRITE_BYTES : COMPACT_CHECKPOINT_BYTES;
  return {
    mode: input.mode,
    seed,
    runId: input.runId,
    totalSteps,
    crashAtStep,
    stepTokenCost: input.stepTokenCost === undefined ? DEFAULT_STEP_TOKEN_COST : requireInt("stepTokenCost", input.stepTokenCost, 1, 1_000_000),
    stepDurationMs: input.stepDurationMs === undefined ? DEFAULT_STEP_DURATION_MS : requireInt("stepDurationMs", input.stepDurationMs, 0, 60_000),
    payloadBytesPerStep: input.payloadBytesPerStep === undefined ? payloadDefault : requireInt("payloadBytesPerStep", input.payloadBytesPerStep, COMPACT_CHECKPOINT_BYTES, NAIVE_STATE_WRITE_BYTES),
    maxEvents: input.maxEvents === undefined ? 2_000 : requireInt("maxEvents", input.maxEvents, 1, MAX_EVENTS),
    maxSteps: input.maxSteps === undefined ? 10_000 : requireInt("maxSteps", input.maxSteps, 1, MAX_SCHEDULER_STEPS),
    eventHistoryLimit: input.eventHistoryLimit === undefined ? 2_000 : requireInt("eventHistoryLimit", input.eventHistoryLimit, 1, MAX_EVENTS),
  };
}
