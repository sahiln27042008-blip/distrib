// enterpriseee/enterprise-simulator/src/physics/alphabet/apply.ts

import type { Sim, Rng } from "../../kernel.ts";
import type { Vowel, Consonant, ConsonantResult } from "./types.ts";
import { applyDelay } from "./consonants/delay.ts";
import { applySever } from "./consonants/sever.ts";
import { applyDuplicate } from "./consonants/duplicate.ts";
import { applySaturate } from "./consonants/saturate.ts";
import { applyWipe } from "./consonants/wipe.ts";
import { applyCorrupt } from "./consonants/corrupt.ts";

const aliasMap: Record<string, string> = {
  TIMING: "DELAY",
  OMISSION: "SEVER",
  DUPLICATION: "DUPLICATE",
  SATURATE: "SATURATE",
  CRASH_AMNESIA: "WIPE",
  BYZANTINE: "CORRUPT",
};

export function normalizeConsonantAlias(
  assignment: { kind: string; params?: Record<string, unknown> } | undefined,
): Consonant | undefined {
  if (!assignment || typeof assignment !== "object") {
    throw new Error("MODEL_GAP: consonant assignment is missing.");
  }

  const record = assignment as unknown as Record<string, unknown>;
  const kind = String(record.kind ?? "").toUpperCase();
  const params = (record.params as Record<string, unknown> | undefined) ?? record;

  const canonicalKind = aliasMap[kind] ?? kind;

  if (typeof params !== "object" || params === null) {
    const directValue = params as unknown;
    const asNumber = typeof directValue === "number" ? directValue : Number(directValue);
    switch (canonicalKind) {
      case "DELAY":
        if (!Number.isFinite(asNumber) || asNumber < 0 || !Number.isInteger(asNumber)) {
          throw new Error(`MODEL_GAP: DELAY durationMs must be a non-negative integer; got ${String(directValue)}.`);
        }
        return { kind: "DELAY", durationMs: asNumber };
      case "SEVER": {
        const phaseValue = String(directValue).toUpperCase();
        if (phaseValue === "REQUEST") return { kind: "SEVER", phase: "PRE_COMMIT" };
        if (phaseValue === "ACK") return { kind: "SEVER", phase: "POST_COMMIT" };
        if (phaseValue === "PRE_COMMIT" || phaseValue === "POST_COMMIT") return { kind: "SEVER", phase: phaseValue };
        if (phaseValue === "NONE") return undefined;
        throw new Error(`MODEL_GAP: OMISSION phase must be REQUEST, ACK, NONE, PRE_COMMIT, or POST_COMMIT; got ${String(directValue)}.`);
      }
      case "DUPLICATE":
        if (!Number.isFinite(asNumber) || asNumber < 1 || !Number.isInteger(asNumber)) {
          throw new Error(`MODEL_GAP: DUPLICATION count must be an integer >= 1; got ${String(directValue)}.`);
        }
        return { kind: "DUPLICATE", count: asNumber };
      case "SATURATE":
        if (!Number.isFinite(asNumber) || asNumber < 0) {
          throw new Error(`MODEL_GAP: SATURATE loadUnits must be a finite number >= 0; got ${String(directValue)}.`);
        }
        return { kind: "SATURATE", loadUnits: asNumber };
      case "WIPE": {
        const rawScope = String(directValue).toUpperCase();
        if (rawScope === "LEASE_EPOCH") return { kind: "WIPE", scope: "LEASE_EPOCH", leaseIds: [] };
        return { kind: "WIPE", scope: "VOLATILE_CELLS", cellIds: [] };
      }
      case "CORRUPT": {
        const rawMode = String(directValue).toUpperCase();
        if (rawMode === "LOSSY_DROP") return { kind: "CORRUPT", mode: "LOSSY_DROP" };
        if (rawMode === "POISON_PILL") return { kind: "CORRUPT", mode: "POISON_PILL" };
        return { kind: "CORRUPT", mode: "SCHEMA_DRIFT" };
      }
      default:
        break;
    }
  }

  const getValue = (key: string): unknown => {
    if (params && typeof params === "object" && key in params) {
      return params[key];
    }
    return record[key];
  };

  switch (canonicalKind) {
    case "DELAY": {
      const durationMs = getValue("durationMs");
      if (typeof durationMs !== "number" || !Number.isInteger(durationMs) || durationMs < 0) {
        throw new Error(`MODEL_GAP: DELAY durationMs must be a non-negative integer; got ${String(durationMs)}.`);
      }
      return { kind: "DELAY", durationMs };
    }
    case "SEVER": {
      const phase = getValue("phase");
      if (phase === "PRE_COMMIT" || phase === "POST_COMMIT") {
        return { kind: "SEVER", phase: phase as "PRE_COMMIT" | "POST_COMMIT" };
      }
      if (phase === "REQUEST") return { kind: "SEVER", phase: "PRE_COMMIT" };
      if (phase === "ACK") return { kind: "SEVER", phase: "POST_COMMIT" };
      if (phase === "NONE") return undefined;
      throw new Error(`MODEL_GAP: OMISSION phase must be REQUEST, ACK, NONE, PRE_COMMIT, or POST_COMMIT; got ${String(phase)}.`);
    }
    case "DUPLICATE": {
      const count = getValue("count");
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
        throw new Error(`MODEL_GAP: DUPLICATION count must be an integer >= 1; got ${String(count)}.`);
      }
      return { kind: "DUPLICATE", count };
    }
    case "SATURATE": {
      const loadUnits = getValue("loadUnits");
      if (typeof loadUnits !== "number" || !Number.isFinite(loadUnits) || loadUnits < 0) {
        throw new Error(`MODEL_GAP: SATURATE loadUnits must be a finite number >= 0; got ${String(loadUnits)}.`);
      }
      return { kind: "SATURATE", loadUnits };
    }
    case "WIPE": {
      const scope = getValue("scope");
      if (scope === "VOLATILE_CELLS") {
        const cellIds = getValue("cellIds");
        const normalizedCellIds = Array.isArray(cellIds)
          ? cellIds.filter((value) => typeof value === "string")
          : undefined;
        return {
          kind: "WIPE",
          scope: "VOLATILE_CELLS",
          ...(normalizedCellIds && normalizedCellIds.length > 0 ? { cellIds: normalizedCellIds } : {}),
        };
      }
      if (scope === "LEASE_EPOCH") {
        const leaseIds = getValue("leaseIds");
        const normalizedLeaseIds = Array.isArray(leaseIds)
          ? leaseIds.filter((value) => typeof value === "string")
          : undefined;
        return {
          kind: "WIPE",
          scope: "LEASE_EPOCH",
          ...(normalizedLeaseIds && normalizedLeaseIds.length > 0 ? { leaseIds: normalizedLeaseIds } : {}),
        };
      }
      throw new Error(`MODEL_GAP: CRASH_AMNESIA scope must be VOLATILE_CELLS or LEASE_EPOCH; got ${String(scope)}.`);
    }
    case "CORRUPT": {
      const mode = getValue("mode");
      if (mode === "LOSSY_DROP" || mode === "SCHEMA_DRIFT" || mode === "POISON_PILL") {
        return { kind: "CORRUPT", mode: mode as "LOSSY_DROP" | "SCHEMA_DRIFT" | "POISON_PILL" };
      }
      throw new Error(`MODEL_GAP: BYZANTINE mode must be LOSSY_DROP, SCHEMA_DRIFT, or POISON_PILL; got ${String(mode)}.`);
    }
    default: {
      throw new Error(`MODEL_GAP: unknown consonant kind '${kind}'.`);
    }
  }
}

export function applyConsonant(
  sim: Sim,
  target: Vowel | { id: string; actorId?: string; kind?: string },
  consonant: Consonant,
  opts?: Record<string, unknown>,
  rng?: Rng,
): ConsonantResult {
  const consonantRecord = consonant as unknown as Record<string, unknown>;
  const canon = normalizeConsonantAlias({
    kind: String(consonantRecord.kind ?? ""),
    params: consonantRecord,
  });
  if (!canon) {
    return {
      ok: true,
      consonant: "SEVER",
      targetId: target.id,
      details: { skipped: true, reason: "OMISSION/NONE is a no-op" },
    };
  }

  switch (canon.kind) {
    case "DELAY": {
      if (!("kind" in target) || (target.kind !== "CHANNEL" && target.kind !== "LOG")) {
        throw new Error(`DELAY requires CHANNEL or LOG target, got: ${target.kind ?? "unknown"}`);
      }
      return applyDelay(
        sim,
        target as Vowel,
        {
          durationMs: canon.durationMs,
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
          phase: canon.phase,
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
          count: canon.count,
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
          loadUnits: canon.loadUnits,
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
          scope: canon.scope,
          cellIds: canon.cellIds,
          leaseIds: canon.leaseIds,
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
          mode: canon.mode,
          selector: canon.selector,
          ...opts,
        },
        rng,
      );
    }

    default: {
      const exhaustiveCheck: never = canon;
      throw new Error(`Unknown consonant: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

