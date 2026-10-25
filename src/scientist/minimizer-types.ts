// src/scientist/minimizer-types.ts

export interface MinimalCounterexample {
  failureId: string;
  events: CounterexampleEvent[];
  originalEventCount: number;
  minimizedEventCount: number;
  invariant: string;        // which rule fires
  stillViolates: boolean;   // confirm the minimal sequence still triggers the finding
}

export interface CounterexampleEvent {
  index: number;          // position in original trace
  spanId: string;
  name: string;           // e.g. "payment.attempt", "db.write", "worker.exit"
  timestamp: number;      // virtual ms
  attrs: Record<string, unknown>;
  description: string;    // human-readable summary
}

export interface MinimizerConfig {
  maxReductionRounds: number;  // default 10
  targetEventCount: number;    // default 5 — try to shrink to this
}

