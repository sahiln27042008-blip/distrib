// enterpriseee/enterprise-simulator/src/physics/alphabet/consonants/sever.ts

import type { Sim, Rng } from "../../../kernel.ts";
import type { Vowel, ConsonantResult } from "../types.ts";
import { Channel } from "../vowels/channel.ts";
import type { Cell } from "../vowels/cell.ts";

export interface SeverOpts {
  phase: "PRE_COMMIT" | "POST_COMMIT";
  payload?: unknown;
  targetCell?: Cell;
  dedupKey?: string;
  epoch?: number;
  autoAdvance?: boolean;
}

export function applySever(
  sim: Sim,
  target: Vowel,
  opts: SeverOpts,
  _rng?: Rng,
): ConsonantResult {
  if (!(target instanceof Channel)) {
    throw new Error(`SEVER consonant cannot be applied to target kind: ${target.kind}`);
  }

  const phase = opts.phase;

  if (phase === "PRE_COMMIT") {
    sim.emit("consonant.sever.pre_commit", target.id, {
      channelId: target.id,
      phase: "PRE_COMMIT",
      note: "target will never receive request",
    });

    const channelRes = target.send(
      sim,
      opts.payload ?? { action: "sever_pre_commit" },
      opts.targetCell,
      {
        severPhase: "PRE_COMMIT",
        autoAdvance: opts.autoAdvance ?? true,
      },
    );

    return {
      ok: true,
      consonant: "SEVER",
      targetId: target.id,
      details: {
        phase: "PRE_COMMIT",
        targetCommitted: channelRes.targetCommitted,
        callerObservation: channelRes.callerObservation,
      },
    };
  }

  if (phase === "POST_COMMIT") {
    sim.emit("consonant.sever.post_commit", target.id, {
      channelId: target.id,
      phase: "POST_COMMIT",
      note: "target commits but ack lost",
    });

    const channelRes = target.send(
      sim,
      opts.payload ?? { action: "sever_post_commit" },
      opts.targetCell,
      {
        severPhase: "POST_COMMIT",
        dedupKey: opts.dedupKey,
        epoch: opts.epoch,
        autoAdvance: opts.autoAdvance ?? true,
      },
    );

    return {
      ok: true,
      consonant: "SEVER",
      targetId: target.id,
      details: {
        phase: "POST_COMMIT",
        targetCommitted: channelRes.targetCommitted,
        ackReceived: channelRes.ackReceived,
        callerObservation: channelRes.callerObservation,
        divergenceDetected: channelRes.divergenceDetected,
      },
    };
  }

  throw new Error(`Unknown sever phase: ${phase}`);
}

