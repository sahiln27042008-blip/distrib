// enterpriseee/enterprise-simulator/src/physics/alphabet/vowels/channel.ts

import type { Sim } from "../../../kernel.ts";
import type { Vowel } from "../types.ts";
import type { Cell } from "./cell.ts";
import type { Lease } from "./lease.ts";

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
  sim?: Sim;
}

export interface ChannelSendOpts {
  delayMs?: number;
  severPhase?: "PRE_COMMIT" | "POST_COMMIT";
  dedupKey?: string;
  epoch?: number;
  heldLease?: Lease;
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

  sim?: Sim;
  currentPhase: ChannelPhase = "CALLER_OBSERVATION";

  constructor(config: ChannelConfig) {
    this.id = config.id;
    this.sourceActorId = config.sourceActorId;
    this.actorId = config.sourceActorId;
    this.targetActorId = config.targetActorId;
    this.timeoutMs = config.timeoutMs;
    this.retryPolicy = config.retryPolicy ?? { maxRetries: 0 };
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
    });

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
        if (targetCell) {
          const mutRes = targetCell.mutate(
            payload,
            {
              dedupKey: opts?.dedupKey,
              epoch: opts?.epoch,
              sim,
            },
            sim,
          );
          outcome.targetCommitted = mutRes.ok;
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
          sim.emit("channel.mutate", this.id, {
            channelId: this.id,
            mutationSuccess: true,
          });
        } else {
          outcome.targetCommitted = true;
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
      currentPhase: this.currentPhase,
    };
  }
}
