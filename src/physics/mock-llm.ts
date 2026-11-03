import { createHash } from "node:crypto";
import type { Sim } from "../kernel.ts";

// Physics-layer MockLLM. Standalone: does not import agent-lab.ts.
// With no dialConfig (or no contextMode) respond() is the exact legacy code path.
// With a contextMode, respond() ignores the caller's prompt length and uses a
// deterministic per-turn token model for that context strategy.

export const COST_PER_TOKEN = 0.00003;

export type AgentMode = "naive" | "resilient";

export type ContextMode =
  | "raw_json_80k_flood"
  | "append_only_quadratic"
  | "lossy_llm_summary"
  | "unmapped_schema_drift"
  | "cqrs_duckdb_blackboard_o1";

export interface MockLLMDialConfig {
  contextMode?: ContextMode;
  // Max tokens in any single prompt (contextMode only). Unset = uncapped.
  promptSizeCap?: number;
  // Bytes of tool output added per turn; caps the growth term of flood/quadratic modes.
  toolOutputLimit?: number;
  // respond() throws once this many calls were made (contextMode only).
  maxExecutionSteps?: number;
}

export interface ToolDefinition {
  id: number;
  name: string;
  category: string;
  requiredPermission: string;
  relevanceKeywords: string[];
}

export interface ToolCall {
  toolId: number;
  name: string;
  permission: string;
  args: Record<string, string>;
}

export interface MockLLMResponse {
  response: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  hallucinationCount: number;
}

export interface MockLLMStats {
  calls: number;
  promptTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  turn1Tokens: number;
  turn10Tokens: number;
  signalPct: number;
  ttftMs: number;
  costUsd: number;
  hallucinationCount: number;
  accountsLost: number;
}

interface CallRecord {
  turn: number;
  executionId?: string;
  executionEventId?: string;
  startedAtMs?: number;
  inputHash: string;
  outputHash: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  resumeOfTurn?: number;
}

const FACT_TOKENS = 120; // useful account facts per turn
const BOUNDED_OUTPUT_TOKENS = 400;
const CLAIM_CHECK_BYTES = 250;
const FLOOD_GROWTH_TOKENS = 8_000; // turn 10 = 80_000
const QUADRATIC_GROWTH_TOKENS = 500; // turn n = 500 * n^2
const CQRS_RESUME_TURN = 6;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 4));
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function makeLargeNarrative(seed: number, turn: number, query: string): string {
  const repeated = [
    `Turn ${turn}: ${query}`,
    `Seed ${seed} produced a deterministic support trace with a verified contract review, stable billing state, and a matching account audit.`,
    "The enterprise issue is isolated to an expired entitlement cache, a stale order status, and a failed downstream sync. The root cause remains consistent across every check.",
    "Support reviewed the customer record, contract, payment timeline, shipping state, and the product incident history to confirm the same issue signature before remediation.",
    "The remediation path is safe because the workflow only reads the service state, confirms the contract, and applies a bounded state reset with explicit validation after every step.",
    "This issue was caused by a stale entitlement cache and failed synchronization, not by a payment or shipping failure. The record set and the incident timeline agree on that diagnosis.",
    "The final verification checks the customer status, order state, and service-state output before closing the case. The evidence remains deterministic across runs for this seed.",
    "This is a synthetic enterprise support scenario created for deterministic benchmarking and agent-context comparison. The data is intentionally stable and repeatable across runs.",
  ];
  const fragments: string[] = [];
  for (let index = 0; index < 12; index++) {
    fragments.push(repeated.join(" "));
  }
  return fragments.join("\n");
}

export class MockLLM {
  readonly mode: AgentMode;
  readonly seed: number;
  readonly dialConfig: MockLLMDialConfig | undefined;

  private calls: CallRecord[] = [];
  private cumInput = 0;
  private cumOutput = 0;
  private cumHallucinations = 0;
  private cumUseful = 0;
  private cumAccountsLost = 0;
  private turn1 = 0;
  private turn10 = 0;
  private lastInputTokens = 0;

  constructor(mode: AgentMode, seed: number, dialConfig?: MockLLMDialConfig) {
    this.mode = mode;
    this.seed = seed;
    this.dialConfig = dialConfig === undefined ? undefined : { ...dialConfig };
  }

  get hallucinationCount(): number {
    return this.cumHallucinations;
  }

  get inputTokens(): number {
    return this.cumInput;
  }

  get outputTokens(): number {
    return this.cumOutput;
  }

  respond(prompt: string, tools: ToolDefinition[], turn: number, scenarioState: Record<string, unknown>): MockLLMResponse {
    const contextMode = this.dialConfig?.contextMode;
    const maxSteps = this.dialConfig?.maxExecutionSteps;
    if (contextMode !== undefined && maxSteps !== undefined && this.calls.length >= maxSteps) {
      throw new RangeError(`maxExecutionSteps ${maxSteps} reached`);
    }

    // Legacy path (unchanged).
    const responseBase = makeLargeNarrative(this.seed, turn, String(scenarioState.query ?? "support issue"));
    let response = this.mode === "naive"
      ? responseBase
      : `I reviewed the support state and resolved the issue with the approved workflow. Evidence: ${String(scenarioState.workflowStep ?? "customer support")}.`;

    const toolCalls = tools.slice(0, this.mode === "naive" ? Math.min(tools.length, 18) : Math.min(tools.length, 5)).map((tool, index) => ({
      toolId: tool.id,
      name: tool.name,
      permission: tool.requiredPermission,
      args: {
        query: String(scenarioState.query ?? "customer support issue"),
        turn: String(turn),
        index: String(index),
        mode: this.mode,
      },
    }));

    let hallucinationCount = this.mode === "naive" && ((this.seed + turn * 7) % 5 === 0 || (this.seed + turn * 11) % 5 === 2) ? 1 : 0;
    let inputTokens = estimateTokens(prompt);
    let inputText = prompt;
    let useful = FACT_TOKENS;
    let resumeOfTurn: number | undefined;
    let boundedOutput = false;

    if (contextMode !== undefined) {
      const sizeCap = this.dialConfig?.promptSizeCap;
      const toolLimit = this.dialConfig?.toolOutputLimit;
      const growthCap = toolLimit === undefined ? Infinity : Math.max(1, Math.floor(toolLimit / 4));
      const shortResponse = `I reviewed the support state and resolved the issue with the approved workflow. Evidence: ${String(scenarioState.workflowStep ?? "customer support")}.`;
      switch (contextMode) {
        case "raw_json_80k_flood":
          inputTokens = Math.min(FLOOD_GROWTH_TOKENS, growthCap) * turn;
          break;
        case "append_only_quadratic":
          inputTokens = Math.min(QUADRATIC_GROWTH_TOKENS, growthCap) * turn * turn;
          break;
        case "lossy_llm_summary": {
          inputTokens = Math.min(BOUNDED_OUTPUT_TOKENS, 300 + 10 * turn);
          const lost = (this.seed * 31 + turn * 17) % 4 === 0 ? 1 : 0;
          this.cumAccountsLost += lost;
          useful = Math.max(30, FACT_TOKENS - lost * 30);
          hallucinationCount = 0;
          response = shortResponse;
          boundedOutput = true;
          break;
        }
        case "unmapped_schema_drift":
          inputTokens = 600 + 20 * turn;
          useful = Math.max(0, FACT_TOKENS - 10 * turn);
          hallucinationCount = (this.seed + turn) % 2 === 0 ? 1 : 0;
          break;
        case "cqrs_duckdb_blackboard_o1":
          inputTokens = 100 + Math.ceil(CLAIM_CHECK_BYTES / 4);
          hallucinationCount = 0;
          response = shortResponse;
          boundedOutput = true;
          if (turn === CQRS_RESUME_TURN) resumeOfTurn = turn - 1;
          break;
      }
      if (sizeCap !== undefined) inputTokens = Math.min(inputTokens, sizeCap);
      inputTokens = Math.max(1, inputTokens);
      inputText = `ctx:${contextMode}:${this.seed}:${turn}:${inputTokens}`;
    }

    const rawOutput = estimateTokens(response);
    const outputTokens = boundedOutput ? Math.min(BOUNDED_OUTPUT_TOKENS, rawOutput) : rawOutput;
    const totalTokens = inputTokens + outputTokens;
    const costMultiplier = typeof scenarioState.costMultiplier === "number" && Number.isFinite(scenarioState.costMultiplier)
      ? scenarioState.costMultiplier
      : 1;

    this.cumInput += inputTokens;
    this.cumOutput += outputTokens;
    this.cumHallucinations += hallucinationCount;
    this.cumUseful += Math.min(inputTokens, useful);
    this.lastInputTokens = inputTokens;
    if (turn === 1) this.turn1 = inputTokens;
    if (turn === 10) this.turn10 = inputTokens;

    const record: CallRecord = {
      turn,
      inputHash: sha256(inputText),
      outputHash: sha256(response),
      inputTokens,
      outputTokens,
      cost: totalTokens * COST_PER_TOKEN * costMultiplier,
      ...(typeof scenarioState.executionId === "string" ? { executionId: scenarioState.executionId } : {}),
      ...(typeof scenarioState.executionEventId === "string" ? { executionEventId: scenarioState.executionEventId } : {}),
      ...(typeof scenarioState.startedAtMs === "number" ? { startedAtMs: scenarioState.startedAtMs } : {}),
    };
    if (resumeOfTurn !== undefined) record.resumeOfTurn = resumeOfTurn;
    this.calls.push(record);

    return { response, toolCalls, inputTokens, outputTokens, totalTokens, hallucinationCount };
  }

  getStats(): MockLLMStats {
    const totalTokens = this.cumInput + this.cumOutput;
    return {
      calls: this.calls.length,
      promptTokens: this.cumInput,
      inputTokens: this.cumInput,
      outputTokens: this.cumOutput,
      totalTokens,
      turn1Tokens: this.turn1,
      turn10Tokens: this.turn10,
      signalPct: this.cumInput === 0 ? 0 : Math.round((this.cumUseful / this.cumInput) * 10_000) / 100,
      ttftMs: this.calls.length === 0 ? 0 : 50 + Math.ceil(this.lastInputTokens / 50),
      costUsd: totalTokens * COST_PER_TOKEN,
      hallucinationCount: this.cumHallucinations,
      accountsLost: this.cumAccountsLost,
    };
  }

  // Emits one "model_call" event per respond() call. Attrs live in event data;
  // resume_of is a data attr (Span.links only supports retry_of).
  emitTraceSpans(sim: Sim, parentEventId?: string): void {
    const corr = `llm-${this.seed}`;
    const idByTurn = new Map<number, string>();
    for (const call of this.calls) {
      const data: Record<string, unknown> = {
        model: "mock-llm",
        turn: call.turn,
        tokens_in: call.inputTokens,
        tokens_out: call.outputTokens,
        cost: call.cost,
        input_hash: call.inputHash,
        output_hash: call.outputHash,
        ...(call.executionId ? { execution_id: call.executionId } : {}),
        ...(call.startedAtMs !== undefined ? { started_at_ms: call.startedAtMs } : {}),
      };
      if (this.dialConfig?.contextMode !== undefined) data.context_mode = this.dialConfig.contextMode;
      if (call.resumeOfTurn !== undefined) {
        const prior = idByTurn.get(call.resumeOfTurn);
        if (prior !== undefined) data.resume_of = prior;
      }
      const id = sim.emit("model_call", corr, data, call.executionEventId ?? parentEventId);
      idByTurn.set(call.turn, id);
    }
  }
}
