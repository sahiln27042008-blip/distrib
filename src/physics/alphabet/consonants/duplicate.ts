// enterpriseee/enterprise-simulator/src/physics/alphabet/consonants/duplicate.ts

import type { Sim, Rng } from "../../../kernel.ts";
import type { Vowel, ConsonantResult } from "../types.ts";
import { Channel } from "../vowels/channel.ts";
import { Log } from "../vowels/log.ts";
import type { Cell } from "../vowels/cell.ts";

export interface DuplicateOpts {
  count: number;
  payload?: unknown;
  targetCell?: Cell;
  dedupKey?: string;
  epoch?: number;
  autoAdvance?: boolean;
}

export function applyDuplicate(
  sim: Sim,
  target: Vowel,
  opts: DuplicateOpts,
  _rng?: Rng,
): ConsonantResult {
  const count = opts.count;

  sim.emit("consonant.duplicate.start", target.id, {
    targetId: target.id,
    targetKind: target.kind,
    count,
  });

  if (target instanceof Channel) {
    const payload = opts.payload ?? { action: "duplicate_envelope" };
    const results = [];

    for (let i = 0; i < count; i++) {
      sim.emit("consonant.duplicate.iteration", target.id, {
        channelId: target.id,
        iteration: i + 1,
        total: count,
      });

      const res = target.send(sim, payload, opts.targetCell, {
        dedupKey: opts.dedupKey,
        epoch: opts.epoch,
        autoAdvance: opts.autoAdvance ?? true,
      });
      results.push(res);
    }

    sim.emit("consonant.duplicate.complete", target.id, {
      channelId: target.id,
      count,
      targetCommittedTotal: results.filter((r) => r.targetCommitted).length,
    });

    return {
      ok: true,
      consonant: "DUPLICATE",
      targetId: target.id,
      details: {
        count,
        results,
      },
    };
  }

  if (target instanceof Log) {
    const entryValue = opts.payload ?? { action: "duplicate_log_entry" };
    const indices: number[] = [];

    for (let i = 0; i < count; i++) {
      sim.emit("consonant.duplicate.iteration", target.id, {
        logId: target.id,
        iteration: i + 1,
        total: count,
      });

      const res = target.append(entryValue, opts.dedupKey, sim);
      indices.push(res.index);
    }

    sim.emit("consonant.duplicate.complete", target.id, {
      logId: target.id,
      count,
      indices,
    });

    return {
      ok: true,
      consonant: "DUPLICATE",
      targetId: target.id,
      details: {
        count,
        indices,
      },
    };
  }

  throw new Error(`DUPLICATE consonant cannot be applied to target kind: ${target.kind}`);
}

