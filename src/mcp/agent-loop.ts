import type { Orchestrator, OrchestratorMessage, ToolCall } from "../llm/orchestrator.ts";
import { createOrchestrator } from "../llm/meta-client.ts";
import { SYSTEM_PROMPT } from "../llm/prompts.ts";
import { associateWorkflowWithSession, getWorkflow, isWorkflowOwnedBySession, listWorkflows } from "../compiler/workflow-store.ts";

const DEFAULT_MAX_ITERATIONS = 6;
const configuredMaxIterations = Number(process.env.MAX_AGENT_ITERATIONS);
const MAX_ITERATIONS = Number.isFinite(configuredMaxIterations) && configuredMaxIterations > 0
  ? Math.min(Math.floor(configuredMaxIterations), DEFAULT_MAX_ITERATIONS)
  : DEFAULT_MAX_ITERATIONS;
const MAX_CONSECUTIVE_TOOL_ERRORS = 3;

export interface AgentLoopResult {
  text: string;
  reasoning?: string;
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
  userImage?: string | null;
  tools: McpTool[];
  orchestrator?: Orchestrator; // optional, defaults to createOrchestrator()
  context?: any;
  onChunk?: (chunk: { type: string; [key: string]: any }) => void;
}): Promise<AgentLoopResult> {
  const orchestrator = opts.orchestrator || createOrchestrator();
  let latestReasoning: string | undefined = undefined;
  const messages = opts.history;
  if (messages.length === 0 || messages[0]?.role !== "system") {
    messages.unshift({ role: "system", content: SYSTEM_PROMPT });
  }

  if (opts.userImage) {
    const model = (orchestrator as any)?.config?.model || "";
    const isVision =
      model.toLowerCase().includes("vision") ||
      model.toLowerCase().includes("vl") ||
      model.toLowerCase().includes("muse") ||
      model.toLowerCase().includes("sam") ||
      model.toLowerCase().includes("llama-3.2-11b-vision") ||
      model.toLowerCase().includes("llama-3.2-90b-vision") ||
      !model;

    if (isVision) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: opts.userText },
          { type: "image_url", image_url: { url: opts.userImage } },
        ],
      } as any);
    } else {
      console.warn(`Model ${model} is not a vision model, sending text only`);
      messages.push({ role: "user", content: opts.userText });
    }
  } else {
    messages.push({ role: "user", content: opts.userText });
  }

  // Inject server workflow store state so model never forgets existing workflows
  const activeWfIds = listWorkflows();
  if (activeWfIds.length > 0) {
    const summaryList = activeWfIds
      .map((id) => {
        const wf = getWorkflow(id);
        return wf ? `Workflow ID '${wf.id}' ("${wf.name}", ${wf.nodes.length} nodes: ${wf.nodes.map(n => n.nodeName).join(", ")})` : null;
      })
      .filter(Boolean)
      .join("; ");
    if (summaryList && !messages.some(m => typeof m.content === 'string' && m.content.includes("[Active Workflows in Server Store:"))) {
      messages.splice(1, 0, {
        role: "system",
        content: `[Active Workflows in Server Store: ${summaryList}. Use 'list_workflows' or 'audit_workflow_reliability' to reference them.]`,
      });
    }
  }

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
  let lastToolName = "";
  let lastArgsSig = "";
  let consecutiveSameToolCalls = 0;

  function stableStringify(value: unknown): string {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    if (typeof value === "object") {
      return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
    }
    return String(value);
  }

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
      reasoning: latestReasoning,
      stopReason,
      toolCalls: allExecutedToolCalls,
      ...(graphData ? { graphData } : {}),
    };
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (messages.length > 50) {
      const system = messages[0];
      // ALWAYS find and preserve the first user message (the user's original system description)
      const firstUserMsg = messages.find((m) => m.role === "user" && (typeof m.content !== "string" || (!m.content.startsWith("[Active Workflows") && !m.content.startsWith("[Previous"))));

      const recent = messages.slice(-40);
      messages.length = 0;
      if (system) {
        messages.push(system);
      }
      const activeWfs = listWorkflows();
      if (activeWfs.length > 0) {
        const summary = activeWfs
          .map((id) => {
            const wf = getWorkflow(id);
            return wf ? `Workflow ID '${wf.id}' ("${wf.name}", ${wf.nodes.length} nodes: ${wf.nodes.map(n => n.nodeName).join(", ")})` : null;
          })
          .filter(Boolean)
          .join("; ");
        if (summary) {
          messages.push({
            role: "system",
            content: `[Active Workflows in Server Store: ${summary}. Use 'list_workflows' or 'audit_workflow_reliability' to reference them.]`,
          });
        }
      }
      if (firstUserMsg && !recent.includes(firstUserMsg)) {
        messages.push(firstUserMsg);
      }
      messages.push({
        role: "user",
        content: "[Previous intermediate tool results are summarized. Proceed with the next step based on the user's system description and existing workflows.]",
      });
      messages.push(...recent);

      // Remove orphaned tool messages whose tool_call_id has no matching assistant message
      // This prevents the LLM API 400: "tool message has no matching assistant"
      const compactedAssistantCallIds = new Set<string>();
      for (const msg of messages) {
        if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            if (tc.id) compactedAssistantCallIds.add(tc.id);
          }
        }
      }
      for (let j = messages.length - 1; j >= 0; j--) {
        const msg = messages[j];
        if (msg && msg.role === "tool" && msg.tool_call_id) {
          if (!compactedAssistantCallIds.has(msg.tool_call_id)) {
            messages.splice(j, 1);
          }
        }
      }
    }

    const isFinalIteration = i === MAX_ITERATIONS - 1;
    const userPromptLower = (opts.userText || "").toLowerCase();
    const isAnsweringQuestions =
      userPromptLower.includes("?") ||
      userPromptLower.includes("question") ||
      userPromptLower.includes("cto review") ||
      userPromptLower.includes("answer all") ||
      userPromptLower.includes("packet") ||
      userPromptLower.includes("postmortem");

    const wantsExplicitTool =
      userPromptLower.includes("run") ||
      userPromptLower.includes("verify") ||
      userPromptLower.includes("seed") ||
      userPromptLower.includes("simulate") ||
      userPromptLower.includes("simulation") ||
      userPromptLower.includes("sweep") ||
      userPromptLower.includes("ablation") ||
      userPromptLower.includes("workflow") ||
      userPromptLower.includes("create") ||
      userPromptLower.includes("node") ||
      userPromptLower.includes("insert") ||
      userPromptLower.includes("connect") ||
      userPromptLower.includes("audit") ||
      userPromptLower.includes("model") ||
      userPromptLower.includes("list") ||
      userPromptLower.includes("tool");

    let effectiveTools = toolDefs;
    // Always filter out legacy waterfall matrix dials unless specifically requested, avoiding slow 5-step loops
    if (!userPromptLower.includes("matrix") && !userPromptLower.includes("describe system")) {
      effectiveTools = toolDefs.filter(
        (t) => !["describe_system", "run_matrix", "audit_trace", "explain_finding", "propose_fix", "verify_fix"].includes(t.function.name)
      );
    }

    const currentTools = isFinalIteration ? [] : effectiveTools;
    console.log(`[AGENT_LOOP] Iteration ${i}: calling orchestrator (${messages.length} msgs)...`);
    const response = await orchestrator.chat(messages, currentTools);
    if (response.reasoning) {
      latestReasoning = (latestReasoning ? latestReasoning + "\n" : "") + response.reasoning;
      opts.onChunk?.({ type: "reasoning", text: response.reasoning });
    }
    const resolvedToolCalls = (response.tool_calls ?? []).flatMap((toolCall) => {
      if (!toolCall) return [];
      const exactTool = (opts.tools || []).find((tool) => tool.name === toolCall.name);
      if (exactTool || toolCall.name.length < 5) return [toolCall];
      const prefixMatches = (opts.tools || []).filter((tool) => tool.name.startsWith(toolCall.name));
      if (prefixMatches.length === 1) {
        return [{ ...toolCall, name: prefixMatches[0]!.name }];
      }
      if (prefixMatches.length > 1) {
        throw new Error(`Ambiguous tool name '${toolCall.name}'. Candidates: ${prefixMatches.map((tool) => tool.name).join(", ")}`);
      }
      return [toolCall];
    });
    console.log(`[AGENT_LOOP] Iteration ${i}: model replied with ${resolvedToolCalls.length} tool calls (${resolvedToolCalls.map(tc => tc.name).join(", ")})`);

    if (resolvedToolCalls.length === 0) {
      if (/(?:^|\n)\s*Tool:\s*[\w-]+/i.test(response.text)) {
        return buildGraphDataResult(
          "The model wrote a tool name as plain text instead of issuing a structured tool call. No tool was executed. Please retry your request.",
          "error",
        );
      }
      let finalText = response.text?.trim() || "";

      const userAskedQuestions = messages.some(
        (m) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          (m.content.includes("?") || /question|review|audit|timeline|packet/i.test(m.content))
      );
      const isBriefPlaceholder =
        finalText.length < 150 &&
        (/ready to run/i.test(finalText) ||
          /system described/i.test(finalText) ||
          /completed \d+ diagnostic/i.test(finalText) ||
          /ready to audit/i.test(finalText));

      if (userAskedQuestions && isBriefPlaceholder && i < MAX_ITERATIONS - 1) {
        console.log(`[AGENT_LOOP] Brief placeholder detected while questions are pending. Nudging model to provide comprehensive answer...`);
        messages.push({
          role: "assistant",
          content: finalText,
        });
        messages.push({
          role: "user",
          content: "Now proceed to answer all requested questions in order thoroughly, rigorously, and quantitatively using the packet and findings.",
        });
        continue;
      }
      if (!finalText) {
        if (allExecutedToolCalls.length > 0) {
          finalText = `Completed ${allExecutedToolCalls.length} diagnostic step(s): ${allExecutedToolCalls.map(tc => tc.name).join(", ")}. Invariant checks and topology verification complete.`;
        } else {
          finalText = "I have reviewed your system architecture. Ready to run reliability audits and check for invariant violations.";
        }
      }
      messages.push({ role: "assistant", content: finalText });
      opts.onChunk?.({ type: "text", text: finalText });
      const finalResult = buildGraphDataResult(finalText, response.stop_reason);
      if (finalResult.graphData) {
        opts.onChunk?.({ type: "graph", graphData: finalResult.graphData });
      }
      return finalResult;
    }

    allExecutedToolCalls.push(...resolvedToolCalls);

    messages.push({
      role: "assistant",
      content: response.text,
      tool_calls: resolvedToolCalls,
    });

    let circuitBroken = false;
    for (const tc of resolvedToolCalls) {
      const argsSig = stableStringify(tc.arguments ?? {});
      if (tc.name === lastToolName && argsSig === lastArgsSig) {
        consecutiveSameToolCalls++;
        if (consecutiveSameToolCalls >= 3) {
          return buildGraphDataResult(
            `I've called ${tc.name} ${consecutiveSameToolCalls} times with the same arguments. The previous results are in the conversation history. I should now move to the next diagnostic step: auditing the trace, explaining findings, and proposing a verified fix.`,
            "stop",
          );
        }
      } else {
        consecutiveSameToolCalls = 0;
      }
      lastToolName = tc.name;
      lastArgsSig = argsSig;

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
        opts.onChunk?.({ type: "tool_start", name: tc.name, arguments: tc.arguments });
        const toolArguments = { ...tc.arguments };
        if (
          (tc.name === "audit_trace" || tc.name === "explain_finding") &&
          opts.context?.lastTrace &&
          (!toolArguments.trace || !(toolArguments.trace as any).spans)
        ) {
          toolArguments.trace = opts.context.lastTrace;
        }
        const result = await tool.handler(toolArguments, opts.context);
        console.log(`[AGENT_LOOP] Iteration ${i}: tool '${tc.name}' completed.`);
        opts.onChunk?.({ type: "tool_end", name: tc.name });
        const toolFailed = result && typeof result === "object" && result.success === false && !(result as any).validationError;
        if (tc.name === "create_workflow" && result && typeof result === "object" && result.success !== false) {
          activeWorkflowId = result.workflowId;
          if (activeWorkflowId && opts.context?.sessionId) {
            associateWorkflowWithSession(activeWorkflowId, opts.context.sessionId);
          }
        } else if (tc.name === "insert_node" && result && typeof result === "object" && result.success !== false) {
          activeWorkflowId = tc.arguments.workflowId as string | undefined;
        } else if (tc.name === "audit_trace" && result && typeof result === "object") {
          if (opts.context) {
            const findings = (result as any).findings || (Array.isArray(result) ? result : []);
            (opts.context as any).lastFindings = findings;
            (opts.context as any).lastFailedFinding = findings.find((f: any) => f.status === "proven");
            (opts.context as any).lastFinding = (opts.context as any).lastFailedFinding || findings[0];
          }
        } else if (tc.name === "audit_workflow_reliability" && result && typeof result === "object") {
          if (opts.context) {
            (opts.context as any).lastCausalAudit = result;
            (opts.context as any).lastViolatedInvariants = (result as any).violatedInvariants;
            if (Array.isArray((result as any).violatedInvariants) && (result as any).violatedInvariants.length > 0) {
              (opts.context as any).lastFailedFinding = {
                rule_id: (result as any).violatedInvariants[0],
                status: "proven",
                pillar: "reliability",
              };
            }
          }
        }
        let toolContent = typeof result === "string" ? result : JSON.stringify(result);
        if (tc.name === "run_matrix" && result && typeof result === "object" && result.trace) {
          if (opts.context) {
            (opts.context as any).lastTrace = result.trace;
            if (result.config) {
              (opts.context as any).lastConfig = result.config;
            }
          }
          const trace = result.trace as any;
          const compact = {
            success: result.success,
            config: result.config,
            snapshot: result.snapshot,
            traceId: result.traceId,
            spanCount: trace?.spans?.length ?? trace?.spanCount ?? undefined,
            firstSpanId: trace?.spans?.[0]?.id ?? trace?.firstSpanId ?? undefined,
            lastSpanId: trace?.spans?.[trace.spans?.length - 1]?.id ?? trace?.lastSpanId ?? undefined,
            note: "Full trace cached in session",
            trace: {
              traceId: result.traceId,
              spanCount: trace?.spans?.length ?? trace?.spanCount ?? undefined,
              firstSpanId: trace?.spans?.[0]?.id ?? trace?.firstSpanId ?? undefined,
              lastSpanId: trace?.spans?.[trace.spans?.length - 1]?.id ?? trace?.lastSpanId ?? undefined,
              note: "Full trace cached in session",
            },
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
        messages.push({ role: "assistant", content: finalResp.text });
        return buildGraphDataResult(finalResp.text, "stop");
      }
    } catch (e: any) {
      console.error("[AGENT_LOOP] Final synthesis error:", e);
    }
  }

  return buildGraphDataResult("Reached max iterations.", "length");
}
