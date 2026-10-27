// enterpriseee/enterprise-simulator/src/physics/alphabet/consonants/wipe.ts

import type { Sim, Rng } from "../../../kernel.ts";
import type { Vowel, ConsonantResult } from "../types.ts";
import { Cell } from "../vowels/cell.ts";
import { Lease } from "../vowels/lease.ts";

export interface WipeOpts {
  scope: "VOLATILE_CELLS" | "LEASE_EPOCH";
  actorId?: string;
  cells?: Cell[];
  leases?: Lease[];
  cellIds?: string[];
  leaseIds?: string[];
}

export function applyWipe(
  sim: Sim,
  target: Vowel | { id: string; actorId?: string },
  opts: WipeOpts,
  _rng?: Rng,
): ConsonantResult {
  const scope = opts.scope;
  const targetActorId = ("actorId" in target && target.actorId) ? target.actorId : target.id;

  if (scope === "VOLATILE_CELLS") {
    const wipedCells: string[] = [];
    const preservedCells: string[] = [];

    const cellsToInspect: Cell[] = opts.cells ?? [];
    if (target instanceof Cell) {
      cellsToInspect.push(target);
    }

    for (const cell of cellsToInspect) {
      if (cell.persistence === "VOLATILE") {
        cell.wipeVolatile(sim);
        wipedCells.push(cell.id);
      } else {
        preservedCells.push(cell.id);
      }
    }

    sim.emit("consonant.wipe.volatile", target.id, {
      actorId: targetActorId,
      wipedCellCount: wipedCells.length,
      preservedCellCount: preservedCells.length,
      wipedCells,
      preservedCells,
    });

    return {
      ok: true,
      consonant: "WIPE",
      targetId: target.id,
      details: {
        scope,
        wipedCells,
        preservedCells,
      },
    };
  }

  if (scope === "LEASE_EPOCH") {
    const leasesToInspect: Lease[] = opts.leases ?? [];
    if (target instanceof Lease) {
      leasesToInspect.push(target);
    }

    const updatedLeases: Array<{ id: string; oldEpoch: number; newEpoch: number }> = [];

    for (const lease of leasesToInspect) {
      const oldEpoch = lease.currentEpoch;
      lease.currentEpoch++;
      lease.holders = [];
      lease.currentLoad = 0;

      sim.emit("lease.epoch_invalidated", lease.id, {
        leaseId: lease.id,
        actorId: lease.actorId,
        oldEpoch,
        newEpoch: lease.currentEpoch,
      });

      updatedLeases.push({
        id: lease.id,
        oldEpoch,
        newEpoch: lease.currentEpoch,
      });
    }

    sim.emit("consonant.wipe.epoch", target.id, {
      actorId: targetActorId,
      updatedLeasesCount: updatedLeases.length,
      updatedLeases,
    });

    return {
      ok: true,
      consonant: "WIPE",
      targetId: target.id,
      details: {
        scope,
        updatedLeases,
      },
    };
  }

  throw new Error(`Unknown WIPE scope: ${scope}`);
}

