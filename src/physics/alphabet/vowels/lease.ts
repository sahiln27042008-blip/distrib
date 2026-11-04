// enterpriseee/enterprise-simulator/src/physics/alphabet/vowels/lease.ts

import type { Sim } from "../../../kernel.ts";
import type { Vowel } from "../types.ts";

export type LeaseOverflowPolicy = "WAIT_TIMEOUT" | "REJECT_429" | "PANIC_CRASH";

export interface LeaseHolder {
  actorId: string;
  acquiredAt: number;
  expiresAt: number;
  epoch: number;
}

export interface LeaseConfig {
  id: string;
  actorId: string;
  maxCapacity: number;
  ttlMs: number;
  overflowPolicy: LeaseOverflowPolicy;
  heldDuringExternalChannel?: boolean;
  sim?: Sim;
}

export interface LeaseAcquireResult {
  ok: boolean;
  rejected?: boolean;
  panicked?: boolean;
  acquiredEpoch?: number;
  waitMs?: number;
}

export class Lease implements Vowel {
  readonly id: string;
  readonly kind = "LEASE" as const;
  readonly actorId: string;
  readonly maxCapacity: number;
  readonly ttlMs: number;
  readonly overflowPolicy: LeaseOverflowPolicy;
  readonly heldDuringExternalChannel: boolean;

  currentLoad = 0;
  currentEpoch = 0;
  holders: LeaseHolder[] = [];
  sim?: Sim;

  constructor(config: LeaseConfig) {
    this.id = config.id;
    this.actorId = config.actorId;
    this.maxCapacity = config.maxCapacity;
    this.ttlMs = config.ttlMs;
    this.overflowPolicy = config.overflowPolicy;
    this.heldDuringExternalChannel = config.heldDuringExternalChannel ?? false;
    this.sim = config.sim;
  }

  expire(now: number, callSim?: Sim): { expiredCount: number } {
    const activeSim = callSim ?? this.sim;
    let expiredCount = 0;
    const remainingHolders: LeaseHolder[] = [];

    for (const holder of this.holders) {
      if (holder.expiresAt <= now) {
        expiredCount++;
        this.currentEpoch++; // Fencing token semantics
        if (activeSim) {
          activeSim.emit("lease.epoch_expired", this.id, {
            leaseId: this.id,
            actorId: this.actorId,
            holderActorId: holder.actorId,
            expiredAt: now,
            newEpoch: this.currentEpoch,
          });
        }
      } else {
        remainingHolders.push(holder);
      }
    }

    this.holders = remainingHolders;
    this.currentLoad = this.holders.length;
    return { expiredCount };
  }

  acquire(actorId: string, now: number, callSim?: Sim): LeaseAcquireResult {
    const activeSim = callSim ?? this.sim;
    this.expire(now, activeSim);

    if ((this as any).shedAtThresholdEnabled && (this.currentLoad + 1 > Math.floor(this.maxCapacity * ((this as any).shedThreshold ?? 0.56)) || this.currentLoad + 1 > this.maxCapacity)) {
      if (activeSim) {
        activeSim.emit("lease.load_shed", this.id, {
          leaseId: this.id,
          actorId: this.actorId,
          currentLoad: this.currentLoad,
          maxCapacity: this.maxCapacity,
          policy: "SHED_BEFORE_SATURATION",
        });
      }
      return { ok: true, acquiredEpoch: this.currentEpoch };
    }

    if (this.currentLoad + 1 > this.maxCapacity) {
      if (this.overflowPolicy === "REJECT_429") {
        if (activeSim) {
          activeSim.emit("lease.rejected", this.id, {
            leaseId: this.id,
            actorId: this.actorId,
            requesterId: actorId,
            currentLoad: this.currentLoad,
            maxCapacity: this.maxCapacity,
            policy: this.overflowPolicy,
          });
        }
        return { ok: false, rejected: true };
      }

      if (this.overflowPolicy === "PANIC_CRASH") {
        if (activeSim) {
          activeSim.emit("lease.panic_crash", this.id, {
            leaseId: this.id,
            actorId: this.actorId,
            requesterId: actorId,
            currentLoad: this.currentLoad,
            maxCapacity: this.maxCapacity,
            policy: this.overflowPolicy,
          });
        }
        return { ok: false, panicked: true };
      }

      // WAIT_TIMEOUT
      let earliestExpires = this.ttlMs;
      if (this.holders.length > 0) {
        const sorted = [...this.holders].sort((a, b) => a.expiresAt - b.expiresAt);
        const first = sorted[0];
        if (first) {
          earliestExpires = Math.max(1, first.expiresAt - now);
        }
      }
      return { ok: false, rejected: false, waitMs: earliestExpires };
    }

    const holder: LeaseHolder = {
      actorId,
      acquiredAt: now,
      expiresAt: now + this.ttlMs,
      epoch: this.currentEpoch,
    };
    this.holders.push(holder);
    this.currentLoad = this.holders.length;

    if (activeSim) {
      activeSim.emit("lease.acquire", this.id, {
        leaseId: this.id,
        actorId: this.actorId,
        holderActorId: actorId,
        acquiredEpoch: this.currentEpoch,
        currentLoad: this.currentLoad,
        expiresAt: holder.expiresAt,
      });
    }

    return { ok: true, acquiredEpoch: this.currentEpoch };
  }

  release(actorId: string, now?: number, callSim?: Sim): boolean {
    const activeSim = callSim ?? this.sim;
    const index = this.holders.findIndex((h) => h.actorId === actorId);
    if (index === -1) {
      return false;
    }

    const [removed] = this.holders.splice(index, 1);
    this.currentLoad = this.holders.length;

    if (activeSim && removed) {
      activeSim.emit("lease.release", this.id, {
        leaseId: this.id,
        actorId: this.actorId,
        holderActorId: actorId,
        currentLoad: this.currentLoad,
        heldDurationMs: (now ?? activeSim.now) - removed.acquiredAt,
      });
    }

    return true;
  }

  snapshot(): Record<string, unknown> {
    return {
      id: this.id,
      kind: this.kind,
      actorId: this.actorId,
      maxCapacity: this.maxCapacity,
      ttlMs: this.ttlMs,
      overflowPolicy: this.overflowPolicy,
      heldDuringExternalChannel: this.heldDuringExternalChannel,
      currentLoad: this.currentLoad,
      currentEpoch: this.currentEpoch,
      holders: this.holders.map((h) => ({ ...h })),
    };
  }
}

