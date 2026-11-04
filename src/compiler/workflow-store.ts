// enterpriseee/enterprise-simulator/src/compiler/workflow-store.ts

export function normalizeSubstrateVowel(value: string | undefined): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized === "REGISTER" ? "CELL" : normalized;
}

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
  initialNodes?: Array<{
    nodeId?: string;
    nodeName: string;
    nodeDescription?: string;
    substrates?: SubstrateAssignment[];
    consonants?: ConsonantAssignment[];
    outboundEdges?: string[];
    metadata?: Record<string, unknown>;
  }>,
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

  if (Array.isArray(initialNodes)) {
    for (const [idx, n] of initialNodes.entries()) {
      workflow.nodes.push({
        index: idx + 1,
        ...(n.nodeId ? { nodeId: n.nodeId } : {}),
        nodeName: n.nodeName,
        nodeDescription: n.nodeDescription ?? "",
        substrates: Array.isArray(n.substrates)
          ? n.substrates.map((substrate) => ({
              ...substrate,
              vowel: normalizeSubstrateVowel(substrate.vowel),
            }))
          : [],
        ...(n.consonants ? { consonants: n.consonants } : {}),
        ...(n.outboundEdges ? { outboundEdges: n.outboundEdges } : {}),
        ...(n.metadata ? { metadata: n.metadata } : {}),
      });
    }
  }

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
    substrates: Array.isArray(nodeData.substrates)
      ? nodeData.substrates.map((substrate) => ({
          ...substrate,
          vowel: normalizeSubstrateVowel(substrate.vowel),
        }))
      : [],
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



/**
 * Connects two existing nodes in a workflow by adding toNode to fromNode's outboundEdges.
 * Allows wiring edges in any order, even after nodes are created.
 */
export function connectNodes(
  workflowId: string,
  fromNode: string,
  toNode: string,
  channelParams?: Record<string, unknown>,
): {
  workflowId: string;
  fromNode: string;
  toNode: string;
  outboundEdges: string[];
} {
  const workflow = store.get(workflowId);
  if (!workflow) {
    throw new Error(`Workflow with ID '${workflowId}' not found.`);
  }

  const source = workflow.nodes.find(
    (n) => n.nodeName === fromNode || n.nodeId === fromNode || String(n.index) === fromNode
  );
  if (!source) {
    throw new Error(`Source node '${fromNode}' not found in workflow '${workflowId}'.`);
  }

  source.outboundEdges = source.outboundEdges ?? [];
  if (!source.outboundEdges.includes(toNode)) {
    source.outboundEdges.push(toNode);
  }

  if (channelParams) {
    source.metadata = source.metadata ?? {};
    source.metadata.channelParams = {
      ...((source.metadata.channelParams as Record<string, unknown>) ?? {}),
      [toNode]: channelParams,
    };
  }

  workflow.updatedAt = Date.now();

  return {
    workflowId,
    fromNode: source.nodeName,
    toNode,
    outboundEdges: source.outboundEdges,
  };
}

/**
 * Updates or patches an existing node's substrates, consonants, or outboundEdges.
 */
export function updateNode(
  workflowId: string,
  nodeId: string,
  patch: {
    substrates?: SubstrateAssignment[];
    consonants?: ConsonantAssignment[];
    outboundEdges?: string[];
    nodeDescription?: string;
    metadata?: Record<string, unknown>;
  },
): {
  workflowId: string;
  node: WorkflowNode;
} {
  const workflow = store.get(workflowId);
  if (!workflow) {
    throw new Error(`Workflow with ID '${workflowId}' not found.`);
  }

  const node = workflow.nodes.find(
    (n) => n.nodeName === nodeId || n.nodeId === nodeId || String(n.index) === nodeId
  );
  if (!node) {
    throw new Error(`Node '${nodeId}' not found in workflow '${workflowId}'.`);
  }

  if (Array.isArray(patch.substrates)) {
    node.substrates = patch.substrates.map((substrate) => ({
      ...substrate,
      vowel: normalizeSubstrateVowel(substrate.vowel),
    }));
  }
  if (Array.isArray(patch.consonants)) {
    node.consonants = patch.consonants;
  }
  if (Array.isArray(patch.outboundEdges)) {
    node.outboundEdges = patch.outboundEdges;
  }
  if (typeof patch.nodeDescription === 'string') {
    node.nodeDescription = patch.nodeDescription;
  }
  if (patch.metadata && typeof patch.metadata === 'object') {
    node.metadata = { ...(node.metadata ?? {}), ...patch.metadata };
  }

  workflow.updatedAt = Date.now();

  return {
    workflowId,
    node,
  };
}
