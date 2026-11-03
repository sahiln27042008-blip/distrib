import type { SimEvent } from "../../../kernel.ts";
import type { Finding } from "./finding.ts";
import type { Vowel } from "../types.ts";

export interface NativeRule {
  rule_id: string;
  evaluate(events: SimEvent[], vowels?: Map<string, Vowel>): Finding[];
}