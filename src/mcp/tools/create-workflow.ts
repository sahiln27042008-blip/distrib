// enterpriseee/enterprise-simulator/src/mcp/tools/create-workflow.ts

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOrchestrator } from "../../llm/meta-client.ts";
import { createWorkflow } from "../../compiler/workflow-store.ts";

export interface ToolContext {
  sessionId?: string;
  orchestrator?: any;
  [key: string]: unknown;
}

export interface ToolResult {
  success: boolean;
  [key: string]: unknown;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  handler: (args: Record<string, unknown>, context?: ToolContext) => Promise<ToolResult>;
}

function loadCompilerPrompt(): string {
  try {
    const mdPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../compiler/alphabet-compiler.md",
    );
    if (fs.existsSync(mdPath)) {
      return fs.readFileSync(mdPath, "utf8");
    }
  } catch {
    // Fall back to embedded prompt below
  }

  return `You are the Causal Architecture Compiler. Ingest the system description and compile it into a workflow ID, human-readable name, and declared invariants based on the 10-letter causal alphabet.`;
}

function stableSlug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) return "workflow";
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return `${normalized.slice(0, 20)}-${(hash % 100000).toString(36)}`;
}

function generateCannedWorkflow(description: string, userInvariants?: string[]): {
  id: string;
  name: string;
  declaredInvariants: string[];
} {
  const lower = description.toLowerCase();
  const slug = stableSlug(description);

  if (
    lower.includes("stripe") ||
    lower.includes("refund") ||
    lower.includes("payment") ||
    lower.includes("checkout")
  ) {
    return {
      id: `wf-payment-refund-${slug}`,
      name: "Payment Refund Workflow",
      declaredInvariants: userInvariants?.length
        ? userInvariants
        : ["payment_safety", "idempotency", "resource_safety"],
    };
  }

  if (
    lower.includes("crm") ||
    lower.includes("salesforce") ||
    lower.includes("hubspot") ||
    lower.includes("lead")
  ) {
    return {
      id: `wf-crm-sync-${slug}`,
      name: "CRM Lead Synchronization Workflow",
      declaredInvariants: userInvariants?.length
        ? userInvariants
        : ["task_correctness", "idempotency", "recovery"],
    };
  }

  if (
    lower.includes("cfo") ||
    lower.includes("invoice") ||
    lower.includes("accounting") ||
    lower.includes("vendor")
  ) {
    return {
      id: `wf-cfo-invoice-${slug}`,
      name: "CFO Invoice Processing Workflow",
      declaredInvariants: userInvariants?.length
        ? userInvariants
        : ["payment_safety", "idempotency", "task_correctness"],
    };
  }

  return {
    id: `wf-enterprise-${slug}`,
    name: "Enterprise Agent Workflow",
    declaredInvariants: userInvariants?.length
      ? userInvariants
      : ["task_correctness", "resource_safety", "idempotency"],
  };
}

export const createWorkflowTool: McpTool = {
  name: "create_workflow",
  description:
    "Initializes a new workflow from a natural-language system description and declared invariants, parsing it into the 10-letter causal alphabet substrate pipeline.",
  inputSchema: {
    type: "object",
    properties: {
      workflowId: { type: "string", description: "Optional explicit workflow identifier" },
      name: { type: "string", description: "Display name for the workflow" },
      description: { type: "string", description: "Optional workflow description" },
      systemDescription: {
        type: "string",
        description: "Documentation or description of the AI agent workflow architecture",
      },
      declaredInvariants: {
        type: "array",
        items: { type: "string" },
        description: "List of safety and reliability invariants to audit (optional)",
      },
    },
    required: ["systemDescription"],
  },
  async handler(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const explicitId = typeof args.workflowId === "string" && args.workflowId.trim() ? args.workflowId.trim() : undefined;
    const explicitName = typeof args.name === "string" && args.name.trim() ? args.name.trim() : undefined;
    const explicitDescription = typeof args.description === "string" ? args.description : undefined;
    const systemDescription = args.systemDescription as string | undefined;

    if (explicitId && explicitName) {
      const workflow = createWorkflow(explicitId, explicitName, [], explicitDescription);
      return {
        success: true,
        workflowId: workflow.id,
        name: explicitName,
        description: explicitDescription,
        declaredInvariants: workflow.declaredInvariants,
        nodesCount: 0,
      };
    }

    if (
      !systemDescription ||
      typeof systemDescription !== "string" ||
      systemDescription.trim().length === 0
    ) {
      return {
        success: false,
        error: "systemDescription is required",
      };
    }

    const userInvariants = Array.isArray(args.declaredInvariants)
      ? (args.declaredInvariants as string[]).filter((i) => typeof i === "string")
      : undefined;

    const orchestrator = context?.orchestrator || createOrchestrator();
    const compilerPrompt = loadCompilerPrompt();

    const messages = [
      { role: "system" as const, content: compilerPrompt },
      {
        role: "user" as const,
        content: `Compile this system architecture into a workflow definition with workflowId, name, and declaredInvariants:\n\n${systemDescription}`,
      },
    ];

    let workflowMeta = generateCannedWorkflow(systemDescription, userInvariants);

    try {
      const response = await orchestrator.chat(messages, []);
      if (response.text && response.text.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(response.text);
          if (parsed.workflowId || parsed.id) {
            workflowMeta = {
              id: parsed.workflowId || parsed.id,
              name: parsed.name || workflowMeta.name,
              declaredInvariants:
                userInvariants && userInvariants.length > 0
                  ? userInvariants
                  : Array.isArray(parsed.declaredInvariants)
                    ? parsed.declaredInvariants
                    : workflowMeta.declaredInvariants,
            };
          }
        } catch {
          // Keep keyword-based metadata
        }
      }
    } catch {
      // Orchestrator failure / mock orchestrator -> use canned workflow
    }

    const workflow = createWorkflow(
      workflowMeta.id,
      workflowMeta.name,
      workflowMeta.declaredInvariants,
      systemDescription,
    );

    return {
      success: true,
      workflowId: workflow.id,
      name: workflow.name,
      declaredInvariants: workflow.declaredInvariants,
      workflow,
      nodesCount: 0,
    };
  },
};

export const tool = createWorkflowTool;
export default createWorkflowTool;
