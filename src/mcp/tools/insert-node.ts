// enterpriseee/enterprise-simulator/src/mcp/tools/insert-node.ts

import { insertNode, type SubstrateAssignment } from "../../compiler/workflow-store.ts";

export interface ToolContext {
  sessionId?: string;
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

export const insertNodeTool: McpTool = {
  name: "insert_node",
  description:
    "Adds an execution node with causal alphabet substrate assignments (Registers, Logs, Leases, Channels) to a workflow in sequence.",
  inputSchema: {
    type: "object",
    properties: {
      workflowId: {
        type: "string",
        description: "ID of the workflow to append the node to",
      },
      nodeName: {
        type: "string",
        description: "Human-readable name of the node (e.g., 'Stripe Payment Gateway')",
      },
      nodeDescription: {
        type: "string",
        description: "Description of node responsibilities and failure risks",
      },
      substrates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            vowel: {
              type: "string",
              enum: ["REGISTER", "CELL", "LOG", "LEASE", "CHANNEL"],
              description: "Alphabet vowel substrate kind",
            },
            params: {
              type: "object",
              description: "Configuration parameters for the vowel",
            },
          },
          required: ["vowel", "params"],
        },
        description: "Alphabet substrates attached to this node",
      },
    },
    required: ["workflowId", "nodeName", "substrates"],
  },
  async handler(args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const workflowId = args.workflowId as string | undefined;
    if (!workflowId || typeof workflowId !== "string" || workflowId.trim().length === 0) {
      return {
        success: false,
        error: "workflowId is required",
      };
    }

    const nodeName = args.nodeName as string | undefined;
    if (!nodeName || typeof nodeName !== "string" || nodeName.trim().length === 0) {
      return {
        success: false,
        error: "nodeName is required",
      };
    }

    const nodeDescription = (args.nodeDescription as string) ?? "";

    const rawSubstrates = args.substrates;
    if (!Array.isArray(rawSubstrates)) {
      return {
        success: false,
        error: "substrates must be an array of { vowel, params }",
      };
    }

    const substrates: SubstrateAssignment[] = rawSubstrates.map((s: any) => ({
      vowel: s.vowel ?? "REGISTER",
      params: typeof s.params === "object" && s.params !== null ? s.params : {},
    }));

    try {
      const result = insertNode(workflowId, {
        nodeName,
        nodeDescription,
        substrates,
      });

      return {
        success: true,
        workflowId,
        nodeIndex: result.nodeIndex,
        node: result.node,
        totalNodes: result.totalNodes,
        compiledSubstrates: result.node.substrates,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || String(err),
      };
    }
  },
};

export const tool = insertNodeTool;
export default insertNodeTool;
