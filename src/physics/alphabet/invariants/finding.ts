export type FindingStatus = "proven" | "unknown" | "not_evaluated";
export type Severity = "critical" | "warning" | "info";

export interface Finding {
  rule_id: string;
  pillar: string;
  status: FindingStatus;
  severity: Severity;
  message: string;
  evidence: {
    span_ids: string[];
    resource?: string;
    hashes?: string[];
    gap_ms?: number;
    details?: Record<string, unknown>;
  };
  repro: string;
  suggested_fix: string;
}