// enterpriseee/enterprise-simulator/src/physics/alphabet/apply.ts

import type { Sim, Rng } from "../../kernel.ts";
import type { Vowel, Consonant, ConsonantResult } from "./types.ts";
import { applyDelay } from "./consonants/delay.ts";
import { applySever } from "./consonants/sever.ts";
import { applyDuplicate } from "./consonants/duplicate.ts";
import { applySaturate } from "./consonants/saturate.ts";
import { applyWipe } from "./consonants/wipe.ts";
import { applyCorrupt } from "./consonants/corrupt.ts";

export function applyConsonant(
  sim: Sim,
  target: Vowel | { id: string; actorId?: string; kind?: string },
  consonant: Consonant,
  opts?: Record<string, unknown>,
  rng?: Rng,
): ConsonantResult {
  switch (consonant.kind) {
    case "DELAY": {
      if (!("kind" in target) || (target.kind !== "CHANNEL" && target.kind !== "LOG")) {
        throw new Error(`DELAY requires CHANNEL or LOG target, got: ${target.kind ?? "unknown"}`);
      }
      return applyDelay(
        sim,
        target as Vowel,
        {
          durationMs: consonant.durationMs,
          ...opts,
        },
        rng,
      );
    }

    case "SEVER": {
      if (!("kind" in target) || target.kind !== "CHANNEL") {
        throw new Error(`SEVER requires CHANNEL target, got: ${target.kind ?? "unknown"}`);
      }
      return applySever(
        sim,
        target as Vowel,
        {
          phase: consonant.phase,
          ...opts,
        },
        rng,
      );
    }

    case "DUPLICATE": {
      if (!("kind" in target) || (target.kind !== "CHANNEL" && target.kind !== "LOG")) {
        throw new Error(`DUPLICATE requires CHANNEL or LOG target, got: ${target.kind ?? "unknown"}`);
      }
      return applyDuplicate(
        sim,
        target as Vowel,
        {
          count: consonant.count,
          ...opts,
        },
        rng,
      );
    }

    case "SATURATE": {
      if (!("kind" in target) || (target.kind !== "LEASE" && target.kind !== "LOG")) {
        throw new Error(`SATURATE requires LEASE or LOG target, got: ${target.kind ?? "unknown"}`);
      }
      return applySaturate(
        sim,
        target as Vowel,
        {
          loadUnits: consonant.loadUnits,
          ...opts,
        },
        rng,
      );
    }

    case "WIPE": {
      return applyWipe(
        sim,
        target as any,
        {
          scope: consonant.scope,
          cellIds: consonant.cellIds,
          leaseIds: consonant.leaseIds,
          ...opts,
        },
        rng,
      );
    }

    case "CORRUPT": {
      return applyCorrupt(
        sim,
        target as Vowel,
        {
          mode: consonant.mode,
          selector: consonant.selector,
          ...opts,
        },
        rng,
      );
    }

    default: {
      const exhaustiveCheck: never = consonant;
      throw new Error(`Unknown consonant: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

