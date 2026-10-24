import {
  createReplayHandle,
  serializeHandle,
  deserializeHandle,
  replay,
  type ReplayHandle,
  type ReplayResult,
} from "../../replay.ts";
import type { MatrixConfig } from "../../matrix-copy.ts";

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

export const replayTool: McpTool = {
  name: "replay",
  description:
    "Reproduce a prior matrix run deterministically. Accepts either a serialized ReplayHandle or a MatrixConfig; constructs a handle, runs the matrix + auditor, returns the full result. Same seed + config = identical result.",
  inputSchema: {
    type: "object",
    properties: {
      handle: {
        type: "string",
        description: "Serialized ReplayHandle JSON (from a prior replay call)",
      },
      config: {
        type: "object",
        description: "MatrixConfig (alternative to handle — constructs a new handle from this config)",
      },
    },
    required: [],
  },
  async handler(args: Record<string, unknown>, _context?: ToolContext): Promise<ToolResult> {
    let handle: ReplayHandle;

    if (args.handle !== undefined && args.handle !== null) {
      if (typeof args.handle !== "string") {
        return { success: false, error: "Invalid handle: must be a string" };
      }
      try {
        handle = deserializeHandle(args.handle);
      } catch (err: any) {
        return { success: false, error: `Invalid handle: ${err.message}` };
      }
    } else if (args.config !== undefined && args.config !== null) {
      if (typeof args.config !== "object") {
        return { success: false, error: "Invalid config: must be an object" };
      }
      try {
        handle = createReplayHandle(args.config as MatrixConfig);
      } catch (err: any) {
        return { success: false, error: `Invalid config: ${err.message}` };
      }
    } else {
      return { success: false, error: "Either handle or config is required" };
    }

    try {
      const result: ReplayResult = replay(handle);
      return {
        success: true,
        handle: serializeHandle(handle),
        snapshot: result.snapshot,
        traceId: result.trace.traceId,
        findings: result.findings || [],
        findingsCount: (result.findings || []).length,
      };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  },
};

export const tool = replayTool;
export default replayTool;

