import { emitWorkflowNodeAdded } from "./events.ts";

export type VowelKey = "REGISTER" | "LOG" | "LEASE" | "CHANNEL";
export type ConsonantKey = "TIMING" | "OMISSION" | "DUPLICATION" | "SATURATE" | "CRASH_AMNESIA" | "BYZANTINE";

export interface ChordNode {
  nodeId: string;
  name: string;
  vowels: Partial<Record<VowelKey, Record<string, unknown>>>;
  consonants?: Partial<Record<ConsonantKey, number | string | boolean>>;
  outboundEdges?: string[];
  x?: number;
  y?: number;
}

export interface StoredWorkflow {
  workflowId: string;
  name: string;
  description?: string;
  createdAt: number;
  nodes: Map<string, ChordNode>;
  edges: Array<{ from: string; to: string }>;
}

class WorkflowStore {
  private workflows = new Map<string, StoredWorkflow>();

  create(workflowId: string, name: string, description?: string): { success: boolean; workflowId?: string; error?: string } {
    if (!workflowId || !name) {
      return { success: false, error: "INVALID_WORKFLOW" };
    }
    if (this.workflows.has(workflowId)) {
      return { success: false, error: "WORKFLOW_EXISTS", workflowId };
    }
    this.workflows.set(workflowId, {
      workflowId,
      name,
      description,
      createdAt: 0,
      nodes: new Map(),
      edges: [],
    });
    return { success: true, workflowId };
  }

  insertNode(workflowId: string, node: ChordNode): {
    success: boolean;
    nodeId?: string;
    error?: string;
    totalNodes?: number;
    edges?: Array<{ from: string; to: string }>;
    node?: ChordNode;
  } {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return { success: false, error: "UNKNOWN_WORKFLOW", nodeId: node.nodeId };
    }

    const keys = Object.keys(node.vowels ?? {});
    if (keys.length === 0) {
      return { success: false, error: "NO_VOWEL", nodeId: node.nodeId };
    }

    const channelTarget = node.vowels.CHANNEL?.targetNodeId;
    if (typeof channelTarget === "string" && channelTarget.length > 0 && !workflow.nodes.has(channelTarget)) {
      return { success: false, error: "DANGLING_CHANNEL", nodeId: node.nodeId };
    }

    const index = workflow.nodes.size;
    const radius = 90 + index * 25;
    const angle = index * (Math.PI / 2.8);
    const x = 180 + Math.cos(angle) * radius;
    const y = 120 + Math.sin(angle) * radius;

    const normalizedNode: ChordNode = {
      ...node,
      nodeId: node.nodeId,
      name: node.name,
      vowels: { ...node.vowels },
      consonants: node.consonants ?? {},
      outboundEdges: Array.isArray(node.outboundEdges) ? [...node.outboundEdges] : [],
      x,
      y,
    };

    workflow.nodes.set(normalizedNode.nodeId, normalizedNode);

    const channelRef = normalizedNode.vowels.CHANNEL && typeof normalizedNode.vowels.CHANNEL.targetNodeId === "string"
      ? normalizedNode.vowels.CHANNEL.targetNodeId
      : undefined;
    if (channelRef) {
      workflow.edges.push({ from: normalizedNode.nodeId, to: channelRef });
    }
    if (Array.isArray(normalizedNode.outboundEdges)) {
      for (const edgeTarget of normalizedNode.outboundEdges) {
        workflow.edges.push({ from: normalizedNode.nodeId, to: edgeTarget });
      }
    }

    const payload = {
      type: "WORKFLOW_NODE_ADDED",
      workflowId,
      node: {
        nodeId: normalizedNode.nodeId,
        name: normalizedNode.name,
        vowels: Object.keys(normalizedNode.vowels ?? {}),
        consonants: Object.keys(normalizedNode.consonants ?? {}),
        x: normalizedNode.x ?? x,
        y: normalizedNode.y ?? y,
      },
      edges: [...workflow.edges],
      totalNodes: workflow.nodes.size,
    };
    emitWorkflowNodeAdded(payload);

    return {
      success: true,
      nodeId: normalizedNode.nodeId,
      totalNodes: workflow.nodes.size,
      edges: [...workflow.edges],
      node: normalizedNode,
    };
  }

  get(workflowId: string): StoredWorkflow | undefined {
    return this.workflows.get(workflowId);
  }

  evict(workflowId: string): void {
    this.workflows.delete(workflowId);
  }
}

export const workflowStore = new WorkflowStore();
