import { createHash } from "node:crypto";
import { Rng, type Data, type Sim } from "../kernel.ts";

export type IdempotencyPolicy = "clean" | "socket_drop" | "rate_limit" | "poison_pill" | "legacy_no_idem";

export interface PaymentDialConfig {
  idempotencyPolicy?: IdempotencyPolicy;
  /** poison_pill: item index that always fails. Mirrors MockToolGateway.poisonItem. */
  poisonIndex?: number;
  /** poison_pill: batch size. Mirrors MockToolGateway.totalItems. */
  totalItems?: number;
  /** rate_limit: seed for the private Rng (deterministic per seed). */
  seed?: number;
}

export interface AcceptOptions {
  /** Canonical request body; defaults to { amountDollars }. */
  payload?: Record<string, unknown>;
  /** poison_pill: position of this charge in its batch. */
  itemIndex?: number;
  tenantIndex?: number;
  sagaId?: string;
}

export interface AcceptResult {
  receiptId: string;
  replayed: boolean;
  /** Present only when the gateway failed the attempt: "ECONNRESET" | "429" | "poison_pill". */
  error?: string;
}

export interface PaymentGatewayStats {
  duplicateDollarsCharged: number;
  paymentAcceptedCharges: number;
  attemptCount: number;
  rateLimited: number;
  connectionResets: number;
  batchItemsSucceeded: number;
  batchItemsFailed: number;
  receipts: number;
}

interface AttemptRecord {
  index: number;
  key: string | null;
  bodyHash: string;
  amountDollars: number;
  retryCount: number;
  attemptOf?: number;
  outcome: "accepted" | "replayed" | "conn_reset" | "rate_limited" | "poisoned";
  tenantIndex?: number;
  sagaId?: string;
}

const RATE_LIMIT_P = 0.5;

// Same canonicalisation as chaos.ts (sorted-keys JSON). Copied: must not import chaos.ts.
function canonical(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

export function paymentBodyHash(payload: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(canonical(payload)).digest("hex")}`;
}

export class MockPaymentGateway {
  readonly receipts = new Map<string, { receiptId: string; amountDollars: number }>();
  readonly policy: IdempotencyPolicy | undefined;
  readonly poisonIndex: number;
  readonly totalItems: number;
  private readonly seed: number;
  private rng: Rng;
  private attempts: AttemptRecord[] = [];
  private emitted = new Map<number, string>(); // attempt index -> sim event id
  private chargesByBody = new Map<string, number>();
  private dropped = new Set<string>();
  private stats = MockPaymentGateway.emptyStats();

  constructor(dialConfig?: PaymentDialConfig) {
    this.policy = dialConfig?.idempotencyPolicy;
    this.poisonIndex = dialConfig?.poisonIndex ?? 27;
    this.totalItems = dialConfig?.totalItems ?? 50;
    this.seed = dialConfig?.seed ?? 0;
    this.rng = new Rng(this.seed);
  }

  private static emptyStats(): Omit<PaymentGatewayStats, "receipts"> {
    return {
      duplicateDollarsCharged: 0,
      paymentAcceptedCharges: 0,
      attemptCount: 0,
      rateLimited: 0,
      connectionResets: 0,
      batchItemsSucceeded: 0,
      batchItemsFailed: 0,
    };
  }

  accept(key: string | null, amountDollars: number, candidateReceiptId: string, opts: AcceptOptions = {}): AcceptResult {
    const policy = this.policy;
    const bodyHash = paymentBodyHash(opts.payload ?? { amountDollars });
    const sameBody = this.attempts.filter((a) => a.bodyHash === bodyHash);
    const last = sameBody[sameBody.length - 1];
    const rec: AttemptRecord = {
      index: this.attempts.length,
      key,
      bodyHash,
      amountDollars,
      retryCount: sameBody.length,
      outcome: "accepted",
      tenantIndex: opts.tenantIndex,
      sagaId: opts.sagaId,
    };
    if (last) rec.attemptOf = last.index;
    this.attempts.push(rec);
    this.stats.attemptCount += 1;

    if (policy === "poison_pill") {
      if (opts.itemIndex === this.poisonIndex) {
        rec.outcome = "poisoned";
        this.stats.batchItemsFailed += 1;
        return { receiptId: "", replayed: false, error: "poison_pill" };
      }
      this.stats.batchItemsSucceeded += 1;
    }

    if (policy === "rate_limit" && this.rng.next() < RATE_LIMIT_P) {
      rec.outcome = "rate_limited";
      this.stats.rateLimited += 1;
      return { receiptId: "", replayed: false, error: "429" };
    }

    // legacy_no_idem ignores any key; a null key never dedups under any policy.
    const dedupKey = policy === "legacy_no_idem" ? null : key;
    if (dedupKey !== null) {
      const prior = this.receipts.get(dedupKey);
      if (prior) {
        rec.outcome = "replayed";
        return { receiptId: prior.receiptId, replayed: true };
      }
    }

    this.receipts.set(dedupKey ?? `no-key:${rec.index}`, { receiptId: candidateReceiptId, amountDollars });
    this.stats.paymentAcceptedCharges += 1;
    const prevCharges = this.chargesByBody.get(bodyHash) ?? 0;
    if (prevCharges > 0) this.stats.duplicateDollarsCharged += amountDollars;
    this.chargesByBody.set(bodyHash, prevCharges + 1);

    if ((policy === "socket_drop" || policy === "legacy_no_idem") && !this.dropped.has(bodyHash)) {
      // Gateway accepted the charge, but the connection dies before the client sees the response.
      this.dropped.add(bodyHash);
      rec.outcome = "conn_reset";
      this.stats.connectionResets += 1;
      return { receiptId: candidateReceiptId, replayed: false, error: "ECONNRESET" };
    }
    return { receiptId: candidateReceiptId, replayed: false };
  }

  getStats(): PaymentGatewayStats {
    return { ...this.stats, receipts: this.receipts.size };
  }

  /** Emit one "payment.attempt.sent" event per not-yet-emitted attempt (exportTrace turns these into payment.attempt spans). */
  emitTraceSpans(sim: Sim, parentEventId?: string): void {
    for (const a of this.attempts) {
      if (this.emitted.has(a.index)) continue;
      const data: Data = {
        side_effect: "POST",
        body_hash: a.bodyHash,
        idempotency_key: a.key,
        retry_count: a.retryCount,
        amountDollars: a.amountDollars,
        outcome: a.outcome,
        ...(a.tenantIndex !== undefined ? { tenant_index: a.tenantIndex } : {}),
        ...(a.sagaId !== undefined ? { saga_id: a.sagaId } : {}),
      };
      if (a.attemptOf !== undefined) {
        const prior = this.emitted.get(a.attemptOf);
        if (prior !== undefined) {
          data.attempt_of = prior;
          data.retryOf = prior;
        }
      }
      this.emitted.set(a.index, sim.emit("payment.attempt.sent", "payment-gateway", data, parentEventId));
    }
  }

  reset(): void {
    this.receipts.clear();
    this.attempts = [];
    this.emitted.clear();
    this.chargesByBody.clear();
    this.dropped.clear();
    this.stats = MockPaymentGateway.emptyStats();
    this.rng = new Rng(this.seed);
  }
}
