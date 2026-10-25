import type { MatrixConfig } from "../matrix-copy.ts";
import { getGlobalRegistry } from "../physics/registry.ts";
import type { PhysicsRegistry } from "../physics/registry-types.ts";
import { buildWorldModel } from "../world-model/adapters.ts";
import type { PhysicsSelection } from "./physics-selector.ts";

export interface MissingMechanism {
  description: string;
  reason: string;
  evidence: string[];
}

export interface GapDetectionResult {
  hasGap: boolean;
  missingMechanisms: MissingMechanism[];
  availableCategories: string[];
}

export function detectPhysicsGaps(
  config: MatrixConfig,
  selections: PhysicsSelection[],
  systemDescription?: string,
): GapDetectionResult {
  const registry: PhysicsRegistry = getGlobalRegistry();
  const { actors } = buildWorldModel(config);
  const availableCategories = [...new Set(registry.list().map((primitive) => primitive.category))].sort();
  const selectedIds = new Set(selections.map((selection) => selection.primitiveId));
  const text = systemDescription?.toLowerCase() ?? "";
  const missingMechanisms: MissingMechanism[] = [];

  const hasDatabase = actors.some((actor) => actor.kind === "database");
  const asksForDistributedConsistency = ["distributed", "clickhouse", "eventual consistency", "replication"].some((term) => text.includes(term));
  if (hasDatabase && asksForDistributedConsistency && !selectedIds.has("consistency.eventual")) {
    missingMechanisms.push({
      description: "Distributed database eventual consistency semantics",
      reason: "The architecture describes replication or eventual consistency, but the corresponding consistency primitive was not selected.",
      evidence: [`Architecture description: ${systemDescription?.slice(0, 200) ?? "not provided"}`],
    });
  }

  if (["bounded", "hardcoded limit", "array limit", "max features", "capacity limit"].some((term) => text.includes(term))) {
    missingMechanisms.push({
      description: "Bounded resource consumer with a hard capacity limit",
      reason: "No registered primitive models the stated hard capacity bound.",
      evidence: ["Architecture description mentions a bounded consumer or hard capacity limit."],
    });
  }

  const asksForConsensus = ["consensus", "multi-agent", "coordinator"].some((term) => text.includes(term));
  const hasCoordinationPhysics = registry.list().some((primitive) =>
    ["consensus", "coordination"].includes(primitive.category),
  );
  if (asksForConsensus && !hasCoordinationPhysics) {
    missingMechanisms.push({
      description: "Multi-agent consensus and coordination failures",
      reason: "The architecture involves coordination, but the registry has no consensus or coordination physics.",
      evidence: ["Architecture description mentions consensus or a coordinator."],
    });
  }

  return { hasGap: missingMechanisms.length > 0, missingMechanisms, availableCategories };
}