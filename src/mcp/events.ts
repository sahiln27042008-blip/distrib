import { EventEmitter } from "node:events";

export const workflowEvents = new EventEmitter();

export function emitWorkflowNodeAdded(payload: Record<string, unknown>): void {
  workflowEvents.emit("WORKFLOW_NODE_ADDED", payload);
}
