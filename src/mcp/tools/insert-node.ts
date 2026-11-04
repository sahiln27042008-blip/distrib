// enterpriseee/enterprise-simulator/src/mcp/tools/insert-node.ts

import { insertNode, type ConsonantAssignment, type SubstrateAssignment } from "../../compiler/workflow-store.ts";
import { normalizeConsonantAlias } from "../../physics/alphabet/apply.ts";

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

function normalizeNodeShape(args: Record<string, unknown>) {
  const workflowId = typeof args.workflowId === "string" ? args.workflowId.trim() : undefined;
  const nodeId = typeof args.nodeId === "string" && args.nodeId.trim() ? args.nodeId.trim() : undefined;
  const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : undefined;
  const nodeName = typeof args.nodeName === "string" && args.nodeName.trim() ? args.nodeName.trim() : undefined;
  const explicitName = name ?? nodeName;
  const description = typeof args.description === "string" ? args.description : typeof args.nodeDescription === "string" ? args.nodeDescription : undefined;

  const rawVowels = args.vowels;
  const rawSubstrates = args.substrates;
  let vowels: Record<string, any> | undefined;
  if (rawVowels && typeof rawVowels === "object") {
    vowels = rawVowels as Record<string, any>;
  } else if (Array.isArray(rawSubstrates)) {
    vowels = {};
    for (const entry of rawSubstrates) {
      if (!entry || typeof entry !== "object") continue;
      const key = String((entry as any).vowel ?? "REGISTER");
      if (!vowels[key]) vowels[key] = (entry as any).params ?? {};
    }
  }

  let consonants: unknown[] | undefined;
  if (Array.isArray(args.consonants)) {
    consonants = args.consonants as unknown[];
  } else if (args.consonants && typeof args.consonants === "object") {
    consonants = Object.entries(args.consonants as Record<string, unknown>).map(([kind, params]) => ({ kind, params }));
  }
  const outboundEdges = Array.isArray(args.outboundEdges)
    ? args.outboundEdges.filter((value) => typeof value === "string")
    : undefined;

  return { workflowId, nodeId, name: explicitName, description, vowels, consonants, outboundEdges };
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
      consonants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              enum: [
                "DELAY",
                "SEVER",
                "DUPLICATE",
                "SATURATE",
                "WIPE",
                "CORRUPT",
                "TIMING",
                "OMISSION",
                "DUPLICATION",
                "CRASH_AMNESIA",
                "BYZANTINE",
              ],
            },
            params: { type: "object" },
          },
          required: ["kind"],
        },
        description: "Perturbation assignments applied to this node",
      },
      outboundEdges: {
        type: "array",
        items: { type: "string" },
        description: "Target node names for explicit graph edges",
      },
    },
    required: ["workflowId", "nodeName", "substrates"],
  },
  async handler(args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    const normalized = normalizeNodeShape(args);

    if (!normalized.workflowId) {
      return {
        success: false,
        error: "workflowId is required",
      };
    }

    if (!normalized.name) {
      return {
        success: false,
        error: "nodeName is required",
      };
    }

    const workflowId = normalized.workflowId;
    const nodeName = normalized.name;
    const nodeDescription = normalized.description ?? "";

    const rawSubstrates = Array.isArray(args.substrates)
      ? args.substrates
      : normalized.vowels
        ? Object.entries(normalized.vowels).map(([vowel, params]) => ({ vowel, params }))
        : [];

    if (!Array.isArray(rawSubstrates) || rawSubstrates.length === 0) {
      return {
        success: false,
        error: "substrates must be an array of { vowel, params }",
      };
    }

    const substrates: SubstrateAssignment[] = rawSubstrates.map((s: any) => ({
      vowel: s.vowel ?? "REGISTER",
      params: typeof s.params === "object" && s.params !== null ? s.params : {},
    }));

    const channelSubstrates = substrates.filter((s) => String(s.vowel).toUpperCase() === "CHANNEL");
    const invalidChannel = channelSubstrates.some((channel) => {
      const params = channel.params as Record<string, unknown>;
      const hasIdempotency =
        typeof params.idempotencyEnabled === "boolean" ||
        typeof params.idempotencyKey === "boolean";
      return !hasIdempotency || typeof params.timeoutMs !== "number";
    });
    if (invalidChannel) {
      return {
        success: false,
        error: "CHANNEL requires idempotencyEnabled (boolean) and timeoutMs (number). Ask the user: does this external API support idempotency keys? What is the timeout?",
      };
    }

    let normalizedConsonants: ConsonantAssignment[] | undefined;
    const rawConsonants = normalized.consonants;
    if (Array.isArray(rawConsonants)) {
      normalizedConsonants = [];
      for (const assignment of rawConsonants) {
        if (!assignment || typeof assignment !== "object") {
          throw new Error("Consonant assignments must be objects with a kind and optional params.");
        }
        const kind = String((assignment as Record<string, unknown>).kind ?? "");
        if (!kind) {
          throw new Error("Consonant kind is required.");
        }
        const acceptedKinds = new Set([
          "DELAY",
          "SEVER",
          "DUPLICATE",
          "SATURATE",
          "WIPE",
          "CORRUPT",
          "TIMING",
          "OMISSION",
          "DUPLICATION",
          "CRASH_AMNESIA",
          "BYZANTINE",
        ]);
        if (!acceptedKinds.has(kind)) {
          throw new Error(`MODEL_GAP: unknown consonant kind '${kind}'.`);
        }
        const params = typeof (assignment as Record<string, unknown>).params === "object" && (assignment as Record<string, unknown>).params !== null
          ? ((assignment as Record<string, unknown>).params as Record<string, unknown>)
          : (typeof (assignment as Record<string, unknown>).params === "number" || typeof (assignment as Record<string, unknown>).params === "string" || typeof (assignment as Record<string, unknown>).params === "boolean")
            ? ((assignment as Record<string, unknown>).params as unknown as Record<string, unknown>)
            : {};
        const normalized = normalizeConsonantAlias({ kind, params });
        if (!normalized) continue;
        const normalizedParams = { ...(normalized as unknown as Record<string, unknown>) };
        delete normalizedParams.kind;
        normalizedConsonants.push({ kind: normalized.kind, params: normalizedParams });
      }
    }

    if (normalized.outboundEdges !== undefined && !Array.isArray(normalized.outboundEdges)) {
      return {
        success: false,
        error: "outboundEdges must be an array of target node names",
      };
    }

    try {
      const result = insertNode(workflowId, {
        ...(normalized.nodeId ? { nodeId: normalized.nodeId } : {}),
        nodeName,
        nodeDescription,
        substrates,
        ...(normalizedConsonants && normalizedConsonants.length > 0 ? { consonants: normalizedConsonants } : {}),
        ...(normalized.outboundEdges && normalized.outboundEdges.length > 0 ? { outboundEdges: normalized.outboundEdges } : {}),
      });

      return {
        success: true,
        workflowId,
        nodeIndex: result.nodeIndex,
        node: result.node,
        totalNodes: result.totalNodes,
        compiledSubstrates: result.node?.substrates ?? [],
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
