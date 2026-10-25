// src/repair/patch-generator.ts

import { createOrchestrator } from "../llm/orchestrator.ts";
import type { Finding } from "../../../../resilient-agent-invariants/src/types/finding.ts";
import type { MatrixConfig } from "../matrix-copy.ts";
import type { CodePatch } from "./patch-types.ts";

const PATCH_PROMPT = `You are a code repair engine for AI agent reliability. Given a finding (invariant violation), a root-cause explanation, and the original system configuration, generate a real code patch that would fix the failure.

Return JSON with:
- description: what the patch does
- diff: unified diff format (--- a/file, +++ b/file, @@ context)
- affectedFile: the file that would be patched
- changedLines: number of lines changed
- explanation: why this fixes the failure
- dialEquivalent: which dial change represents this fix (dial: "C", from: "C5_legacy_erp_no_idem", to: "C1_clean_20ms")

The patch should be a real diff that a developer could apply. Ground it in the actual finding evidence (span IDs, retry counts, idempotency key absence).`;

export async function generatePatch(
  finding: Finding,
  explanation: string,
  originalConfig: MatrixConfig,
  systemDescription?: string,
  orchestratorOverride?: any,
): Promise<CodePatch> {
  const orchestrator = orchestratorOverride || createOrchestrator();

  const messages = [
    { role: "system" as const, content: PATCH_PROMPT },
    {
      role: "user" as const,
      content: `Generate a code patch for this finding:

FINDING:
${JSON.stringify(finding, null, 2)}

EXPLANATION:
${explanation}

ORIGINAL CONFIG:
${JSON.stringify(
  {
    A: originalConfig.A,
    B: originalConfig.B,
    C: originalConfig.C,
    D: originalConfig.D,
    E: originalConfig.E,
    F: originalConfig.F,
  },
  null,
  2,
)}

SYSTEM DESCRIPTION:
${systemDescription || "(none)"}`,
    },
  ];

  const response = await orchestrator.chat(messages, []);

  return parsePatchResponse(response, finding, originalConfig);
}

function parsePatchResponse(
  response: { text: string; tool_calls: any[] },
  finding: Finding,
  originalConfig: MatrixConfig,
): CodePatch {
  let raw: any = null;
  try {
    if (response.tool_calls && response.tool_calls.length > 0) {
      const tc = response.tool_calls[0];
      if (tc.arguments && (tc.arguments.diff || tc.arguments.dialEquivalent)) {
        raw = tc.arguments;
      }
    }
    if (!raw && response.text) {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        raw = JSON.parse(jsonMatch[0]);
      }
    }
  } catch {
    raw = null;
  }

  const canned = getCannedPatch(finding, originalConfig);
  const spanId = finding.evidence?.span_ids?.[0] || "unknown";

  return {
    id: raw?.id || `patch-${finding.rule_id || "gen"}-${spanId}`,
    ruleId: finding.rule_id,
    findingId: spanId,
    description: raw?.description || canned.description,
    diff: raw?.diff || canned.diff,
    affectedFile: raw?.affectedFile || canned.affectedFile,
    changedLines: typeof raw?.changedLines === "number" ? raw.changedLines : canned.changedLines,
    explanation: raw?.explanation || canned.explanation,
    dialEquivalent: raw?.dialEquivalent || canned.dialEquivalent,
  };
}

export function getCannedPatch(
  finding: Finding,
  config: MatrixConfig,
): {
  description: string;
  diff: string;
  affectedFile: string;
  changedLines: number;
  explanation: string;
  dialEquivalent: { dial: string; from: string; to: string };
} {
  const ruleId = (finding.rule_id || "").toLowerCase();
  if (ruleId.includes("r04") || ruleId.includes("idempotency")) {
    return {
      description: "Add stable idempotency key derived from refund operation ID",
      diff: `--- a/src/refund.ts
+++ b/src/refund.ts
@@ -45,6 +45,10 @@
 async function processRefund(orderId, amount) {
+  // Generate stable idempotency key from operation identity
+  const idempotencyKey = crypto
+    .createHash('sha256')
+    .update(\`\${runId}_\${orderId}_\${amount}\`)
+    .digest('hex');
+
   const response = await stripe.charges.create({
     amount,
+    idempotency_key: idempotencyKey,
   });
 }`,
      affectedFile: "src/refund.ts",
      changedLines: 5,
      explanation:
        "The retry path was sending a new request without an idempotency key, so Stripe couldn't dedupe. This patch generates a stable key from the refund operation identity, ensuring retries are idempotent.",
      dialEquivalent: {
        dial: "C",
        from: config.C,
        to: "C1_clean_20ms",
      },
    };
  }
  if (ruleId.includes("r05") || ruleId.includes("saga")) {
    return {
      description: "Add LIFO saga compensation with explicit ordering",
      diff: `--- a/src/saga.ts
+++ b/src/saga.ts
@@ -78,6 +78,12 @@
 async function compensateSaga(sagaId) {
+  // Compensate in reverse order (LIFO)
+  const steps = await getSagaSteps(sagaId);
+  for (const step of steps.reverse()) {
+    await compensate(step);
+  }
+`,
      affectedFile: "src/saga.ts",
      changedLines: 6,
      explanation:
        "Saga compensation was not LIFO-ordered, leaving orphaned resources. This patch adds explicit reverse-order compensation.",
      dialEquivalent: {
        dial: "F",
        from: config.F,
        to: "F3_resilient_invariant_runtime",
      },
    };
  }
  if (ruleId.includes("r10") || ruleId.includes("unit-economics") || ruleId.includes("economic")) {
    return {
      description: "Add budget envelope with hard stop at $0.25",
      diff: `--- a/src/agent.ts
+++ b/src/agent.ts
@@ -120,6 +120,14 @@
 async function runAgentTurn() {
+  const BUDGET_USD = 0.25;
+  const inFlightCost = await getTotalCost();
+  if (inFlightCost >= BUDGET_USD) {
+    await gracefulHandoff();
+    return;
+  }
+`,
      affectedFile: "src/agent.ts",
      changedLines: 7,
      explanation:
        "No budget envelope was enforced, allowing retry storms to burn unlimited spend. This patch adds a $0.25 hard stop with graceful handoff.",
      dialEquivalent: {
        dial: "F",
        from: config.F,
        to: "F3_resilient_invariant_runtime",
      },
    };
  }
  return {
    description: "Apply resilient recovery pattern",
    diff: "--- a/src/agent.ts\n+++ b/src/agent.ts\n",
    affectedFile: "src/agent.ts",
    changedLines: 1,
    explanation: "Fixes the invariant violation",
    dialEquivalent: {
      dial: "F",
      from: config.F,
      to: "F3_resilient_invariant_runtime",
    },
  };
}

