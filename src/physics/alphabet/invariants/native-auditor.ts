import type { SimEvent } from "../../../kernel.ts";
import type { Vowel } from "../types.ts";
import type { Finding } from "./finding.ts";
import { ALL_NATIVE_RULES } from "./rules/index.ts";

export function auditNative(events: SimEvent[], vowels: Map<string, Vowel> = new Map()): Finding[] {
  const findings: Finding[] = [];
  for (const rule of ALL_NATIVE_RULES) {
    findings.push(...rule.evaluate(events, vowels));
  }
  return findings;
}

export type { Finding } from "./finding.ts";