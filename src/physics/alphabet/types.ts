// enterpriseee/enterprise-simulator/src/physics/alphabet/types.ts

import type { Sim } from "../../kernel.ts";
import type { Cell } from "./vowels/cell.ts";
import type { Log } from "./vowels/log.ts";
import type { Lease } from "./vowels/lease.ts";
import type { Channel } from "./vowels/channel.ts";

export type VowelKind = "CELL" | "LOG" | "LEASE" | "CHANNEL";

export interface Vowel {
  readonly id: string;
  readonly kind: VowelKind;
  readonly actorId: string;
  snapshot(): unknown;
}

export type EpistemicState =
  | "PROVEN"
  | "OBSERVED"
  | "INFERRED"
  | "UNKNOWN"
  | "NOT_REPRESENTABLE";

export type ConsonantKind =
  | "DELAY"
  | "SEVER"
  | "DUPLICATE"
  | "SATURATE"
  | "WIPE"
  | "CORRUPT";

export interface DelayConsonant {
  kind: "DELAY";
  durationMs: number;
}

export interface SeverConsonant {
  kind: "SEVER";
  phase: "PRE_COMMIT" | "POST_COMMIT";
}

export interface DuplicateConsonant {
  kind: "DUPLICATE";
  count: number;
}

export interface SaturateConsonant {
  kind: "SATURATE";
  loadUnits: number;
}

export interface WipeConsonant {
  kind: "WIPE";
  scope: "VOLATILE_CELLS" | "LEASE_EPOCH";
  cellIds?: string[];
  leaseIds?: string[];
}

export interface CorruptConsonant {
  kind: "CORRUPT";
  mode: "LOSSY_DROP" | "SCHEMA_DRIFT" | "POISON_PILL";
  selector?: {
    count?: number;
    itemIndex?: number;
  };
}

export type Consonant =
  | DelayConsonant
  | SeverConsonant
  | DuplicateConsonant
  | SaturateConsonant
  | WipeConsonant
  | CorruptConsonant;

export interface ConsonantResult {
  ok: boolean;
  consonant: ConsonantKind;
  targetId: string;
  details?: Record<string, unknown>;
}

export interface Actor {
  id: string;
  name: string;
  kind?: string;
  contract?: Contract;
}

export interface Contract {
  guarantees: string[];
}

export interface CandidatePerturbation {
  consonant: Consonant;
  targetId: string;
  description?: string;
}

export interface ProvenanceRecord {
  property: string;
  source: string;
  confidence: "EXPLICIT" | "INFERRED" | "UNKNOWN";
  evidence?: string;
}

export interface CompiledAlphabetGraph {
  actors: Actor[];
  vowels: Vowel[];
  channels: Channel[];
  contracts: Contract[];
  candidatePerturbations: CandidatePerturbation[];
  epistemicStatus: EpistemicState[];
  unrepresentableSemantics: string[];
  provenance?: ProvenanceRecord[];
}

export interface InvoiceEvidence {
  source: string;
  sku: string;
  evidence: string;
  actorId?: string;
  inferredCapacity?: {
    kind: "LEASE" | "LOG" | "CELL";
    maxCapacity?: number;
    confidence: "EXPLICIT" | "INFERRED" | "UNKNOWN";
    evidence?: string;
  };
}

export type Letter =
  | "V1"
  | "V2"
  | "V3"
  | "V4"
  | "C1"
  | "C2"
  | "C3"
  | "C4"
  | "C5"
  | "C6";

export type DecompositionResult =
  | {
      status: "REPRESENTABLE";
      letters: Letter[];
      coverage: number;
      missingSemantics: [];
    }
  | {
      status: "INSUFFICIENT_PHYSICS";
      missingSemantics: string[];
    };

