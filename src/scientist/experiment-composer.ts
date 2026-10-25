import type { MatrixConfig } from "../matrix-copy.ts";
import { getGlobalRegistry } from "../physics/registry.ts";
import type { PhysicsConfig, PhysicsRegistry } from "../physics/registry-types.ts";
import type { Intervention } from "../interventions/primitives.ts";
import type { InterventionSequence } from "../interventions/composer.ts";
import { buildWorldModel } from "../world-model/adapters.ts";
import type { PhysicsSelection } from "./physics-selector.ts";

export interface ComposedExperiment {
  id: string;
  primitiveIds: string[];
  interventions: Intervention[];
  sequence: InterventionSequence;
  hypothesis: string;
  expectedInvariant: string;
  config: MatrixConfig;
}

export function composeExperiments(
  baseConfig: MatrixConfig,
  selections: PhysicsSelection[],
  invariants: string[],
  budget: number,
): ComposedExperiment[] {
  if (budget <= 0) return [];
  const registry: PhysicsRegistry = getGlobalRegistry();
  const { actors } = buildWorldModel(baseConfig);
  const experiments: ComposedExperiment[] = [];
  const selected = [...selections].sort((a, b) => b.relevance - a.relevance || a.primitiveId.localeCompare(b.primitiveId));

  const addExperiment = (primitiveIds: string[], interventions: Intervention[], physicsConfigs: PhysicsConfig[], hypothesis: string, invariant: string) => {
    if (experiments.length >= budget) return;
    const config = physicsConfigs.reduce<MatrixConfig>(
      (current, physicsConfig) => ({ ...current, ...physicsConfig.dialOverrides }),
      { ...baseConfig, runId: `adaptive-${experiments.length + 1}` },
    );
    const id = `adaptive-exp-${experiments.length + 1}`;
    const sequence: InterventionSequence = {
      id: `adaptive-seq-${experiments.length + 1}`,
      interventions,
      hypothesis,
      expectedInvariant: invariant,
    };
    experiments.push({ id, primitiveIds, interventions, sequence, hypothesis, expectedInvariant: invariant, config });
  };

  for (const selection of selected) {
    const primitive = registry.get(selection.primitiveId);
    if (!primitive) continue;
    const physicsConfig = primitive.configure({ actors });
    const interventions = primitive.generateInterventions({ actors });
    for (const invariant of invariants) {
      if (experiments.length >= budget) return experiments;
      addExperiment(
        [primitive.id], interventions,
        [physicsConfig],
        `${selection.reason} This may violate ${invariant}.`, invariant,
      );
    }
  }

  const highRelevance = selected.filter((selection) => selection.relevance > 0.8);
  for (let left = 0; left < highRelevance.length; left++) {
    for (let right = left + 1; right < highRelevance.length; right++) {
      if (experiments.length >= budget) return experiments;
      const first = registry.get(highRelevance[left]!.primitiveId);
      const second = registry.get(highRelevance[right]!.primitiveId);
      if (!first || !second) continue;
      const physicsConfigs = [first.configure({ actors }), second.configure({ actors })];
      const interventions = [...first.generateInterventions({ actors }), ...second.generateInterventions({ actors })];
      for (const invariant of invariants) {
        if (experiments.length >= budget) return experiments;
        addExperiment(
          [first.id, second.id], interventions, physicsConfigs,
          `The combination of ${first.id} and ${second.id} may create a cascade violating ${invariant}.`,
          invariant,
        );
      }
    }
  }
  return experiments;
}