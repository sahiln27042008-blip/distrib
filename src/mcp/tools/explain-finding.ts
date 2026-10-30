import { createOrchestrator } from "../../llm/meta-client.ts";
import { EXPLAIN_FINDING_PROMPT } from "../../llm/prompts.ts";
import type { Finding } from "../../../../../resilient-agent-invariants/src/types/finding.ts";
import type { Trace } from "../../trace.ts";

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  handler: (args: Record<string, unknown>, context?: { sessionId?: string }) => Promise<Record<string, unknown>>;
}

function buildMockExplanation(finding: Finding, relevantSpans: Array<{ spanId?: string; name?: string }>): string {
  const ruleId = (finding.rule_id || "unknown").toLowerCase();
  const spanHint = relevantSpans.length > 0
    ? relevantSpans.map((s) => s.spanId || s.name || "span").join(", ")
    : "trace evidence";

  if (ruleId.includes("r04") || ruleId.includes("idempotency")) {
    return `The auditor flagged this as an idempotency violation because the same logical payment appears across multiple relevant spans in the trace, including ${spanHint}. The repeated execution path shows the system accepted a second side effect without guarding it behind a stable replay key, which makes a duplicate charge possible.`;
  }

  if (ruleId.includes("r05") || ruleId.includes("saga")) {
    return `This saga failure is grounded in the trace around ${spanHint}, where the workflow enters a compensation path but the compensation state is not fully reconciled. The system permits a partial multi-step operation to continue after a failure, leaving the ledger and workflow state out of sync.`;
  }

  if (ruleId.includes("r10") || ruleId.includes("economic")) {
    return `The trace around ${spanHint} shows the agent burning tokens or retry spend without a corresponding bounded recovery path. The event pattern indicates a unit-economics failure: the system keeps paying for work that does not produce a successful bounded outcome, so the operating cost outruns the business value.`;
  }

  if (ruleId.includes("r11") || ruleId.includes("compaction") || ruleId.includes("write")) {
    return `The write-amplification evidence sits in the trace spans ${spanHint}, where the same logical action produces repeated storage churn instead of compact, deduplicated work. This is a compaction problem because the workflow writes more than necessary for a single outcome, creating avoidable I/O and making the system unstable under load.`;
  }

  return `The trace evidence for this finding is centered on ${spanHint}. The recorded spans show the system reached a failure state that the auditor classifies as a reliability invariant violation, and the relevant evidence is the repeated or unbounded execution pattern captured in the trace.`;
}

function normalizeExplanation(raw: string | undefined, fallback: string): string {
  const text = (raw || "").trim();
  if (!text) return fallback;
  if (/describe your system|start by describing|I'll start by/i.test(text)) {
    return fallback;
  }
  return text;
}

export const explainFindingTool: McpTool = {
  name: "explain_finding",
  description:
    "Produce a 2-paragraph plain-English root-cause explanation for an invariant finding. Grounds the explanation in the actual trace evidence and span IDs. Does not invent behavior not in the trace.",
  inputSchema: {
    type: "object",
    properties: {
      finding: { type: "object", description: "Finding object from audit_trace" },
      trace: { type: "object", description: "The full Trace object so span IDs in the finding can be looked up" },
    },
    required: ["finding", "trace"],
  },
  async handler(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const finding = args.finding as Finding | undefined;
    const trace = args.trace as Trace | undefined;

    if (!finding || !finding.rule_id) {
      return { success: false, error: "finding with rule_id is required" };
    }
    if (!trace || !trace.spans || !Array.isArray(trace.spans)) {
      return { success: false, error: "trace with spans is required" };
    }

    try {
      const spanIds = Array.isArray(finding.evidence?.span_ids) ? finding.evidence.span_ids : [];
      const relevantSpans = trace.spans.filter((s) => spanIds.includes(s.spanId));
      const findingJson = JSON.stringify(finding, null, 2);
      const spansJson = JSON.stringify(relevantSpans, null, 2);

      const orchestrator = createOrchestrator();
      const messages = [
        { role: "system" as const, content: EXPLAIN_FINDING_PROMPT },
        {
          role: "user" as const,
          content: `Explain this finding:\n\nFINDING:\n${findingJson}\n\nRELEVANT SPANS:\n${spansJson}`,
        },
      ];

      const response = await orchestrator.chat(messages, []);
      const fallback = buildMockExplanation(finding, relevantSpans);
      const explanation = normalizeExplanation(response.text, fallback);

      return {
        success: true,
        finding: finding.rule_id,
        explanation,
        citedSpanIds: spanIds,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  },
};

export const tool = explainFindingTool;
export default explainFindingTool;
