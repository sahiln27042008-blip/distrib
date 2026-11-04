// enterpriseee/enterprise-simulator/src/physics/alphabet/consonants/saturate.ts

import type { Sim, Rng } from "../../../kernel.ts";
import type { Vowel, ConsonantResult } from "../types.ts";
import { Lease } from "../vowels/lease.ts";
import { Log } from "../vowels/log.ts";

export interface SaturateOpts {
  loadUnits: number;
  requesterPrefix?: string;
}

export function applySaturate(
  sim: Sim,
  target: Vowel,
  opts: SaturateOpts,
  _rng?: Rng,
): ConsonantResult {
  const loadUnits = opts.loadUnits;

  sim.emit("consonant.saturate.start", target.id, {
    targetId: target.id,
    targetKind: target.kind,
    loadUnits,
  });

  if (target instanceof Lease) {
    if ((target as any).shedAtThresholdEnabled) {
      sim.emit("lease.load_shed", target.id, {
        leaseId: target.id,
        attemptedUnits: loadUnits,
        policy: "SHED_BEFORE_SATURATION",
        threshold: (target as any).shedThreshold ?? 0.56,
        capacity: target.maxCapacity,
      });
      return {
        ok: true,
        consonant: "SATURATE",
        targetId: target.id,
        details: { shed: true, message: "Load shed at threshold before pool saturation" },
      };
    }

    const prefix = opts.requesterPrefix ?? "saturate-client";
    let appliedUnits = 0;
    let overflowResult: { rejected?: boolean; panicked?: boolean; waitMs?: number } | undefined;

    for (let i = 0; i < loadUnits; i++) {
      const requesterId = `${prefix}-${i}`;
      const acqRes = target.acquire(requesterId, sim.now, sim);

      if (!acqRes.ok) {
        overflowResult = {
          rejected: acqRes.rejected,
          panicked: acqRes.panicked,
          waitMs: acqRes.waitMs,
        };

        sim.emit("consonant.saturate.overflow", target.id, {
          leaseId: target.id,
          attemptedUnits: loadUnits,
          appliedUnits,
          policy: target.overflowPolicy,
          rejected: acqRes.rejected,
          panicked: acqRes.panicked,
        });
        break;
      }
      appliedUnits++;
    }

    sim.emit("consonant.saturate.applied", target.id, {
      leaseId: target.id,
      appliedUnits,
      currentLoad: target.currentLoad,
      maxCapacity: target.maxCapacity,
    });

    return {
      ok: overflowResult ? !overflowResult.panicked && !overflowResult.rejected : true,
      consonant: "SATURATE",
      targetId: target.id,
      details: {
        appliedUnits,
        currentLoad: target.currentLoad,
        maxCapacity: target.maxCapacity,
        overflow: overflowResult,
      },
    };
  }

  if (target instanceof Log) {
    let overflowed = false;
    let appended = 0;

    for (let i = 0; i < loadUnits; i++) {
      const res = target.append({ saturationIndex: i }, undefined, sim);
      if (res.overflow) {
        overflowed = true;
        sim.emit("consonant.saturate.overflow", target.id, {
          logId: target.id,
          attemptedUnits: loadUnits,
          appendedUnits: appended,
          maxCapacity: target.maxCapacity,
        });
        break;
      }
      appended++;
    }

    sim.emit("consonant.saturate.applied", target.id, {
      logId: target.id,
      appendedUnits: appended,
      currentLength: target.entries.length,
      maxCapacity: target.maxCapacity,
    });

    return {
      ok: !overflowed,
      consonant: "SATURATE",
      targetId: target.id,
      details: {
        appendedUnits: appended,
        overflowed,
        currentLength: target.entries.length,
        maxCapacity: target.maxCapacity,
      },
    };
  }

  throw new Error(`SATURATE consonant cannot be applied to target kind: ${target.kind}`);
}

