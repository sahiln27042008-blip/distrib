import type { Sim } from "../kernel.ts";

export type BatchPolicy = "clean" | "socket_drop" | "rate_limit" | "poison_pill" | "legacy_no_idem";
export type GatewayChaosMode = "naive" | "resilient";

export interface ToolGatewayDialConfig {
  batchPolicy?: BatchPolicy;
  poisonIndex?: number;
}

export type BatchItemStatus = "succeeded" | "failed" | "aborted" | "duplicate_rejected";

export interface BatchItemResult {
  item: number;
  status: BatchItemStatus;
  statusCode: number;
  reason?: string;
}

export interface ToolGatewayStats {
  batchItemsSucceeded: number;
  batchItemsFailed: number;
  innocentBatchTasksAborted: number;
  duplicateItemsAccepted: number;
  duplicateItemsRejected: number;
}

const RATE_LIMIT_P = 0.2;

export class MockToolGateway {
  readonly totalItems = 50;
  readonly poisonItem: number;
  readonly malformedUtf8 = Buffer.from([0xc3, 0x28]);
  readonly dialConfig: ToolGatewayDialConfig;
  batchItemsSucceeded = 0;
  batchItemsFailed = 0;
  innocentBatchTasksAborted = 0;
  duplicateItemsAccepted = 0;
  duplicateItemsRejected = 0;
  readonly results: BatchItemResult[] = [];
  #seen = new Set<string>();
  #emitted = 0;

  constructor(dialConfig: ToolGatewayDialConfig = {}) {
    this.dialConfig = dialConfig;
    this.poisonItem = dialConfig.poisonIndex ?? 27;
  }

  validatesPoison(): boolean {
    return this.malformedUtf8.toString("utf8").includes("\uFFFD");
  }

  // Run one 50-item batch. No policy: old harness behavior (naive aborts all
  // innocents on poison, resilient unrolls). Policy set: policy decides.
  // Calling twice models a retry: dedup applies except for legacy_no_idem.
  executeBatch(sim: Sim, mode: GatewayChaosMode = "resilient"): BatchItemResult[] {
    const policy = this.dialConfig.batchPolicy;
    const out: BatchItemResult[] = [];
    const push = (r: BatchItemResult): void => {
      out.push(r);
      this.results.push(r);
    };
    const fail = (item: number, statusCode: number, reason: string): void => {
      this.batchItemsFailed += 1;
      push({ item, status: "failed", statusCode, reason });
    };
    const abort = (item: number, reason: string): void => {
      this.innocentBatchTasksAborted += 1;
      push({ item, status: "aborted", statusCode: 0, reason });
    };

    if (policy === undefined && mode === "naive") {
      for (let item = 1; item <= this.totalItems; item++) {
        if (item === this.poisonItem) fail(item, 400, "invalid_utf8");
        else abort(item, "atomic_batch_rejected");
      }
      return out;
    }

    const dropAt = Math.floor(this.totalItems / 2);
    let dropped = false;
    for (let item = 1; item <= this.totalItems; item++) {
      if (dropped) {
        abort(item, "socket_drop");
        continue;
      }
      if (policy === "socket_drop" && item === dropAt) {
        dropped = true;
        fail(item, 0, "socket_drop");
        continue;
      }
      if (policy === "rate_limit" && sim.rng.next() < RATE_LIMIT_P) {
        fail(item, 429, "rate_limited");
        continue;
      }
      if ((policy === undefined || policy === "poison_pill") && item === this.poisonItem) {
        fail(item, 400, "invalid_utf8");
        continue;
      }
      const key = `item-${item}`;
      const dup = this.#seen.has(key);
      if (dup && policy !== undefined && policy !== "legacy_no_idem") {
        this.duplicateItemsRejected += 1;
        push({ item, status: "duplicate_rejected", statusCode: 409, reason: "idempotency_key_seen" });
        continue;
      }
      if (dup && policy === "legacy_no_idem") this.duplicateItemsAccepted += 1;
      this.#seen.add(key);
      this.batchItemsSucceeded += 1;
      push({ item, status: "succeeded", statusCode: 200 });
    }
    return out;
  }

  getStats(): ToolGatewayStats {
    return {
      batchItemsSucceeded: this.batchItemsSucceeded,
      batchItemsFailed: this.batchItemsFailed,
      innocentBatchTasksAborted: this.innocentBatchTasksAborted,
      duplicateItemsAccepted: this.duplicateItemsAccepted,
      duplicateItemsRejected: this.duplicateItemsRejected,
    };
  }

  // Emit batch.item.* events for results not yet emitted.
  emitTraceSpans(sim: Sim, parentEventId?: string): void {
    const batch_policy = this.dialConfig.batchPolicy ?? "default";
    for (; this.#emitted < this.results.length; this.#emitted++) {
      const r = this.results[this.#emitted]!;
      const data: Record<string, unknown> = { item: r.item, statusCode: r.statusCode, batch_policy };
      if (r.reason !== undefined) data.reason = r.reason;
      sim.emit(`batch.item.${r.status}`, "tool-gateway", data, parentEventId);
    }
  }
}
