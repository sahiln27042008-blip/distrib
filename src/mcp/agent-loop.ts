import type { Orchestrator, OrchestratorMessage, ToolCall } from "../llm/orchestrator.ts";
import { createOrchestrator } from "../llm/meta-client.ts";
import { SYSTEM_PROMPT } from "../llm/prompts.ts";
import { associateWorkflowWithSession, getWorkflow, isWorkflowOwnedBySession } from "../compiler/workflow-store.ts";

const DEFAULT_MAX_ITERATIONS = 6;
const configuredMaxIterations = Number(process.env.MAX_AGENT_ITERATIONS);
const MAX_ITERATIONS = Number.isFinite(configuredMaxIterations) && configuredMaxIterations > 0
  ? Math.min(Math.floor(configuredMaxIterations), DEFAULT_MAX_ITERATIONS)
  : DEFAULT_MAX_ITERATIONS;
const MAX_CONSECUTIVE_TOOL_ERRORS = 3;

export interface AgentLoopResult {
  text: string;
  stopReason: "stop" | "tool_calls" | "length" | "error";
  toolCalls: ToolCall[];
  graphData?: any;
}

export interface ToolDispatcher {
  (name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: object;
  handler: (args: any, context?: any) => Promise<any>;
}

export async function runAgentLoop(opts: {
  history: OrchestratorMessage[];
  userText: string;
  tools: McpTool[];
  orchestrator?: Orchestrator; // optional, defaults to createOrchestrator()
  context?: any;
}): Promise<AgentLoopResult> {
  const orchestrator = opts.orchestrator || createOrchestrator();
  const messages = opts.history;
  if (messages.length === 0 || messages[0]?.role !== "system") {
    messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  }
  messages.push({ role: "user", content: opts.userText });

  const toolDefs = (opts.tools || []).map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.inputSchema || { type: "object", properties: {} },
    },
  }));

  const allExecutedToolCalls: ToolCall[] = [];
  let activeWorkflowId: string | undefined;
  let consecutiveToolErrors = 0;

  function buildGraphDataResult(text: string, stopReason: AgentLoopResult["stopReason"]): AgentLoopResult {
    let graphData: any = undefined;
    const hasWorkflowTool = allExecutedToolCalls.some(
      tc => tc.name === "create_workflow" || tc.name === "insert_node"
    );

    if (hasWorkflowTool) {
      try {
        if (activeWorkflowId) {
          const wf = getWorkflow(activeWorkflowId, opts.context?.sessionId);
          if (wf) {
            const nodes = wf.nodes.map(n => {
              const primarySub = n.substrates[0]?.vowel || "CHANNEL";
              let substrateClass = "V4_CHANNEL";
              if (primarySub === "REGISTER" || primarySub === "CELL") substrateClass = "V1_CELL";
              else if (primarySub === "LOG") substrateClass = "V2_LOG";
              else if (primarySub === "LEASE") substrateClass = "V3_LEASE";

              const timeoutParam = (n.substrates.find(s => (s.params as any)?.timeoutMs)?.params as any)?.timeoutMs;
              const capParam = (n.substrates.find(s => (s.params as any)?.maxCapacity)?.params as any)?.maxCapacity;
              const durableParam = (n.substrates.find(s => (s.params as any)?.persistence)?.params as any)?.persistence === "DURABLE";

              return {
                id: `node-${n.index}`,
                name: n.nodeName,
                label: n.nodeName,
                role: [n.nodeDescription || n.nodeName, `Substrates: ${n.substrates.map(s => s.vowel).join(", ") || "CHANNEL"}`].join(" · "),
                substrate: substrateClass,
                substrates: n.substrates,
                timeoutMs: timeoutParam ?? 10000,
                capacity: capParam,
                durable: durableParam,
                evidence: `Compiled from workflow ${wf.id}`,
              };
            });

            // The store has no explicit dependency model yet, so render its current sequential-flow simplification.
            const edges = [];
            for (let idx = 0; idx < nodes.length - 1; idx++) {
              const src = nodes[idx];
              const tgt = nodes[idx + 1];
              if (!src || !tgt) continue;
              edges.push({
                id: `e-${src.id}-${tgt.id}`,
                source: src.id,
                target: tgt.id,
                from: src.id,
                to: tgt.id,
                latencyMs: 150 + idx * 50,
                evidence: `Causal flow from ${src.name} to ${tgt.name}`,
              });
            }

            graphData = {
              id: wf.id,
              name: wf.name,
              nodes,
              edges,
              invariants: wf.declaredInvariants,
              invariant: {
                id: wf.declaredInvariants[0] || "INV-001",
                description: `Enforce ${wf.declaredInvariants.join(", ") || "reliability"}`,
                maxEndToEndMs: 25000,
              },
            };

            for (const tc of allExecutedToolCalls) {
              if (tc.name === "create_workflow" || tc.name === "insert_node") {
                (tc as any).graphData = graphData;
              }
            }
          }
        }
      } catch (e) {
        console.error("[AGENT_LOOP] Error extracting graphData:", e);
      }
    }

    return {
      text,
      stopReason,
      toolCalls: allExecutedToolCalls,
      ...(graphData ? { graphData } : {}),
    };
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const isFinalIteration = i === MAX_ITERATIONS - 1;
    const currentTools = isFinalIteration ? [] : toolDefs;
    console.log(`[AGENT_LOOP] Iteration ${i}: calling orchestrator (${messages.length} msgs)...`);
    const response = await orchestrator.chat(messages, currentTools);
    const resolvedToolCalls = response.tool_calls.map((toolCall) => {
      const exactTool = (opts.tools || []).find((tool) => tool.name === toolCall.name);
      if (exactTool || toolCall.name.length < 5) return toolCall;
      const prefixMatches = (opts.tools || []).filter((tool) => tool.name.startsWith(toolCall.name));
      return prefixMatches.length === 1
        ? { ...toolCall, name: prefixMatches[0]!.name }
        : toolCall;
    });
    console.log(`[AGENT_LOOP] Iteration ${i}: model replied with ${resolvedToolCalls.length} tool calls (${resolvedToolCalls.map(tc => tc.name).join(", ")})`);

    if (resolvedToolCalls.length === 0) {
      if (/(?:^|\n)\s*Tool:\s*[\w-]+/i.test(response.text)) {
        return buildGraphDataResult(
          "The model wrote a tool name as plain text instead of issuing a structured tool call. No tool was executed. Please retry your request.",
          "error",
        );
      }
      return buildGraphDataResult(response.text, response.stop_reason);
    }

    allExecutedToolCalls.push(...resolvedToolCalls);

    messages.push({
      role: "assistant",
      content: response.text,
      tool_calls: resolvedToolCalls,
    });

    let circuitBroken = false;
    for (const tc of resolvedToolCalls) {
      if (circuitBroken) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: "Skipped because the tool error circuit breaker is open." }),
        });
        continue;
      }

      const tool = (opts.tools || []).find(t => t.name === tc.name);
      if (!tool) {
        consecutiveToolErrors++;
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: `Unknown tool: ${tc.name}` }),
        });
        circuitBroken = consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS;
        continue;
      }
      try {
        if (tc.name === "insert_node" && opts.context?.sessionId) {
          const workflowId = tc.arguments.workflowId as string | undefined;
          if (!workflowId || !isWorkflowOwnedBySession(workflowId, opts.context.sessionId)) {
            consecutiveToolErrors++;
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify({ error: "Workflow not found in this session." }),
            });
            circuitBroken = consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS;
            continue;
          }
        }
        console.log(`[AGENT_LOOP] Iteration ${i}: executing tool '${tc.name}'...`);
        const result = await tool.handler(tc.arguments, opts.context);
        console.log(`[AGENT_LOOP] Iteration ${i}: tool '${tc.name}' completed.`);
        const toolFailed = result && typeof result === "object" && result.success === false;
        if (tc.name === "create_workflow" && result && typeof result === "object" && result.success !== false) {
          activeWorkflowId = result.workflowId;
          if (activeWorkflowId && opts.context?.sessionId) {
            associateWorkflowWithSession(activeWorkflowId, opts.context.sessionId);
          }
        } else if (tc.name === "insert_node" && result && typeof result === "object" && result.success !== false) {
          activeWorkflowId = tc.arguments.workflowId as string | undefined;
        }
        let toolContent = typeof result === "string" ? result : JSON.stringify(result);
        if (tc.name === "run_matrix" && result && typeof result === "object" && result.trace) {
          if (opts.context) {
            (opts.context as any).lastTrace = result.trace;
          }
          const compact = {
            success: result.success,
            config: result.config,
            snapshot: result.snapshot,
            traceId: result.traceId,
            trace: { traceId: result.traceId, note: "Trace cached in session. Calling audit_trace will automatically inspect this trace." }
          };
          toolContent = JSON.stringify(compact);
        }
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolContent,
        });
        consecutiveToolErrors = toolFailed ? consecutiveToolErrors + 1 : 0;
        circuitBroken = consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS;
      } catch (err: any) {
        consecutiveToolErrors++;
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: err.message || String(err) }),
        });
        circuitBroken = consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS;
      }
    }

    if (circuitBroken) {
      return buildGraphDataResult(
        "I stopped after three consecutive tool errors. Check the tool arguments and server configuration, then retry.",
        "error",
      );
    }
  }

  // If loop exhausted with tool calls but no final text reply, do a final synthesis pass
  if (allExecutedToolCalls.length > 0) {
    try {
      console.log("[AGENT_LOOP] Requesting final diagnostic synthesis...");
      messages.push({
        role: "user",
        content: "You have gathered the evidence from the simulator and auditor. Present your complete reliability analysis, invariant violations, root causes, and recommended fixes in plain English."
      });
      const finalResp = await orchestrator.chat(messages, []);
      if (finalResp.text) {
        return buildGraphDataResult(finalResp.text, "stop");
      }
    } catch (e: any) {
      console.error("[AGENT_LOOP] Final synthesis error:", e);
    }
  }

  return buildGraphDataResult("Reached max iterations.", "length");
}
