// enterpriseee/enterprise-simulator/src/physics/alphabet/vowels/cell.ts

import type { Sim } from "../../../kernel.ts";
import type { Vowel } from "../types.ts";

export type CellPersistence = "VOLATILE" | "DURABLE";

export interface CellConfig {
  id: string;
  actorId: string;
  persistence: CellPersistence;
  idempotencyEnforced: boolean;
  fencingTokenEnforced: boolean;
  initialState?: unknown;
  sim?: Sim;
}

export interface CellMutateOpts {
  dedupKey?: string;
  epoch?: number;
  sim?: Sim;
}

export interface CellMutateResult {
  ok: boolean;
  duplicate?: boolean;
  staleEpoch?: boolean;
  mutationCount: number;
}

export class Cell implements Vowel {
  readonly id: string;
  readonly kind = "CELL" as const;
  readonly actorId: string;
  readonly persistence: CellPersistence;
  readonly idempotencyEnforced: boolean;
  readonly fencingTokenEnforced: boolean;

  state: unknown;
  mutationCount = 0;
  epoch = 0;
  lastMutationHash?: string;
  sim?: Sim;

  constructor(config: CellConfig) {
    this.id = config.id;
    this.actorId = config.actorId;
    this.persistence = config.persistence;
    this.idempotencyEnforced = config.idempotencyEnforced;
    this.fencingTokenEnforced = config.fencingTokenEnforced;
    this.state = config.initialState ?? null;
    this.sim = config.sim;
  }

  mutate(value: unknown, opts?: CellMutateOpts, callSim?: Sim): CellMutateResult {
    const activeSim = opts?.sim ?? callSim ?? this.sim;
    const incomingDedupKey =
      opts?.dedupKey ??
      (typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value));

    // Idempotency check
    if (this.idempotencyEnforced && this.lastMutationHash !== undefined && incomingDedupKey === this.lastMutationHash) {
      if (activeSim) {
        activeSim.emit("cell.duplicate_detected", this.id, {
          cellId: this.id,
          actorId: this.actorId,
          dedupKey: incomingDedupKey,
          mutationCount: this.mutationCount,
        });
      }
      return {
        ok: false,
        duplicate: true,
        mutationCount: this.mutationCount,
      };
    }

    // Fencing check
    if (this.fencingTokenEnforced && opts?.epoch !== undefined && opts.epoch < this.epoch) {
      if (activeSim) {
        activeSim.emit("cell.stale_write_rejected", this.id, {
          cellId: this.id,
          actorId: this.actorId,
          incomingEpoch: opts.epoch,
          currentEpoch: this.epoch,
          mutationCount: this.mutationCount,
        });
      }
      return {
        ok: false,
        staleEpoch: true,
        mutationCount: this.mutationCount,
      };
    }

    // Apply mutation
    this.state = value;
    this.mutationCount++;
    this.lastMutationHash = incomingDedupKey;
    if (opts?.epoch !== undefined && opts.epoch > this.epoch) {
      this.epoch = opts.epoch;
    }

    if (activeSim) {
      activeSim.emit("cell.mutate", this.id, {
        cellId: this.id,
        actorId: this.actorId,
        mutationCount: this.mutationCount,
        epoch: this.epoch,
        state: this.state,
      });
    }

    return {
      ok: true,
      mutationCount: this.mutationCount,
    };
  }

  wipeVolatile(callSim?: Sim): { wiped: boolean; newEpoch: number } {
    const activeSim = callSim ?? this.sim;
    if (this.persistence === "VOLATILE") {
      this.state = null;
      this.epoch++;
      this.lastMutationHash = undefined;
      if (activeSim) {
        activeSim.emit("cell.wipe", this.id, {
          cellId: this.id,
          actorId: this.actorId,
          persistence: this.persistence,
          newEpoch: this.epoch,
        });
      }
      return { wiped: true, newEpoch: this.epoch };
    }
    return { wiped: false, newEpoch: this.epoch };
  }

  snapshot(): Record<string, unknown> {
    return {
      id: this.id,
      kind: this.kind,
      actorId: this.actorId,
      persistence: this.persistence,
      idempotencyEnforced: this.idempotencyEnforced,
      fencingTokenEnforced: this.fencingTokenEnforced,
      state: this.state,
      mutationCount: this.mutationCount,
      epoch: this.epoch,
      lastMutationHash: this.lastMutationHash,
    };
  }
}

