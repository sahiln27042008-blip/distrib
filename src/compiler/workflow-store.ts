// enterpriseee/enterprise-simulator/src/compiler/workflow-store.ts

export interface SubstrateAssignment {
  vowel: "REGISTER" | "CELL" | "LOG" | "LEASE" | "CHANNEL" | string;
  params: Record<string, unknown>;
}

export interface ConsonantAssignment {
  kind: "DELAY" | "SEVER" | "DUPLICATE" | "SATURATE" | "WIPE" | "CORRUPT"
    | "TIMING" | "OMISSION" | "DUPLICATION" | "CRASH_AMNESIA" | "BYZANTINE";
  params: Record<string, unknown>;
}

export interface WorkflowNode {
  index: number;
  nodeId?: string;
  nodeName: string;
  nodeDescription?: string;
  substrates: SubstrateAssignment[];
  consonants?: ConsonantAssignment[];
  outboundEdges?: string[];
  metadata?: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  declaredInvariants: string[];
  nodes: WorkflowNode[];
  createdAt: number;
  updatedAt: number;
  systemDescription?: string;
}

const store = new Map<string, Workflow>();
const workflowsBySession = new Map<string, Set<string>>();

/**
 * Creates and initializes a new workflow in the in-memory store.
 */
export function createWorkflow(
  id: string,
  name: string,
  declaredInvariants: string[] = [],
  systemDescription?: string,
): Workflow {
  let uniqueId = id;
  let suffix = 2;
  while (store.has(uniqueId)) {
    uniqueId = `${id}-${suffix++}`;
  }
  const now = Date.now();
  const workflow: Workflow = {
    id: uniqueId,
    name,
    declaredInvariants: Array.isArray(declaredInvariants) ? [...declaredInvariants] : [],
    nodes: [],
    createdAt: now,
    updatedAt: now,
    ...(systemDescription ? { systemDescription } : {}),
  };

  store.set(uniqueId, workflow);
  return workflow;
}

export function associateWorkflowWithSession(workflowId: string, sessionId: string): void {
  if (!store.has(workflowId)) return;
  const workflowIds = workflowsBySession.get(sessionId) ?? new Set<string>();
  workflowIds.add(workflowId);
  workflowsBySession.set(sessionId, workflowIds);
}

export function isWorkflowOwnedBySession(workflowId: string, sessionId: string): boolean {
  return workflowsBySession.get(sessionId)?.has(workflowId) ?? false;
}

/**
 * Inserts a new node with causal alphabet substrates into an existing workflow.
 * Automatically assigns the sequential 1-based index.
 */
export function insertNode(
  workflowId: string,
  nodeData: {
    nodeId?: string;
    nodeName: string;
    nodeDescription?: string;
    substrates: SubstrateAssignment[];
    consonants?: ConsonantAssignment[];
    outboundEdges?: string[];
    metadata?: Record<string, unknown>;
  },
): {
  workflowId: string;
  nodeIndex: number;
  node: WorkflowNode;
  totalNodes: number;
} {
  const workflow = store.get(workflowId);
  if (!workflow) {
    throw new Error(`Workflow with ID '${workflowId}' not found.`);
  }

  const nextIndex = workflow.nodes.length + 1;
  const node: WorkflowNode = {
    index: nextIndex,
    ...(nodeData.nodeId ? { nodeId: nodeData.nodeId } : {}),
    nodeName: nodeData.nodeName,
    nodeDescription: nodeData.nodeDescription ?? "",
    substrates: Array.isArray(nodeData.substrates) ? nodeData.substrates : [],
    ...(nodeData.consonants ? { consonants: nodeData.consonants } : {}),
    ...(nodeData.outboundEdges ? { outboundEdges: nodeData.outboundEdges } : {}),
    ...(nodeData.metadata ? { metadata: nodeData.metadata } : {}),
  };

  workflow.nodes.push(node);
  workflow.updatedAt = Date.now();

  return {
    workflowId,
    nodeIndex: nextIndex,
    node,
    totalNodes: workflow.nodes.length,
  };
}

/**
 * Retrieves a workflow by ID including all sequentially inserted nodes.
 */
export function getWorkflow(workflowId: string, sessionId?: string): Workflow | undefined {
  if (sessionId && !isWorkflowOwnedBySession(workflowId, sessionId)) return undefined;
  return store.get(workflowId);
}

/**
 * Returns a list of all active workflow IDs in the store.
 */
export function listWorkflows(): string[] {
  return Array.from(store.keys());
}

/**
 * Resets the in-memory workflow store (for unit tests and clean restarts).
 */
export function clearWorkflows(): void {
  store.clear();
  workflowsBySession.clear();
}

