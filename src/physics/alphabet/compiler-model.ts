// enterpriseee/enterprise-simulator/src/physics/alphabet/compiler-model.ts

import type { CompiledAlphabetGraph, DecompositionResult, InvoiceEvidence } from "./types.ts";

export interface AlphabetCompilerModel {
  compile(workflowText: string): Promise<CompiledAlphabetGraph> | CompiledAlphabetGraph;
  compileEvidence(evidence: InvoiceEvidence[]): Promise<CompiledAlphabetGraph> | CompiledAlphabetGraph;
  decompose(proposedId: string, description: string): Promise<DecompositionResult> | DecompositionResult;
}

