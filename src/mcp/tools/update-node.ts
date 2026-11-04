// enterpriseee/enterprise-simulator/src/mcp/tools/update-node.ts

import { updateNode, getWorkflow, type SubstrateAssignment, type ConsonantAssignment } from "../../compiler/workflow-store.ts";

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

export const updateNodeTool: McpTool = {
  name: "update_node",
  description:
    "Updates or patches an existing node's substrates, consonants, outboundEdges, or description without recreating it.",
  inputSchema: {
    type: "object",
    properties: {
      workflowId: {
        type: "string",
        description: "The ID of the workflow containing the node",
      },
      nodeId: {
        type: "string",
        description: "The node name, nodeId, or index to patch",
      },
      substrates: {
        type: "array",
        items: { type: "object" },
        description: "Updated causal substrates (vowels: REGISTER, CELL, LOG, LEASE, CHANNEL) for this node",
      },
      consonants: {
        type: "array",
        items: { type: "object" },
        description: "Updated failure modes (consonants: DELAY, SEVER, DUPLICATE, SATURATE, WIPE, CORRUPT)",
      },
      outboundEdges: {
        type: "array",
        items: { type: "string" },
        description: "Updated list of target node names this node routes requests to",
      },
      nodeDescription: {
        type: "string",
        description: "Updated natural language description of this node's role",
      },
      metadata: {
        type: "object",
        description: "Updated arbitrary key-value metadata for this node",
      },
    },
    required: ["workflowId", "nodeId"],
  },
  async handler(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const workflowId = typeof args.workflowId === "string" ? args.workflowId.trim() : "";
    const nodeId = typeof args.nodeId === "string" ? args.nodeId.trim() : "";

    if (!workflowId || !nodeId) {
      return {
        success: false,
        error: "workflowId and nodeId are required",
      };
    }

    const workflow = getWorkflow(workflowId, context?.sessionId);
    if (!workflow) {
      return {
        success: false,
        error: `Workflow '${workflowId}' not found or inaccessible`,
      };
    }

    const patch: {
      substrates?: SubstrateAssignment[];
      consonants?: ConsonantAssignment[];
      outboundEdges?: string[];
      nodeDescription?: string;
      metadata?: Record<string, unknown>;
    } = {};

    if (Array.isArray(args.substrates)) {
      patch.substrates = args.substrates as SubstrateAssignment[];
    }
    if (Array.isArray(args.consonants)) {
      patch.consonants = args.consonants as ConsonantAssignment[];
    }
    if (Array.isArray(args.outboundEdges)) {
      patch.outboundEdges = (args.outboundEdges as unknown[]).filter((e): e is string => typeof e === "string");
    }
    if (typeof args.nodeDescription === "string") {
      patch.nodeDescription = args.nodeDescription;
    }
    if (args.metadata && typeof args.metadata === "object") {
      patch.metadata = args.metadata as Record<string, unknown>;
    }

    try {
      const result = updateNode(workflowId, nodeId, patch);
      return {
        success: true,
        workflowId: result.workflowId,
        node: result.node,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
      };
    }
  },
};

export default updateNodeTool;

