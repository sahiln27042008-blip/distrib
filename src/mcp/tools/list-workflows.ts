// enterpriseee/enterprise-simulator/src/mcp/tools/list-workflows.ts

import { listWorkflows, getWorkflow } from "../../compiler/workflow-store.ts";

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

export const listWorkflowsTool: McpTool = {
  name: "list_workflows",
  description:
    "Lists all workflows currently stored in the server, with their IDs, names, node counts, component lists, and declared invariants. Use this tool to recall or re-fetch active workflows in the project.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  async handler(_args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const ids = listWorkflows();
    const fullWorkflows = ids
      .map((id) => {
        const wf = getWorkflow(id, context?.sessionId);
        if (!wf) return null;
        return {
          id: wf.id,
          name: wf.name,
          nodesCount: wf.nodes.length,
          nodes: wf.nodes.map(n => n.nodeName),
          createdAt: wf.createdAt,
        };
      })
      .filter(Boolean);

    return {
      success: true,
      count: fullWorkflows.length,
      workflows: fullWorkflows,
    };
  },
};

export default listWorkflowsTool;

