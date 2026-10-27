// enterpriseee/enterprise-simulator/src/physics/alphabet/vowels/log.ts

import type { Sim } from "../../../kernel.ts";
import type { Vowel } from "../types.ts";

export interface LogEntry {
  value: unknown;
  writtenAt: number;
  visible: boolean;
  compacted: boolean;
  dedupKey?: string;
  deduplicated?: boolean;
}

export interface LogConfig {
  id: string;
  actorId: string;
  maxCapacity: number;
  compactionLagMs: number;
  deduplicateOnCompact: boolean;
  seed?: number;
  sim?: Sim;
}

export interface LogAppendResult {
  ok: boolean;
  overflow: boolean;
  index: number;
}

export interface LogCompactResult {
  compactedCount: number;
  deduplicatedCount: number;
  compactedViewLength: number;
}

export class Log implements Vowel {
  readonly id: string;
  readonly kind = "LOG" as const;
  readonly actorId: string;
  readonly maxCapacity: number;
  compactionLagMs: number;
  readonly deduplicateOnCompact: boolean;
  readonly seed?: number;

  entries: LogEntry[] = [];
  compactedView: unknown[] = [];
  sim?: Sim;

  constructor(config: LogConfig) {
    this.id = config.id;
    this.actorId = config.actorId;
    this.maxCapacity = config.maxCapacity;
    this.compactionLagMs = config.compactionLagMs;
    this.deduplicateOnCompact = config.deduplicateOnCompact;
    this.seed = config.seed;
    this.sim = config.sim;
  }

  append(value: unknown, dedupKey?: string, callSim?: Sim): LogAppendResult {
    const activeSim = callSim ?? this.sim;
    const now = activeSim?.now ?? 0;

    if (this.entries.length + 1 > this.maxCapacity) {
      if (activeSim) {
        activeSim.emit("log.overflow", this.id, {
          logId: this.id,
          actorId: this.actorId,
          currentLength: this.entries.length,
          maxCapacity: this.maxCapacity,
        });
      }
      return { ok: false, overflow: true, index: -1 };
    }

    const visible = this.compactionLagMs <= 0;
    const entry: LogEntry = {
      value,
      writtenAt: now,
      visible,
      compacted: false,
      dedupKey,
      deduplicated: false,
    };

    this.entries.push(entry);
    const index = this.entries.length - 1;

    if (activeSim) {
      activeSim.emit("log.append", this.id, {
        logId: this.id,
        actorId: this.actorId,
        index,
        writtenAt: now,
        visible,
        dedupKey,
      });
    }

    return { ok: true, overflow: false, index };
  }

  read(now?: number, callSim?: Sim): unknown[] {
    const activeSim = callSim ?? this.sim;
    const currentVirtualTime = now ?? activeSim?.now ?? 0;

    // Update visibility for all entries
    for (const entry of this.entries) {
      if (!entry.visible) {
        if (currentVirtualTime - entry.writtenAt >= this.compactionLagMs) {
          entry.visible = true;
        }
      }
    }

    const visibleUncompacted = this.entries
      .filter((e) => e.visible && !e.compacted)
      .map((e) => e.value);

    const result = [...this.compactedView, ...visibleUncompacted];

    if (activeSim) {
      activeSim.emit("log.read", this.id, {
        logId: this.id,
        actorId: this.actorId,
        readCount: result.length,
        compactedCount: this.compactedView.length,
        uncompactedCount: visibleUncompacted.length,
      });
    }

    return result;
  }

  compact(now: number, callSim?: Sim): LogCompactResult {
    const activeSim = callSim ?? this.sim;
    const cutoffTime = now - this.compactionLagMs;
    let compactedCount = 0;
    let deduplicatedCount = 0;

    const seenDedupKeys = new Set<string>();
    // Pre-populate seenDedupKeys if already compacted
    for (const entry of this.entries) {
      if (entry.compacted && entry.dedupKey) {
        seenDedupKeys.add(entry.dedupKey);
      }
    }

    for (const entry of this.entries) {
      if (!entry.compacted && entry.writtenAt <= cutoffTime) {
        entry.compacted = true;
        entry.visible = true;

        if (this.deduplicateOnCompact && entry.dedupKey) {
          if (seenDedupKeys.has(entry.dedupKey)) {
            entry.deduplicated = true;
            deduplicatedCount++;
            if (activeSim) {
              activeSim.emit("log.dedup", this.id, {
                logId: this.id,
                actorId: this.actorId,
                dedupKey: entry.dedupKey,
              });
            }
            continue;
          }
          seenDedupKeys.add(entry.dedupKey);
        }

        this.compactedView.push(entry.value);
        compactedCount++;
      }
    }

    if (activeSim) {
      activeSim.emit("log.compact", this.id, {
        logId: this.id,
        actorId: this.actorId,
        compactedCount,
        deduplicatedCount,
        compactedViewLength: this.compactedView.length,
      });
    }

    return {
      compactedCount,
      deduplicatedCount,
      compactedViewLength: this.compactedView.length,
    };
  }

  snapshot(): Record<string, unknown> {
    return {
      id: this.id,
      kind: this.kind,
      actorId: this.actorId,
      maxCapacity: this.maxCapacity,
      compactionLagMs: this.compactionLagMs,
      deduplicateOnCompact: this.deduplicateOnCompact,
      entriesCount: this.entries.length,
      compactedViewCount: this.compactedView.length,
      entries: this.entries.map((e) => ({ ...e })),
      compactedView: [...this.compactedView],
    };
  }
}

