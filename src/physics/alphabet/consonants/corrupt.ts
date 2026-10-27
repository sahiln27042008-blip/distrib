// enterpriseee/enterprise-simulator/src/physics/alphabet/consonants/corrupt.ts

import type { Sim, Rng } from "../../../kernel.ts";
import type { Vowel, ConsonantResult } from "../types.ts";
import { Channel } from "../vowels/channel.ts";
import { Log, type LogEntry } from "../vowels/log.ts";

export interface CorruptOpts {
  mode: "LOSSY_DROP" | "SCHEMA_DRIFT" | "POISON_PILL";
  selector?: {
    count?: number;
    itemIndex?: number;
  };
  payload?: unknown;
  transform?: (data: unknown) => unknown;
}

export function applyCorrupt(
  sim: Sim,
  target: Vowel,
  opts: CorruptOpts,
  rng?: Rng,
): ConsonantResult {
  const mode = opts.mode;

  if (mode === "LOSSY_DROP") {
    if (!(target instanceof Log)) {
      throw new Error(`LOSSY_DROP corrupt mode requires a LOG target, got: ${target.kind}`);
    }

    const dropCount = opts.selector?.count ?? 1;
    const activeRng = rng ?? sim.rng;
    const droppedIndices: number[] = [];
    const droppedEntries: LogEntry[] = [];

    for (let i = 0; i < dropCount && target.entries.length > 0; i++) {
      const idx = activeRng.int(0, target.entries.length - 1);
      const [removed] = target.entries.splice(idx, 1);
      if (removed) {
        droppedIndices.push(idx);
        droppedEntries.push(removed);
        sim.emit("log.entry_dropped", target.id, {
          logId: target.id,
          droppedIndex: idx,
          writtenAt: removed.writtenAt,
          dedupKey: removed.dedupKey,
        });
      }
    }

    sim.emit("consonant.corrupt.lossy_drop", target.id, {
      logId: target.id,
      requestedDropCount: dropCount,
      actualDroppedCount: droppedEntries.length,
      remainingEntries: target.entries.length,
    });

    return {
      ok: true,
      consonant: "CORRUPT",
      targetId: target.id,
      details: {
        mode,
        droppedCount: droppedEntries.length,
        droppedIndices,
      },
    };
  }

  if (mode === "SCHEMA_DRIFT") {
    if (!(target instanceof Channel)) {
      throw new Error(`SCHEMA_DRIFT corrupt mode requires a CHANNEL target, got: ${target.kind}`);
    }

    const defaultTransform = (data: unknown): Record<string, unknown> => {
      if (typeof data === "object" && data !== null) {
        const copy = { ...(data as Record<string, unknown>) };
        // Deterministically mutate schema: rename or nest fields
        const keys = Object.keys(copy);
        if (keys.length > 0 && keys[0]) {
          const firstKey = keys[0];
          copy[`drifted_${firstKey}`] = copy[firstKey];
          delete copy[firstKey];
        } else {
          copy.drifted_timestamp = "drift_string_instead_of_number";
        }
        return copy;
      }
      return { raw: data, schema_drifted: true };
    };

    const transformFn = opts.transform ?? defaultTransform;
    const originalPayload = opts.payload ?? { id: "tx_123", amount: 100 };
    const driftedPayload = transformFn(originalPayload);

    sim.emit("channel.schema_drift_detected", target.id, {
      channelId: target.id,
      originalPayload,
      driftedPayload,
    });

    sim.emit("consonant.corrupt.schema_drift", target.id, {
      channelId: target.id,
      driftApplied: true,
    });

    return {
      ok: true,
      consonant: "CORRUPT",
      targetId: target.id,
      details: {
        mode,
        originalPayload,
        driftedPayload,
      },
    };
  }

  if (mode === "POISON_PILL") {
    const itemIndex = opts.selector?.itemIndex;
    if (itemIndex === undefined) {
      throw new Error("POISON_PILL corrupt mode requires selector.itemIndex to be specified (no hardcoded default)");
    }

    sim.emit("consonant.corrupt.poison_pill", target.id, {
      targetId: target.id,
      targetKind: target.kind,
      itemIndex,
      failureInduced: true,
    });

    return {
      ok: false,
      consonant: "CORRUPT",
      targetId: target.id,
      details: {
        mode,
        poisonItemIndex: itemIndex,
        failure: "POISON_PILL_FAILURE",
      },
    };
  }

  throw new Error(`Unknown corrupt mode: ${mode}`);
}

