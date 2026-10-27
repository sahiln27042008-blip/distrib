// enterpriseee/enterprise-simulator/src/physics/alphabet/consonants/delay.ts

import type { Sim, Rng } from "../../../kernel.ts";
import type { Vowel, ConsonantResult, DelayConsonant } from "../types.ts";
import { Channel } from "../vowels/channel.ts";
import { Log } from "../vowels/log.ts";
import type { Cell } from "../vowels/cell.ts";
import type { Lease } from "../vowels/lease.ts";

export interface DelayOpts {
  durationMs: number;
  payload?: unknown;
  targetCell?: Cell;
  heldLease?: Lease;
  autoAdvance?: boolean;
}

export function applyDelay(
  sim: Sim,
  target: Vowel,
  opts: DelayOpts,
  _rng?: Rng,
): ConsonantResult {
  const durationMs = opts.durationMs;

  sim.emit("consonant.delay.start", target.id, {
    targetId: target.id,
    targetKind: target.kind,
    durationMs,
  });

  if (target instanceof Channel) {
    // If a lease was acquired and held during channel call, ensure it's occupied during durationMs
    if (opts.heldLease && opts.heldLease.heldDuringExternalChannel) {
      opts.heldLease.acquire(target.sourceActorId, sim.now, sim);
    }

    const channelRes = target.send(
      sim,
      opts.payload ?? { action: "delayed_message" },
      opts.targetCell,
      {
        delayMs: durationMs,
        heldLease: opts.heldLease,
        autoAdvance: opts.autoAdvance ?? true,
      },
    );

    if (opts.heldLease && opts.heldLease.heldDuringExternalChannel) {
      opts.heldLease.release(target.sourceActorId, sim.now, sim);
    }

    if (durationMs > target.timeoutMs) {
      sim.emit("consonant.delay.timeout", target.id, {
        channelId: target.id,
        durationMs,
        timeoutMs: target.timeoutMs,
        callerObservation: channelRes.callerObservation,
        targetCommitted: channelRes.targetCommitted,
      });
    }

    sim.emit("consonant.delay.complete", target.id, {
      channelId: target.id,
      durationMs,
      callerObservation: channelRes.callerObservation,
      targetCommitted: channelRes.targetCommitted,
    });

    return {
      ok: true,
      consonant: "DELAY",
      targetId: target.id,
      details: {
        channelResult: channelRes,
        timedOut: durationMs > target.timeoutMs,
      },
    };
  }

  if (target instanceof Log) {
    // For LOG: delay compaction - entries remain uncompacted for that duration
    const originalLag = target.compactionLagMs;
    target.compactionLagMs += durationMs;

    sim.emit("consonant.delay.complete", target.id, {
      logId: target.id,
      durationMs,
      originalLagMs: originalLag,
      newLagMs: target.compactionLagMs,
    });

    return {
      ok: true,
      consonant: "DELAY",
      targetId: target.id,
      details: {
        originalLagMs: originalLag,
        newLagMs: target.compactionLagMs,
      },
    };
  }

  throw new Error(`DELAY consonant cannot be applied to target kind: ${target.kind}`);
}

