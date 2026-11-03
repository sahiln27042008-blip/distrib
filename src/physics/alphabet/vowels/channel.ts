// enterpriseee/enterprise-simulator/src/physics/alphabet/vowels/channel.ts

import { createHash } from "node:crypto";
import type { Sim } from "../../../kernel.ts";
import type { Vowel } from "../types.ts";
import type { Cell } from "./cell.ts";
import type { Lease } from "./lease.ts";

function canonJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonJson(o[k])}`).join(",")}}`;
}

export type ChannelPhase =
  | "REQUEST_SENT"
  | "REQUEST_RECEIVED"
  | "TARGET_MUTATION"
  | "RESPONSE_ACK"
  | "CALLER_OBSERVATION";

export interface ChannelRetryPolicy {
  maxRetries: number;
  backoffMs?: number;
}

export interface ChannelConfig {
  id: string;
  sourceActorId: string;
  targetActorId: string;
  timeoutMs: number;
  retryPolicy?: ChannelRetryPolicy;
  idempotencyEnabled?: boolean;
  budgetUsd?: number;
  sim?: Sim;
}

export interface ChannelSendOpts {
  delayMs?: number;
  severPhase?: "PRE_COMMIT" | "POST_COMMIT";
  dedupKey?: string;
  epoch?: number;
  heldLease?: Lease;
  workflowId?: string;
  mutateFn?: () => unknown;
  autoAdvance?: boolean;
}

export interface ChannelSendResult {
  callerObservation: "ok" | "timeout" | "error";
  targetCommitted: boolean;
  ackReceived: boolean;
  divergenceDetected?: boolean;
}

export class Channel implements Vowel {
  readonly id: string;
  readonly kind = "CHANNEL" as const;
  readonly actorId: string;
  readonly sourceActorId: string;
  readonly targetActorId: string;
  readonly timeoutMs: number;
  readonly retryPolicy: ChannelRetryPolicy;
  readonly budgetUsd?: number;
  idempotencyEnabled: boolean;

  receiptLedger = new Map<string, { targetCommitted: boolean; receipt?: unknown; committedAt: number }>();
  sim?: Sim;
  currentPhase: ChannelPhase = "CALLER_OBSERVATION";
  private totalCost = 0;
  private sendCount = 0;
  private costBurnEmitted = false;

  constructor(config: ChannelConfig) {
    this.id = config.id;
    this.sourceActorId = config.sourceActorId;
    this.actorId = config.sourceActorId;
    this.targetActorId = config.targetActorId;
    this.timeoutMs = config.timeoutMs;
    this.retryPolicy = config.retryPolicy ?? { maxRetries: 0 };
    this.idempotencyEnabled = config.idempotencyEnabled ?? false;
    if (config.budgetUsd !== undefined && (!Number.isFinite(config.budgetUsd) || config.budgetUsd < 0)) {
      throw new RangeError("budgetUsd must be a finite number >= 0");
    }
    this.budgetUsd = config.budgetUsd;
    this.sim = config.sim;
  }

  send(
    sim: Sim,
    payload: unknown,
    targetCell?: Cell,
    opts?: ChannelSendOpts,
  ): ChannelSendResult {
    const delayMs = opts?.delayMs ?? 0;
    const severPhase = opts?.severPhase;
    const startTime = sim.now;

    // Attach deterministic composite header when channel idempotency is enabled:
    // Idempotency-Key: sha256(workflow_id + node_id + payload_hash)
    let dedupKey = opts?.dedupKey;
    if (this.idempotencyEnabled && !dedupKey) {
      const payloadHash = createHash("sha256").update(canonJson(payload)).digest("hex");
      const workflowId = opts?.workflowId ?? "wf";
      const nodeId = this.sourceActorId;
      dedupKey = `sha256(${workflowId}+${nodeId}+${payloadHash})`;
    }

    const outcome: {
      callerObservation: "ok" | "timeout" | "error" | "pending";
      targetCommitted: boolean;
      ackReceived: boolean;
      divergenceDetected: boolean;
    } = {
      callerObservation: "pending",
      targetCommitted: false,
      ackReceived: false,
      divergenceDetected: false,
    };

    // Phase 1: REQUEST_SENT
    this.currentPhase = "REQUEST_SENT";
    sim.emit("channel.send", this.id, {
      channelId: this.id,
      sourceActorId: this.sourceActorId,
      targetActorId: this.targetActorId,
      payload,
      sentAt: startTime,
      timeoutMs: this.timeoutMs,
      idempotencyKey: dedupKey,
    });

    this.sendCount++;
    const amount = payload && typeof payload === "object" && "amount" in payload && typeof payload.amount === "number" && Number.isFinite(payload.amount)
      ? payload.amount
      : 0;
    this.totalCost += Math.max(0, amount);
    const threshold = this.budgetUsd === undefined ? undefined : this.budgetUsd * 100;
    if (threshold !== undefined && this.totalCost > threshold && !this.costBurnEmitted) {
      this.costBurnEmitted = true;
      sim.emit("cost.burn_exceeded", "cost-tracker", {
        totalCost: this.totalCost,
        threshold,
        channelId: this.id,
        sendCount: this.sendCount,
        budgetUsd: this.budgetUsd,
      });
    }

    // Schedule caller timeout handler
    sim.at(this.timeoutMs, "channel.timeout_handler", () => {
      if (!outcome.ackReceived) {
        outcome.callerObservation = "timeout";
        sim.emit("channel.timeout", this.id, {
          channelId: this.id,
          timeoutMs: this.timeoutMs,
          targetCommitted: outcome.targetCommitted,
        });

        if (outcome.targetCommitted) {
          outcome.divergenceDetected = true;
          sim.emit("channel.divergence_detected", this.id, {
            channelId: this.id,
            worldStateCommitted: true,
            callerObservation: "timeout",
            divergence: true,
          });
        }

        this.currentPhase = "CALLER_OBSERVATION";
        sim.emit("channel.caller_observation", this.id, {
          channelId: this.id,
          callerObservation: "timeout",
        });
      }
    });

    // Handle C2 SEVER: PRE_COMMIT -> request never delivered
    if (severPhase === "PRE_COMMIT") {
      // Do nothing: target never receives, timeout handler fires later
    } else {
      // Schedule delivery at startTime + delayMs
      sim.at(delayMs, "channel.receive_and_mutate", () => {
        // Phase 2: REQUEST_RECEIVED
        this.currentPhase = "REQUEST_RECEIVED";
        sim.emit("channel.receive", this.id, {
          channelId: this.id,
          targetActorId: this.targetActorId,
          receivedAt: sim.now,
          delayedByMs: delayMs,
        });

        // Phase 3: TARGET_MUTATION
        this.currentPhase = "TARGET_MUTATION";
        if (this.idempotencyEnabled && dedupKey && this.receiptLedger.has(dedupKey)) {
          // Channel-level transport deduplication:
          // Remote endpoint evaluates key in its receipt ledger; suppresses duplicate side effect
          const cached = this.receiptLedger.get(dedupKey)!;
          outcome.targetCommitted = cached.targetCommitted;
          sim.emit("channel.dedup_suppressed", this.id, {
            channelId: this.id,
            idempotencyKey: dedupKey,
            targetActorId: this.targetActorId,
            cachedCommittedAt: cached.committedAt,
          });
          sim.emit("channel.mutate", this.id, {
            channelId: this.id,
            targetCellId: targetCell?.id,
            mutationSuccess: cached.targetCommitted,
            duplicate: true,
            staleEpoch: false,
          });
        } else if (targetCell) {
          const mutRes = targetCell.mutate(
            payload,
            {
              dedupKey,
              epoch: opts?.epoch,
              sim,
            },
            sim,
          );
          outcome.targetCommitted = mutRes.ok;
          if (this.idempotencyEnabled && dedupKey) {
            this.receiptLedger.set(dedupKey, {
              targetCommitted: mutRes.ok,
              receipt: mutRes,
              committedAt: sim.now,
            });
          }
          sim.emit("channel.mutate", this.id, {
            channelId: this.id,
            targetCellId: targetCell.id,
            mutationSuccess: mutRes.ok,
            duplicate: mutRes.duplicate,
            staleEpoch: mutRes.staleEpoch,
          });
        } else if (opts?.mutateFn) {
          opts.mutateFn();
          outcome.targetCommitted = true;
          if (this.idempotencyEnabled && dedupKey) {
            this.receiptLedger.set(dedupKey, {
              targetCommitted: true,
              committedAt: sim.now,
            });
          }
          sim.emit("channel.mutate", this.id, {
            channelId: this.id,
            mutationSuccess: true,
          });
        } else {
          outcome.targetCommitted = true;
          if (this.idempotencyEnabled && dedupKey) {
            this.receiptLedger.set(dedupKey, {
              targetCommitted: true,
              committedAt: sim.now,
            });
          }
          sim.emit("channel.mutate", this.id, {
            channelId: this.id,
            mutationSuccess: true,
          });
        }

        // Handle C2 SEVER: POST_COMMIT -> target committed, ack severed
        if (severPhase === "POST_COMMIT") {
          outcome.divergenceDetected = true;
          sim.emit("channel.divergence_detected", this.id, {
            channelId: this.id,
            worldStateCommitted: outcome.targetCommitted,
            callerObservation: "timeout",
            divergence: true,
            severPhase: "POST_COMMIT",
          });
          // Do not send ACK
        } else {
          // Phase 4: RESPONSE_ACK
          this.currentPhase = "RESPONSE_ACK";
          outcome.ackReceived = true;
          sim.emit("channel.ack", this.id, {
            channelId: this.id,
            acknowledgedAt: sim.now,
          });

          // Phase 5: CALLER_OBSERVATION (if not already timed out)
          if (sim.now <= startTime + this.timeoutMs) {
            outcome.callerObservation = "ok";
            this.currentPhase = "CALLER_OBSERVATION";
            sim.emit("channel.caller_observation", this.id, {
              channelId: this.id,
              callerObservation: "ok",
            });
          }
        }
      });
    }

    if (opts?.autoAdvance !== false) {
      // Advance to past whichever event is later
      const advanceDuration = Math.max(this.timeoutMs, delayMs) + 1;
      sim.advanceTo(startTime + advanceDuration);
    }

    const finalCallerObservation =
      outcome.callerObservation === "pending"
        ? outcome.ackReceived
          ? "ok"
          : "timeout"
        : outcome.callerObservation;

    return {
      callerObservation: finalCallerObservation,
      targetCommitted: outcome.targetCommitted,
      ackReceived: outcome.ackReceived,
      divergenceDetected: outcome.divergenceDetected,
    };
  }

  snapshot(): Record<string, unknown> {
    return {
      id: this.id,
      kind: this.kind,
      actorId: this.actorId,
      sourceActorId: this.sourceActorId,
      targetActorId: this.targetActorId,
      timeoutMs: this.timeoutMs,
      retryPolicy: { ...this.retryPolicy },
      idempotencyEnabled: this.idempotencyEnabled,
      budgetUsd: this.budgetUsd,
      totalCost: this.totalCost,
      sendCount: this.sendCount,
      currentPhase: this.currentPhase,
    };
  }
}
