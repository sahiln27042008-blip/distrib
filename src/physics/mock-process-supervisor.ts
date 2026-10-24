import type { Sim } from "../kernel.ts";

export type SupervisorChaosMode = "naive" | "resilient";
export type IsolationMode = "god_mode_main_thread" | "walled_garden" | "hitl_fatigue" | "state_leases_ipc_worker";

export interface ProcessSupervisorDialConfig {
  isolationMode?: IsolationMode;
}

export interface ToolCallOptions {
  sigsegv?: boolean; // tool triggers a native crash
  injection?: boolean; // call carries a prompt-injection attempt
}

export interface ToolCallResult {
  allowed: boolean;
  hostState: "online" | "crashed";
  contained: boolean;
  workerId: string | null;
}

export interface ProcessSupervisorStats {
  mainHostCrashes: number;
  containedWorkerCrashes: number;
  toolCallsAllowed: number;
  toolCallsBlocked: number;
  injectionAttempts: number;
  injectionBlocked: number;
}

export class MockProcessSupervisor {
  hostState: "online" | "crashed" = "online";
  workerState: "idle" | "busy" | "crashed" = "idle";
  mainHostCrashes = 0;
  containedWorkerCrashes = 0;
  toolCallsAllowed = 0;
  toolCallsBlocked = 0;
  injectionAttempts = 0;
  injectionBlocked = 0;
  readonly dialConfig: ProcessSupervisorDialConfig;
  #hitlBlockNext = true; // hitl_fatigue: global boolean flips each call
  #emittedHost = 0;
  #emittedWorker = 0;

  constructor(dialConfig: ProcessSupervisorDialConfig = {}) {
    this.dialConfig = dialConfig;
  }

  // Original API. With isolationMode unset: identical to the old class.
  failNative(mode: SupervisorChaosMode): { hostState: "online" | "crashed"; workerId: string; contained: boolean } {
    if (this.dialConfig.isolationMode !== undefined) {
      const r = this.callTool({ sigsegv: true });
      return { hostState: r.hostState, workerId: r.workerId ?? "none", contained: r.contained };
    }
    if (mode === "naive") {
      this.hostState = "crashed";
      this.mainHostCrashes += 1;
      return { hostState: this.hostState, workerId: "main-host", contained: false };
    }
    this.workerState = "busy";
    this.workerState = "crashed";
    this.containedWorkerCrashes += 1;
    return { hostState: this.hostState, workerId: "native-worker-1", contained: true };
  }

  // New: one tool call routed through the configured isolation mode.
  callTool(opts: ToolCallOptions = {}): ToolCallResult {
    const mode = this.dialConfig.isolationMode ?? "god_mode_main_thread";
    if (opts.injection) this.injectionAttempts += 1;
    const blocked = (): ToolCallResult => {
      this.toolCallsBlocked += 1;
      if (opts.injection) this.injectionBlocked += 1;
      return { allowed: false, hostState: this.hostState, contained: false, workerId: null };
    };
    if (this.hostState === "crashed") return blocked();
    if (mode === "walled_garden") return blocked();
    if (mode === "hitl_fatigue") {
      const deny = this.#hitlBlockNext;
      this.#hitlBlockNext = !this.#hitlBlockNext;
      if (deny) return blocked();
    }
    if (mode === "state_leases_ipc_worker" && opts.injection) return blocked(); // lease scope denies it
    this.toolCallsAllowed += 1;
    if (!opts.sigsegv) return { allowed: true, hostState: this.hostState, contained: false, workerId: null };
    if (mode === "state_leases_ipc_worker") {
      this.workerState = "busy";
      this.workerState = "crashed";
      this.containedWorkerCrashes += 1;
      return { allowed: true, hostState: this.hostState, contained: true, workerId: "native-worker-1" };
    }
    this.hostState = "crashed";
    this.mainHostCrashes += 1;
    return { allowed: true, hostState: this.hostState, contained: false, workerId: "main-host" };
  }

  getStats(): ProcessSupervisorStats {
    return {
      mainHostCrashes: this.mainHostCrashes,
      containedWorkerCrashes: this.containedWorkerCrashes,
      toolCallsAllowed: this.toolCallsAllowed,
      toolCallsBlocked: this.toolCallsBlocked,
      injectionAttempts: this.injectionAttempts,
      injectionBlocked: this.injectionBlocked,
    };
  }

  // Emit auditor-compatible events for crashes not yet emitted.
  emitTraceSpans(sim: Sim, parentEventId?: string): void {
    const isolation_mode = this.dialConfig.isolationMode ?? "default";
    for (; this.#emittedHost < this.mainHostCrashes; this.#emittedHost++) {
      sim.emit("process.main_host.crashed", "process-supervisor", { signal: "SIGSEGV", exitCode: 139, simulated: true, isolation_mode }, parentEventId);
    }
    for (; this.#emittedWorker < this.containedWorkerCrashes; this.#emittedWorker++) {
      const spawn = sim.emit("worker.spawn", "process-supervisor", { workerId: "native-worker-1", boundary: "simulated-child", isolation_mode }, parentEventId);
      sim.emit("worker.exit", "process-supervisor", { workerId: "native-worker-1", signal: "SIGSEGV", exitCode: 139, contained: true, isolation_mode }, spawn);
    }
  }

  reset(): void {
    this.hostState = "online";
    this.workerState = "idle";
    this.mainHostCrashes = 0;
    this.containedWorkerCrashes = 0;
    this.toolCallsAllowed = 0;
    this.toolCallsBlocked = 0;
    this.injectionAttempts = 0;
    this.injectionBlocked = 0;
    this.#hitlBlockNext = true;
    this.#emittedHost = 0;
    this.#emittedWorker = 0;
  }
}
