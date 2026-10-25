import { createOrchestrator } from "../llm/orchestrator.ts";
import { getGlobalRegistry } from "../physics/registry.ts";
import type { PhysicsPrimitive, PhysicsRegistry } from "../physics/registry-types.ts";
import type { MatrixConfig } from "../matrix-copy.ts";
import { buildWorldModel } from "../world-model/adapters.ts";

export interface PhysicsSelection {
  primitiveId: string;
  relevance: number;
  reason: string;
}

export interface SelectorResult {
  selected: PhysicsSelection[];
  totalAvailable: number;
  architecture: string;
}

const SELECTOR_PROMPT = `Select physics primitives relevant to the architecture. Return a JSON array of objects with primitiveId, relevance (0 to 1), and reason. Only use IDs from the available registry.`;

export async function selectPhysics(
  config: MatrixConfig,
  systemDescription?: string,
): Promise<SelectorResult> {
  const registry: PhysicsRegistry = getGlobalRegistry();
  const { actors } = buildWorldModel(config);
  const extendedActors = actorsForDescription(actors, systemDescription);
  const allPrimitives = registry.list();
  const applicable = registry.findApplicable({ actors: extendedActors });
  const architecture = extendedActors.map((actor) => `${actor.name} (${actor.kind})`).join(", ");

  let selected = ruleBasedSelection(applicable, extendedActors);
  try {
    const response = await createOrchestrator().chat([
      { role: "system", content: SELECTOR_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          actors: extendedActors,
          systemDescription,
          availablePrimitives: allPrimitives.map(({ id, category, description }) => ({ id, category, description })),
        }),
      },
    ], []);
    const parsed = response.tool_calls[0]?.arguments.selections ?? parseSelectionText(response.text);
    const applicableIds = new Set(applicable.map((primitive) => primitive.id));
    if (Array.isArray(parsed)) {
      const validated = parsed.flatMap((item): PhysicsSelection[] => {
        if (!item || typeof item !== "object") return [];
        const candidate = item as Record<string, unknown>;
        if (typeof candidate.primitiveId !== "string" || !applicableIds.has(candidate.primitiveId)) return [];
        const relevance = Number(candidate.relevance);
        if (!Number.isFinite(relevance)) return [];
        return [{
          primitiveId: candidate.primitiveId,
          relevance: Math.max(0, Math.min(1, relevance)),
          reason: typeof candidate.reason === "string" ? candidate.reason : "Selected as applicable to this architecture.",
        }];
      });
      if (validated.length > 0 || applicable.length === 0) selected = validated;
    }
  } catch {
    // Rule-based selection keeps the workflow usable without an LLM endpoint.
  }

  selected.sort((left, right) => right.relevance - left.relevance || left.primitiveId.localeCompare(right.primitiveId));
  return { selected, totalAvailable: allPrimitives.length, architecture };
}

function parseSelectionText(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return JSON.parse(fenced ?? text);
}

function ruleBasedSelection(
  primitives: PhysicsPrimitive[],
  actors: Array<{ kind: string; name: string }>,
): PhysicsSelection[] {
  const kinds = new Set(actors.map((actor) => actor.kind));
  const weights: Record<string, { relevance: number; reason: string }> = {
    "payment.idempotency": { relevance: 0.95, reason: "Payment side effects can be retried after an ambiguous response." },
    "transaction.partial_commit": { relevance: 0.9, reason: "An external side effect may commit even when its acknowledgment is lost." },
    "consistency.eventual": { relevance: 0.85, reason: "Distributed database reads may be stale during replication lag." },
    "queue.duplicate_delivery": { relevance: 0.88, reason: "At-least-once delivery can repeat processing." },
    "worker.state_loss": { relevance: 0.82, reason: "Worker restart can lose volatile state and replay side effects." },
    "tool.partial_success": { relevance: 0.75, reason: "A tool batch can partially succeed and leave uncertain state." },
    "db.hold_and_write_amp": { relevance: 0.7, reason: "Database connection pressure and write amplification affect reliability." },
    "process.isolation": { relevance: 0.65, reason: "Process isolation determines crash containment." },
    "llm.context": { relevance: 0.6, reason: "Context growth can degrade model behavior." },
    "storage.write": { relevance: 0.55, reason: "Storage write patterns affect durability and recovery." },
  };
  const kindByPrimitive: Record<string, string[]> = {
    "payment.idempotency": ["payment_service"],
    "transaction.partial_commit": ["payment_service", "external_api"],
    "consistency.eventual": ["database"],
    "queue.duplicate_delivery": ["queue"],
    "worker.state_loss": ["worker", "agent"],
    "tool.partial_success": ["tool_gateway", "external_api"],
    "db.hold_and_write_amp": ["database"],
    "process.isolation": ["process_supervisor"],
    "llm.context": ["llm"],
    "storage.write": ["storage"],
  };
  return primitives.flatMap((primitive) => {
    const weight = weights[primitive.id];
    if (!weight || !(kindByPrimitive[primitive.id] ?? []).some((kind) => kinds.has(kind))) return [];
    return [{ primitiveId: primitive.id, ...weight }];
  });
}

function actorsForDescription(
  actors: Array<{ kind: string; name: string; contract?: { guarantees: string[] } }>,
  description?: string,
): Array<{ kind: string; name: string; contract?: { guarantees: string[] } }> {
  if (!description) return actors;
  const text = description.toLowerCase();
  const aliases: Record<string, string[]> = {
    agent: ["agent", "assistant"],
    database: ["database", "postgres", "postgresql", "mysql", "clickhouse", "replication", "eventual consistency", "data store"],
    payment_service: ["payment", "stripe", "charge", "billing"],
    process_supervisor: ["supervisor", "process isolation"],
    tool_gateway: ["tool", "mcp", "batch"],
    llm: ["llm", "language model", "model context"],
    storage: ["storage", "checkpoint", "durable state"],
  };
  const describedKinds = new Set(
    Object.entries(aliases)
      .filter(([, terms]) => terms.some((term) => text.includes(term)))
      .map(([kind]) => kind),
  );
  const inferred: Array<{ kind: string; name: string; contract?: { guarantees: string[] } }> = [];
  const add = (kind: string, name: string, terms: string[]) => {
    if (terms.some((term) => text.includes(term)) && !actors.some((actor) => actor.kind === kind)) inferred.push({ kind, name });
  };
  add("queue", "Message Queue", ["queue", "kafka", "sqs", "pub/sub", "at-least-once", "message system", "messaging", "asynchronous message"]);
  add("worker", "Worker", ["worker", "background job", "job runner"]);
  add("external_api", "External API", ["external api", "third-party api", "third party api"]);
  add("database", "Distributed Database", ["distributed database", "distributed data store", "eventual consistency", "replication lag", "replicated database"]);
  const inferredKinds = new Set(inferred.map((actor) => actor.kind));
  const describedActors = actors
    .filter((actor) => describedKinds.has(actor.kind) || inferredKinds.has(actor.kind))
    .map((actor) => ({ ...actor }));

  if (["distributed database", "distributed data store", "eventual consistency", "replication lag", "replicated database"].some((term) => text.includes(term))) {
    const dbActor = describedActors.find((actor) => actor.kind === "database") ?? inferred.find((actor) => actor.kind === "database");
    if (dbActor) {
      dbActor.name = "Distributed Database";
      dbActor.contract = {
        actorKind: "database",
        guarantees: ["Eventual consistency across replicas"],
        possibleBehaviors: dbActor.contract?.possibleBehaviors ?? [],
        failureModes: dbActor.contract?.failureModes ?? [],
      };
    } else {
      inferred.push({
        kind: "database",
        name: "Distributed Database",
        contract: {
          actorKind: "database",
          guarantees: ["Eventual consistency across replicas"],
          possibleBehaviors: [],
          failureModes: [],
        },
      });
    }
  }

  return [...describedActors, ...inferred.filter((actor) => !describedActors.some((existing) => existing.kind === actor.kind))];
}


