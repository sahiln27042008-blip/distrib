import { createOrchestrator } from "../llm/orchestrator.ts";
import type { MissingMechanism } from "./physics-gap-detector.ts";

export interface ProposedPhysics {
  id: string;
  category: string;
  description: string;
  requiredState: string[];
  interventions: string[];
  observableEffects: string[];
  reason: string;
}

const PROPOSER_PROMPT = `Propose a specification for a missing physics primitive. Return JSON with id, category, description, requiredState, interventions, observableEffects, and reason. This is a specification only: do not generate executable code.`;

export async function proposePhysics(gap: MissingMechanism): Promise<ProposedPhysics> {
  const response = await createOrchestrator().chat([
    { role: "system", content: PROPOSER_PROMPT },
    { role: "user", content: JSON.stringify(gap) },
  ], []);
  try {
    const parsed = response.tool_calls[0]?.arguments ?? parseProposalText(response.text);
    if (isProposedPhysics(parsed)) return parsed;
  } catch {
    // Return a safe, non-executable proposal when structured output is unavailable.
  }
  return {
    id: `proposed.${gap.description.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 50)}`,
    category: "unknown",
    description: gap.description,
    requiredState: [],
    interventions: [],
    observableEffects: [],
    reason: gap.reason,
  };
}

function parseProposalText(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  return JSON.parse(fenced ?? text);
}

function isProposedPhysics(value: unknown): value is ProposedPhysics {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.category === "string" &&
    typeof candidate.description === "string" && typeof candidate.reason === "string" &&
    Array.isArray(candidate.requiredState) && Array.isArray(candidate.interventions) &&
    Array.isArray(candidate.observableEffects);
}