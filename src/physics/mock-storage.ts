import { Rng, type Sim } from "../kernel.ts";

// Physics-layer MockStorage. Standalone: does not import durable.ts.
// No clock, disk, or network. Randomness comes from a private seeded Rng.

export const COMPACT_CHECKPOINT_BYTES = 136;
export const NAIVE_STATE_WRITE_BYTES = 15_000_000;
export const ZERO_HOLD_STATE_BYTES = 4_096;

export type WriteAmpMode =
  | "zero_hold_2ms"
  | "stream_hog_30s"
  | "write_amp_15mb"
  | "hydration_freeze_4s"
  | "in_doubt_zombie_tx";

export type StorageClass = "primary" | "object" | "external";

export interface MockStorageDialConfig {
  writeAmpMode?: WriteAmpMode;
  compactCheckpointBytes?: number; // default 136
  naiveStateWriteBytes?: number; // default 15_000_000
  seed?: number; // default 0
}

export interface MockStorageStats {
  bytesWritten: number;
  frozenQueries: number;
  checkpointsWritten: number;
  checkpointBytes: number;
  stateWrites: number;
  stepsReplayed: number;
  tokensWasted: number;
  holdMs: number;
  maxHoldMs: number;
}

interface WriteRecord {
  op: "checkpoint" | "state";
  bytes: number;
  storageClass: StorageClass;
  offloaded: boolean;
  holdMs: number;
}

const STATE_HOLD_MS: Record<WriteAmpMode | "default", number> = {
  default: 1_500,
  zero_hold_2ms: 2,
  stream_hog_30s: 30_000,
  write_amp_15mb: 1_500,
  hydration_freeze_4s: 4_000,
  in_doubt_zombie_tx: 4_000,
};
const CHECKPOINT_HOLD_MS = 1;
const JITTER_MAX_MS = 9;

function requirePositiveInt(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function requireNonNegativeInt(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
  return value;
}

export class MockStorage {
  readonly writeAmpMode: WriteAmpMode | undefined;
  readonly compactCheckpointBytes: number;
  readonly naiveStateWriteBytes: number;
  readonly seed: number;

  private readonly rng: Rng;
  private ops: WriteRecord[] = [];
  private bytesWritten = 0;
  private frozenQueries = 0;
  private checkpointsWritten = 0;
  private checkpointBytes = 0;
  private stateWrites = 0;
  private stepsReplayed = 0;
  private tokensWasted = 0;
  private holdMs = 0;
  private maxHoldMs = 0;

  constructor(dialConfig?: MockStorageDialConfig) {
    this.writeAmpMode = dialConfig?.writeAmpMode;
    this.compactCheckpointBytes = requirePositiveInt("compactCheckpointBytes", dialConfig?.compactCheckpointBytes ?? COMPACT_CHECKPOINT_BYTES);
    this.naiveStateWriteBytes = requirePositiveInt("naiveStateWriteBytes", dialConfig?.naiveStateWriteBytes ?? NAIVE_STATE_WRITE_BYTES);
    this.seed = dialConfig?.seed ?? 0;
    this.rng = new Rng(this.seed);
  }

  // Compact claim-check checkpoint (136 bytes by default). Object store, offloaded.
  writeCheckpoint(): number {
    const bytes = this.compactCheckpointBytes;
    const hold = CHECKPOINT_HOLD_MS + this.rng.int(0, JITTER_MAX_MS);
    this.bytesWritten += bytes;
    this.checkpointBytes += bytes;
    this.checkpointsWritten += 1;
    this.recordHold(hold);
    this.ops.push({ op: "checkpoint", bytes, storageClass: "object", offloaded: true, holdMs: hold });
    return bytes;
  }

  // Full state snapshot. 4KB in zero_hold (offloaded), naive size otherwise (primary).
  writeState(): number {
    const mode = this.writeAmpMode;
    const zeroHold = mode === "zero_hold_2ms";
    const bytes = zeroHold ? ZERO_HOLD_STATE_BYTES : this.naiveStateWriteBytes;
    const hold = STATE_HOLD_MS[mode ?? "default"] + this.rng.int(0, JITTER_MAX_MS);
    this.bytesWritten += bytes;
    this.stateWrites += 1;
    if (mode === "in_doubt_zombie_tx") this.frozenQueries += 1;
    this.recordHold(hold);
    this.ops.push({
      op: "state",
      bytes,
      storageClass: zeroHold ? "external" : "primary",
      offloaded: zeroHold,
      holdMs: hold,
    });
    return bytes;
  }

  // Records a post-resume replay: steps re-executed and the tokens burned doing it.
  recordReplay(steps: number, tokensPerStep: number): void {
    requireNonNegativeInt("steps", steps);
    requireNonNegativeInt("tokensPerStep", tokensPerStep);
    this.stepsReplayed += steps;
    this.tokensWasted += steps * tokensPerStep;
  }

  getStats(): MockStorageStats {
    return {
      bytesWritten: this.bytesWritten,
      frozenQueries: this.frozenQueries,
      checkpointsWritten: this.checkpointsWritten,
      checkpointBytes: this.checkpointBytes,
      stateWrites: this.stateWrites,
      stepsReplayed: this.stepsReplayed,
      tokensWasted: this.tokensWasted,
      holdMs: this.holdMs,
      maxHoldMs: this.maxHoldMs,
    };
  }

  // Emits one "storage_write" event per write. Attrs live in event data.
  emitTraceSpans(sim: Sim, parentEventId?: string): void {
    const corr = `storage-${this.seed}`;
    for (const op of this.ops) {
      sim.emit("storage_write", corr, {
        step_type: "storage_write",
        op: op.op,
        payload_size: op.bytes,
        storage_class: op.storageClass,
        offloaded: op.offloaded,
        hold_ms: op.holdMs,
        ...(this.writeAmpMode !== undefined ? { write_amp_mode: this.writeAmpMode } : {}),
      }, parentEventId);
    }
  }

  private recordHold(hold: number): void {
    this.holdMs += hold;
    if (hold > this.maxHoldMs) this.maxHoldMs = hold;
  }
}
