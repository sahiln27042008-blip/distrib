// enterpriseee/enterprise-simulator/src/mcp/tools/connect-nodes.ts

import { connectNodes, getWorkflow } from "../../compiler/workflow-store.ts";

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

export const connectNodesTool: McpTool = {
  name: "connect_nodes",
  description:
    "Connects two nodes in an existing workflow by adding toNode to fromNode's outboundEdges. Allows wiring causal edges in any authoring order, even after all nodes are created.",
  inputSchema: {
    type: "object",
    properties: {
      workflowId: {
        type: "string",
        description: "The ID of the workflow containing the nodes",
      },
      fromNode: {
        type: "string",
        description: "The source nodeName, nodeId, or index",
      },
      toNode: {
        type: "string",
        description: "The target nodeName or nodeId to connect to",
      },
      channelParams: {
        type: "object",
        description: "Optional channel parameters (e.g. timeoutMs, idempotencyEnabled)",
      },
    },
    required: ["workflowId", "fromNode", "toNode"],
  },
  async handler(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const workflowId = typeof args.workflowId === "string" ? args.workflowId.trim() : "";
    const fromNode = typeof args.fromNode === "string" ? args.fromNode.trim() : "";
    const toNode = typeof args.toNode === "string" ? args.toNode.trim() : "";
    const channelParams = args.channelParams && typeof args.channelParams === "object"
      ? (args.channelParams as Record<string, unknown>)
      : undefined;

    if (!workflowId || !fromNode || !toNode) {
      return {
        success: false,
        error: "workflowId, fromNode, and toNode are all required",
      };
    }

    const workflow = getWorkflow(workflowId, context?.sessionId);
    if (!workflow) {
      return {
        success: false,
        error: `Workflow '${workflowId}' not found or inaccessible`,
      };
    }

    try {
      const result = connectNodes(workflowId, fromNode, toNode, channelParams);
      return {
        success: true,
        workflowId: result.workflowId,
        fromNode: result.fromNode,
        toNode: result.toNode,
        outboundEdges: result.outboundEdges,
        totalNodes: workflow.nodes.length,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
      };
    }
  },
};

export default connectNodesTool;

