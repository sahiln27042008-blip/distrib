import { MockPgPool } from "./chaos.ts";

export type AgentMode = "naive" | "resilient";
export const COST_PER_TOKEN = 0.00003;

export interface AgentLabConfig {
  mode: AgentMode;
  seed: number;
  promptSizeCap?: number;
  toolOutputLimit?: number;
  maxExecutionSteps?: number;
}

export interface ToolDefinition {
  id: number;
  name: string;
  category: string;
  requiredPermission: string;
  relevanceKeywords: string[];
}

export interface PromptSection {
  name: string;
  text: string;
  chars: number;
  tokenEstimate: number;
}

export interface AgentTurnSnapshot {
  turn: number;
  query: string;
  response: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cumulativeTokens: number;
  visibleToolCount: number;
  usedToolCount: number;
  historyTokens: number;
  factTokens: number;
  toolOutputTokens: number;
  valueToNoiseRatio: number;
  hallucinationCount: number;
  dbHoldDurationMs: number;
  promptLength: number;
  responseLength: number;
  selectedToolIds: number[];
  deniedCalls: number;
  successfulCalls: number;
  toolOutputBytes: number;
  promptSections: PromptSection[];
}

export interface AgentTotalsSnapshot {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalDbHoldMs: number;
  maxDbHoldMs: number;
  simulatedHallucinations: number;
  estimatedCost: number;
  toolCalls: number;
  denials: number;
  successes: number;
  candidateTools: number;
}

export type AgentTurnList = AgentTurnSnapshot[] & { [index: number]: AgentTurnSnapshot };

export interface AgentContextSnapshot {
  virtualTimeMs: number;
  mode: AgentMode;
  seed: number;
  turns: AgentTurnList;
  totals: AgentTotalsSnapshot;
  executionSteps: number;
  runtimeStateId: string;
  poolMetrics: {
    activeConnections: number;
    totalDbHoldMs: number;
    peakActiveConnections: number;
    queueDepth: number;
  };
}

export interface AgentComparisonResult {
  naive: AgentContextSnapshot;
  resilient: AgentContextSnapshot;
  comparison: {
    seed: number;
    naiveTotalTokens: number;
    resilientTotalTokens: number;
    naiveDbHoldMs: number;
    resilientDbHoldMs: number;
    deltaTokens: number;
    deltaDbHoldMs: number;
    summary: string;
  };
}

interface Lease {
  token: string;
  requestedAt: number;
  acquiredAt?: number;
  active: boolean;
  turn: number;
  label: string;
}

const DEFAULT_PROMPT_SIZE_CAP = 48_000;
const DEFAULT_TOOL_OUTPUT_LIMIT = 8_192;
const DEFAULT_MAX_EXECUTION_STEPS = 2_000;
const QUERY_SEQUENCE = [
  "Customer reports an enterprise product issue: the account sync fails and the order update never reaches the service layer.",
  "Please verify the customer record, active contract, and recent product incidents before making any changes.",
  "Inspect the order history and any billing or shipping anomalies for the customer so the root cause is clear.",
  "Review the account status and relevant records to confirm whether the issue is caused by stale entitlement data or a failed sync.",
  "Diagnose the underlying problem from the record set and explain the exact failure mode before remediating.",
  "Recommend the least-risk authorized fix and explain why it is safe for this enterprise deployment.",
  "Apply the approved fix and record the attempted resolution for audit and customer reference.",
  "Verify the result by checking the order state and customer-facing status after the remediation step.",
  "The customer has confirmed the issue is resolved; capture the confirmation and prepare the closure summary.",
  "Summarize the verified outcome, list the final fix, and close the case with proof of successful resolution.",
] as const;

const FACT_SCHEMA = [
  "customerId",
  "product",
  "issueType",
  "orderId",
  "investigationResult",
  "attemptedResolution",
  "finalResolution",
  "customerConfirmed",
  "caseStatus",
] as const;

const ROLE_PERMISSIONS: Record<string, string[]> = {
  customer_support_agent: ["customer:read", "billing:read", "shipping:read", "support:read", "reporting:read", "auth:read"],
  billing_admin: ["billing:read", "billing:write", "admin:read", "admin:write"],
  shipping_ops: ["shipping:read", "shipping:write", "support:read"],
  auth_admin: ["auth:read", "auth:write", "admin:read"],
  analytics_admin: ["reporting:read", "reporting:write", "support:read"],
  support_manager: ["customer:read", "billing:read", "shipping:read", "support:read", "admin:read"],
  "billing-admin": ["billing:read", "billing:write", "admin:read", "admin:write"],
};

const TOOL_CATEGORIES = ["CRM", "Billing", "Shipping", "Authentication", "Reporting", "Admin", "Support", "Product", "Security", "Operations"] as const;

const TOOL_NAMES: Record<string, string[]> = {
  CRM: [
    "account_lookup", "contact_lookup", "contract_review", "ticket_history", "case_summary", "customer_profile",
    "subscription_review", "entitlement_check", "account_audit", "relationship_map", "account_reconciliation",
    "customer_health", "account_merge", "account_history", "customer_issue", "contact_sync", "service_contract",
    "renewal_lookup", "contract_audit", "customer_notes",
  ],
  Billing: [
    "invoice_lookup", "payment_status", "credit_memo", "refund_policy", "chargeback_check", "renewal_status",
    "billing_summary", "discount_review", "line_item_mismatch", "payment_retry_queue", "invoice_audit",
    "payment_history", "recurring_charge", "credit_review", "statement_lookup", "cost_center", "billing_exception",
    "payment_hold", "adjustment_log", "charge_validation",
  ],
  Shipping: [
    "tracking_status", "shipping_label", "carrier_status", "warehouse_scan", "return_label", "customs_check",
    "shipment_history", "fleet_status", "delivery_window", "inventory_audit", "carrier_exception", "logistics_status",
    "route_lookup", "package_scan", "warehouse_hold", "freight_reconciliation", "shipment_trace", "order_courier",
    "delivery_retry", "dispatch_history",
  ],
  Authentication: [
    "mfa_status", "session_reset", "token_revoke", "sso_status", "lockout_check", "device_trust", "tenant_policy",
    "access_review", "credential_audit", "auth_history", "group_sync", "identity_review", "user_policy",
    "access_matrix", "session_history", "device_check", "risk_policy", "login_audit", "tenant_access",
    "credential_merge",
  ],
  Reporting: [
    "incident_report", "sla_report", "trend_dashboard", "exec_summary", "customer_health", "alert_summary",
    "performance_report", "usage_snapshot", "case_rollup", "recovery_review", "uptime_summary", "error_snapshot",
    "customer_impact", "support_velocity", "service_metrics", "region_summary", "outage_map", "kpi_dashboard",
    "incident_history", "health_score",
  ],
  Admin: [
    "feature_flag", "escalation_queue", "maintenance_window", "change_approval", "tenant_config", "role_matrix",
    "policy_patch", "admin_audit", "site_config", "batch_scheduler", "tenant_override", "admin_policy",
    "feature_toggle", "batch_approval", "release_gate", "config_snapshot", "access_policy", "worker_sync",
    "service_group", "environment_lock",
  ],
  Support: [
    "issue_triage", "workaround_lookup", "kb_search", "knowledge_base", "ticket_reopen", "service_health",
    "advisor_note", "patch_status", "customer_update", "resolution_log", "issue_replay", "incident_triage",
    "support_routing", "case_followup", "agent_note", "chat_history", "support_summary", "resolution_check",
    "customer_ack", "escalation_note",
  ],
  Product: [
    "release_notes", "deployment_status", "feature_release", "config_snapshot", "service_catalog", "component_status",
    "integration_status", "product_health", "deployment_history", "update_queue", "component_health", "release_sequence",
    "feature_gate", "compatibility_check", "integration_map", "product_metric", "deployment_audit", "service_state",
    "tier_status", "product_notes",
  ],
  Security: [
    "risk_scan", "policy_violation", "threat_feed", "security_alert", "audit_log", "endpoint_check",
    "identity_review", "correlation_search", "forensics_summary", "incident_timeline", "vulnerability_scan",
    "credential_scan", "network_signal", "system_alert", "security_note", "risk_matrix", "threat_history",
    "device_signal", "privilege_check", "security_audit",
  ],
  Operations: [
    "runbook_lookup", "ops_dashboard", "site_check", "alert_queue", "change_log", "incident_trace", "service_matrix",
    "inventory_snapshot", "fault_map", "capacity_check", "ops_summary", "site_monitor", "alert_handling",
    "deployment_queue", "resource_map", "runbook_check", "maintenance_log", "incident_route", "site_health",
    "fault_review",
  ],
} as const;

const PERMISSION_BY_CATEGORY: Record<string, string> = {
  CRM: "customer:read",
  Billing: "billing:read",
  Shipping: "shipping:read",
  Authentication: "auth:read",
  Reporting: "reporting:read",
  Admin: "admin:read",
  Support: "support:read",
  Product: "support:read",
  Security: "admin:read",
  Operations: "support:read",
};

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 4));
}

function clampText(value: string, cap: number): string {
  if (cap <= 0) return "";
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= cap) return value;
  let end = value.length;
  while (end > 0) {
    const candidate = value.slice(0, end);
    if (Buffer.byteLength(candidate, "utf8") <= cap) return candidate;
    end -= 1;
  }
  return "";
}

function buildToolRegistry(): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  let id = 1;
  for (const category of TOOL_CATEGORIES) {
    const nameSet = TOOL_NAMES[category as keyof typeof TOOL_NAMES] ?? [];
    for (const name of nameSet) {
      const keywords = [
        category.toLowerCase(),
        name.replace(/_/g, " "),
        ...name.split("_"),
        ...(category === "Billing" ? ["invoice", "payment", "billing", "refund", "charge", "overdue"] : []),
        ...(category === "CRM" ? ["customer", "account", "contract", "entitlement", "ticket"] : []),
        ...(category === "Shipping" ? ["shipment", "delivery", "shipping", "order", "carrier"] : []),
        ...(category === "Authentication" ? ["login", "auth", "mfa", "session", "security"] : []),
        ...(category === "Reporting" ? ["report", "dashboard", "summary", "metrics"] : []),
      ].filter((value) => value && value.length > 0);
      const permission = PERMISSION_BY_CATEGORY[category as keyof typeof PERMISSION_BY_CATEGORY] ?? "support:read";
      tools.push({
        id,
        name: `${category.toLowerCase()}_${name}`,
        category,
        requiredPermission: permission,
        relevanceKeywords: keywords,
      });
      id += 1;
    }
  }
  return tools;
}

function makeLargeNarrative(seed: number, turn: number, query: string): string {
  const repeated = [
    `Turn ${turn}: ${query}`,
    `Seed ${seed} produced a deterministic support trace with a verified contract review, stable billing state, and a matching account audit.`,
    "The enterprise issue is isolated to an expired entitlement cache, a stale order status, and a failed downstream sync. The root cause remains consistent across every check.",
    "Support reviewed the customer record, contract, payment timeline, shipping state, and the product incident history to confirm the same issue signature before remediation.",
    "The remediation path is safe because the workflow only reads the service state, confirms the contract, and applies a bounded state reset with explicit validation after every step.",
    "This issue was caused by a stale entitlement cache and failed synchronization, not by a payment or shipping failure. The record set and the incident timeline agree on that diagnosis.",
    "The final verification checks the customer status, order state, and service-state output before closing the case. The evidence remains deterministic across runs for this seed.",
    "This is a synthetic enterprise support scenario created for deterministic benchmarking and agent-context comparison. The data is intentionally stable and repeatable across runs.",
  ];
  const fragments: string[] = [];
  for (let index = 0; index < 12; index++) {
    fragments.push(repeated.join(" "));
  }
  return fragments.join("\n");
}

export class MockLLM {
  readonly mode: AgentMode;
  readonly seed: number;

  constructor(mode: AgentMode, seed: number) {
    this.mode = mode;
    this.seed = seed;
  }

  respond(prompt: string, tools: ToolDefinition[], turn: number, scenarioState: Record<string, unknown>): {
    response: string;
    toolCalls: Array<{ toolId: number; name: string; permission: string; args: Record<string, string> }>;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    hallucinationCount: number;
  } {
    const responseBase = makeLargeNarrative(this.seed, turn, String(scenarioState.query ?? "support issue"));
    const response = this.mode === "naive"
      ? responseBase
      : `I reviewed the support state and resolved the issue with the approved workflow. Evidence: ${String(scenarioState.workflowStep ?? "customer support")}.`;

    const toolCalls = tools.slice(0, this.mode === "naive" ? Math.min(tools.length, 18) : Math.min(tools.length, 5)).map((tool, index) => ({
      toolId: tool.id,
      name: tool.name,
      permission: tool.requiredPermission,
      args: {
        query: String(scenarioState.query ?? "customer support issue"),
        turn: String(turn),
        index: String(index),
        mode: this.mode,
      },
    }));

    const hallucinationCount = this.mode === "naive" && ((this.seed + turn * 7) % 5 === 0 || (this.seed + turn * 11) % 5 === 2) ? 1 : 0;
    const inputTokens = estimateTokens(prompt);
    const outputTokens = estimateTokens(response);
    return { response, toolCalls, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, hallucinationCount };
  }
}

export class AgentContextScenario {
  readonly cfg: Required<Pick<AgentLabConfig, "mode" | "seed" | "promptSizeCap" | "toolOutputLimit" | "maxExecutionSteps">>;
  readonly toolRegistry: ToolDefinition[];
  readonly pool: MockPgPool;
  readonly sim: {
    now: number;
    log: Array<{ id: string; at: number; kind: string; data: Record<string, unknown> }>;
    services: Map<string, string>;
    links: Set<string>;
    pending: () => number;
    step: () => boolean;
    advanceTo: (value: number) => void;
  };
  readonly mode: AgentMode;
  readonly seed: number;
  life: "idle" | "running" | "finished" | "stopped" = "idle";

  get poolMetrics() {
    return {
      activeConnections: this.pool.activeConnections,
      totalDbHoldMs: this.pool.totalHoldMs,
      peakActiveConnections: this.pool.peakActiveConnections,
      queueDepth: this.pool.waiting.length,
    };
  }

  private readonly transcript: string[] = [];
  private readonly facts = new Map<string, string>();
  private currentToolOutput = "";
  private executionSteps = 0;
  private virtualNow = 0;
  private nextLeaseId = 0;
  private state: Record<string, unknown> = {
    workflowStep: "customer_issue_reported",
    customerId: "CUST-1029",
    product: "enterprise-ops",
  };

  constructor(config: Partial<AgentLabConfig> = {}) {
    const seed = typeof config.seed === "number" && Number.isInteger(config.seed) ? config.seed : 7;
    this.mode = config.mode ?? "resilient";
    this.seed = seed;
    this.cfg = {
      mode: this.mode,
      seed: this.seed,
      promptSizeCap: config.promptSizeCap ?? DEFAULT_PROMPT_SIZE_CAP,
      toolOutputLimit: config.toolOutputLimit ?? DEFAULT_TOOL_OUTPUT_LIMIT,
      maxExecutionSteps: config.maxExecutionSteps ?? DEFAULT_MAX_EXECUTION_STEPS,
    };
    this.toolRegistry = buildToolRegistry();
    this.pool = new MockPgPool(2, 8);
    this.sim = {
      now: 0,
      log: [],
      services: new Map<string, string>(),
      links: new Set<string>(),
      pending: () => 0,
      step: () => false,
      advanceTo: (value: number) => {
        this.virtualNow = value;
      },
    };
    this.state = { workflowStep: "customer_issue_reported", customerId: "CUST-1029", product: "enterprise-ops", mode: this.mode, seed: this.seed };
    this.ensureFacts();
  }

  private ensureFacts(): void {
    const defaults: Record<string, string> = {
      customerId: `CUST-${(this.seed % 9000) + 1000}`,
      product: "enterprise-ops",
      issueType: "order-sync",
      orderId: `ORD-${(this.seed % 9000) + 2000}`,
      investigationResult: "stale entitlement cache",
      attemptedResolution: "entitlement sync and state reset",
      finalResolution: "case resolved after verified remediation",
      customerConfirmed: "pending",
      caseStatus: "investigating",
    };
    for (const [key, value] of Object.entries(defaults)) {
      this.facts.set(key, value);
    }
  }

  private factsText(): string {
    const record: Record<string, string> = {};
    for (const key of FACT_SCHEMA) {
      const value = this.facts.get(key);
      if (value !== undefined) record[key] = value;
    }
    return `Structured facts:\n${JSON.stringify(record, null, 2)}`;
  }

  private promptForTurn(turn: number, query: string, selectedTools: ToolDefinition[]): string {
    const systemText = "You are a deterministic enterprise support agent. Use the available tool inventory conservatively, never invent unsupported facts, verify the root cause before a write, and close the case only after evidence is consistent.";
    const toolText = selectedTools.map((tool) => `${tool.name} [${tool.category}] requires ${tool.requiredPermission}`).join("\n");
    const historyText = this.mode === "naive"
      ? (this.transcript.slice(-4).join("\n---\n") || "No prior transcript.")
      : this.factsText();
    const workflowState = JSON.stringify({
      workflowStep: this.state.workflowStep,
      customerId: this.facts.get("customerId") ?? "CUST-1029",
      product: this.facts.get("product") ?? "enterprise-ops",
      issueType: this.facts.get("issueType") ?? "order-sync",
      orderId: this.facts.get("orderId") ?? "ORD-7042",
      turn,
      mode: this.mode,
      seed: this.seed,
    }, null, 2);
    const sections = [systemText, toolText, historyText, this.currentToolOutput || "No tool output yet.", query, workflowState];
    const prompt = sections.join("\n\n");
    return clampText(prompt, this.cfg.promptSizeCap);
  }

  rankTools(query: string, limit: number): Array<{ id: number; name: string; category: string }> {
    const normalized = query.toLowerCase();
    const ranked = [...this.toolRegistry]
      .map((tool) => {
        let score = 0;
        for (const keyword of tool.relevanceKeywords) {
          if (normalized.includes(keyword.toLowerCase())) score += 2;
        }
        if (normalized.includes(tool.category.toLowerCase())) score += 1;
        return { tool, score };
      })
      .sort((left, right) => right.score - left.score || left.tool.id - right.tool.id)
      .slice(0, Math.max(0, limit))
      .map((entry) => ({ id: entry.tool.id, name: entry.tool.name, category: entry.tool.category }))
      .sort((left, right) => left.id - right.id);
    return ranked;
  }

  authorizeToolCall(actor: string, toolId: string | number, permission: string): boolean {
    const normalizedActor = actor.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const actorPermissions = ROLE_PERMISSIONS[normalizedActor] ?? [];
    if (actorPermissions.length === 0) return false;
    if (!actorPermissions.includes(permission)) return false;

    if (typeof toolId === "number") {
      const tool = this.toolRegistry.find((candidate) => candidate.id === toolId);
      return tool !== undefined && tool.requiredPermission === permission;
    }

    const tool = this.toolRegistry.find((candidate) => candidate.name === toolId || candidate.id.toString() === toolId);
    if (!tool) return false;
    return tool.requiredPermission === permission;
  }

  beginLease(turn: number, label: string): Lease {
    const lease: Lease = {
      token: `lease-${this.seed}-${turn}-${label}-${this.nextLeaseId++}`,
      requestedAt: this.virtualNow,
      active: false,
      turn,
      label,
    };
    const status = this.pool.acquire(lease as never);
    if (status === "acquired") {
      lease.active = true;
      lease.acquiredAt = this.virtualNow;
    }
    return lease;
  }

  forceLeaseError(lease: Lease): void {
    if (lease.active) {
      this.pool.release(lease as never, this.virtualNow + 1);
      lease.active = false;
    }
  }

  reset(): void {
    this.life = "idle";
    this.executionSteps = 0;
    this.virtualNow = 0;
    this.nextLeaseId = 0;
    this.currentToolOutput = "";
    this.transcript.length = 0;
    this.facts.clear();
    this.ensureFacts();
    this.state = { workflowStep: "customer_issue_reported", customerId: "CUST-1029", product: "enterprise-ops", mode: this.mode, seed: this.seed };
    this.pool.activeConnections = 0;
    this.pool.peakActiveConnections = 0;
    this.pool.waiting.length = 0;
    this.pool.totalHoldMs = 0;
    this.pool.active.clear();
  }

  start(): void {
    if (this.life === "running") return;
    this.life = "running";
  }

  step(): boolean {
    if (this.life !== "running") return false;
    const snapshot = this.run();
    return snapshot.turns.length > 0 && this.life === "running";
  }

  advance(ms: number): void {
    this.virtualNow += ms;
  }

  dispose(): void {
    this.transcript.length = 0;
    this.currentToolOutput = "";
    this.life = "idle";
  }

  run(): AgentContextSnapshot {
    this.life = "running";
    const turns: AgentTurnSnapshot[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokenCount = 0;
    let totalDbHoldMs = 0;
    let maxDbHoldMs = 0;
    let totalHallucinations = 0;
    let totalToolCalls = 0;
    let totalDenials = 0;
    let totalSuccesses = 0;
    let finalVirtualTime = 0;

    for (let turn = 1; turn <= 10; turn++) {
      if (this.executionSteps >= this.cfg.maxExecutionSteps) break;

      const query = QUERY_SEQUENCE[turn - 1] ?? QUERY_SEQUENCE[0]!;
      const holdMs = this.mode === "naive" ? 2_800 : 2;
      const lease = this.beginLease(turn, this.mode === "naive" ? "model-stream" : "fact-read");
      this.virtualNow += holdMs;

      const selectedTools = this.mode === "naive"
        ? this.toolRegistry.slice(0, Math.min(20, this.toolRegistry.length))
        : this.toolRegistry.filter((tool) => this.authorizeToolCall("customer_support_agent", tool.id, tool.requiredPermission)).slice(0, 5);

      const prompt = this.promptForTurn(turn, query, selectedTools);
      const llm = new MockLLM(this.mode, this.seed);
      const llmOut = llm.respond(prompt, selectedTools, turn, {
        query,
        workflowStep: this.state.workflowStep,
        customerId: this.facts.get("customerId") ?? "CUST-1029",
        product: this.facts.get("product") ?? "enterprise-ops",
      });

      const toolOutputSections: string[] = [];
      let denied = 0;
      let successful = 0;
      for (const tool of selectedTools) {
        const allowed = this.authorizeToolCall("customer_support_agent", tool.id, tool.requiredPermission);
        if (allowed) {
          toolOutputSections.push(`${tool.name} succeeded: the evidence in ${tool.category.toLowerCase()} matched the issue and the tool output was validated.`);
          successful += 1;
        } else {
          toolOutputSections.push(`${tool.name} denied: ${tool.requiredPermission} is not authorized for this workflow.`);
          denied += 1;
        }
      }
      const toolOutputText = clampText(toolOutputSections.join("\n"), this.cfg.toolOutputLimit);
      this.currentToolOutput = toolOutputText;
      if (lease.active) {
        this.pool.release(lease as never, this.virtualNow);
        lease.active = false;
      }

      const responseText = llmOut.response;
      const inputTokens = estimateTokens(prompt);
      const outputTokens = estimateTokens(responseText);
      const totalTokens = inputTokens + outputTokens;

      this.transcript.push(`Turn ${turn}: ${query}\nResponse: ${responseText}\nTool output: ${toolOutputText}`);
      if (this.transcript.length > 8) this.transcript.splice(0, this.transcript.length - 8);
      this.facts.set("customerId", `CUST-${(this.seed % 9000) + 1000}`);
      this.facts.set("product", "enterprise-ops");
      this.facts.set("issueType", turn <= 3 ? "order-sync" : turn <= 6 ? "entitlement-stale" : "resolution-verified");
      this.facts.set("orderId", `ORD-${(this.seed % 9000) + 2000}`);
      this.facts.set("investigationResult", turn < 5 ? "stale entitlement cache" : "root cause confirmed and fixed");
      this.facts.set("attemptedResolution", turn < 7 ? "entitlement sync and cache reset" : "approved remediation applied and validated");
      this.facts.set("finalResolution", turn === 10 ? "case resolved and customer notified" : "resolution pending verification");
      this.facts.set("customerConfirmed", turn < 9 ? "pending" : "confirmed");
      this.facts.set("caseStatus", turn < 5 ? "investigating" : turn < 8 ? "remediating" : turn < 10 ? "verified" : "closed");
      this.state.workflowStep = turn < 5 ? "collecting_evidence" : turn < 8 ? "diagnosing" : turn < 10 ? "remediating" : "closing_case";

      const historyTokens = this.mode === "naive" ? estimateTokens(this.transcript.join("\n---\n")) : 0;
      const factTokens = this.mode === "resilient" ? estimateTokens(this.factsText()) : 0;
      const cumulativeTokens = totalTokenCount + totalTokens;
      const valueToNoiseRatio = Number((Math.max(1, this.mode === "naive" ? historyTokens : factTokens) / Math.max(1, inputTokens)).toFixed(4));
      const turnSnapshot: AgentTurnSnapshot = {
        turn,
        query,
        response: responseText,
        inputTokens,
        outputTokens,
        totalTokens,
        cumulativeTokens,
        visibleToolCount: selectedTools.length,
        usedToolCount: successful,
        historyTokens,
        factTokens,
        toolOutputTokens: estimateTokens(toolOutputText),
        valueToNoiseRatio,
        hallucinationCount: llmOut.hallucinationCount,
        dbHoldDurationMs: holdMs,
        promptLength: prompt.length,
        responseLength: responseText.length,
        selectedToolIds: selectedTools.map((tool) => tool.id),
        deniedCalls: denied,
        successfulCalls: successful,
        toolOutputBytes: Buffer.byteLength(toolOutputText, "utf8"),
        promptSections: [
          { name: "system", text: "system instructions", chars: Math.max(prompt.split("\n\n")[0]?.length ?? 0, 0), tokenEstimate: estimateTokens(prompt.split("\n\n")[0] ?? "") },
          { name: "tools", text: selectedTools.map((tool) => tool.name).join(", "), chars: Math.max(prompt.split("\n\n")[1]?.length ?? 0, 0), tokenEstimate: estimateTokens(prompt.split("\n\n")[1] ?? "") },
          { name: "context", text: this.mode === "naive" ? "transcript" : "structured facts", chars: Math.max(prompt.split("\n\n")[2]?.length ?? 0, 0), tokenEstimate: estimateTokens(prompt.split("\n\n")[2] ?? "") },
          { name: "tool_outputs", text: toolOutputText, chars: toolOutputText.length, tokenEstimate: estimateTokens(toolOutputText) },
          { name: "query", text: query, chars: query.length, tokenEstimate: estimateTokens(query) },
          { name: "state", text: JSON.stringify(this.state), chars: JSON.stringify(this.state).length, tokenEstimate: estimateTokens(JSON.stringify(this.state)) },
        ],
      };

      turns.push(turnSnapshot);
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalTokenCount += totalTokens;
      totalDbHoldMs += holdMs;
      maxDbHoldMs = Math.max(maxDbHoldMs, holdMs);
      totalHallucinations += llmOut.hallucinationCount;
      totalToolCalls += llmOut.toolCalls.length;
      totalDenials += denied;
      totalSuccesses += successful;
      finalVirtualTime = this.virtualNow;
      this.executionSteps += 1;
    }

    this.life = "finished";
    const snapshot: AgentContextSnapshot = {
      virtualTimeMs: finalVirtualTime,
      mode: this.mode,
      seed: this.seed,
      turns,
      totals: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalTokenCount,
        totalDbHoldMs,
        maxDbHoldMs,
        simulatedHallucinations: totalHallucinations,
        estimatedCost: Number((totalTokenCount * COST_PER_TOKEN).toFixed(6)),
        toolCalls: totalToolCalls,
        denials: totalDenials,
        successes: totalSuccesses,
        candidateTools: this.toolRegistry.length,
      },
      executionSteps: this.executionSteps,
      runtimeStateId: `agent-lab-${this.mode}-${this.seed}-${this.toolRegistry.length}-${turns.length}`,
      poolMetrics: {
        activeConnections: this.pool.activeConnections,
        totalDbHoldMs: this.pool.totalHoldMs,
        peakActiveConnections: this.pool.peakActiveConnections,
        queueDepth: this.pool.waiting.length,
      },
    };
    return snapshot;
  }
}

export function runAgentComparison(seed: number): AgentComparisonResult {
  const naive = new AgentContextScenario({ mode: "naive", seed });
  const resilient = new AgentContextScenario({ mode: "resilient", seed });
  const naiveSnap = naive.run();
  const resilientSnap = resilient.run();
  const comparison = {
    seed,
    naiveTotalTokens: naiveSnap.totals.totalTokens,
    resilientTotalTokens: resilientSnap.totals.totalTokens,
    naiveDbHoldMs: naiveSnap.totals.totalDbHoldMs,
    resilientDbHoldMs: resilientSnap.totals.totalDbHoldMs,
    deltaTokens: naiveSnap.totals.totalTokens - resilientSnap.totals.totalTokens,
    deltaDbHoldMs: naiveSnap.totals.totalDbHoldMs - resilientSnap.totals.totalDbHoldMs,
    summary: `naive consumed ${naiveSnap.totals.totalTokens} tokens with ${naiveSnap.totals.totalDbHoldMs} ms DB hold versus resilient ${resilientSnap.totals.totalTokens} tokens and ${resilientSnap.totals.totalDbHoldMs} ms.`,
  };
  return { naive: naiveSnap, resilient: resilientSnap, comparison };
}
