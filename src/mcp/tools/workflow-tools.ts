import { getWorkflow } from "../../compiler/workflow-store.ts";
import { causalAuditTool, workflowToGraph } from "./causal-audit.ts";

export const workflowToCompiledGraph = workflowToGraph;

export async function auditWorkflowReliability(args: {
	workflowId: string;
	seed?: number;
	maxDepth?: number;
}): Promise<Record<string, any>> {
	const seed = Number.isFinite(args.seed) ? Math.floor(args.seed!) : 42817;
	const maxDepth = Number.isFinite(args.maxDepth) ? Math.max(0, Math.floor(args.maxDepth!)) : 2;
	const workflow = getWorkflow(args.workflowId);
	if (!workflow) {
		return { success: false, error: "UNKNOWN_WORKFLOW", seed, maxDepth };
	}

	const result = await causalAuditTool.handler({
		workflowId: args.workflowId,
		seed,
		maxDepth,
	});
	const graph = workflowToGraph(workflow);
	const violatedInvariants = Array.isArray(result.violatedInvariants)
		? result.violatedInvariants.map((id: string) => ({
				id,
				status: "BREACHED",
				evidence: `The causal audit reported invariant ${id} as violated.`,
			}))
		: [];

	return {
		...result,
		workflowId: workflow.id,
		seed,
		maxDepth,
		bfsDurationMs: result.durationMs ?? 0,
		baseline: {
			status: result.status,
			violatedInvariants: Array.isArray(result.violatedInvariants) ? result.violatedInvariants : [],
		},
		counterexample: Array.isArray(result.minimalCounterexample) && result.minimalCounterexample.length > 0
			? result.minimalCounterexample
			: null,
		violatedInvariants,
		affectedNodes: workflow.nodes
			.filter((node) => node.substrates.some((substrate) => ["CHANNEL", "LEASE", "LOG"].includes(substrate.vowel)))
			.map((node) => node.nodeId ?? node.nodeName),
		affectedEdges: graph.channels.map((channel) => {
			const actorNames = new Map(graph.actors.map((actor) => [actor.id, actor.name]));
			const src = actorNames.get(channel.sourceActorId) ?? channel.sourceActorId;
			const tgt = actorNames.get(channel.targetActorId) ?? channel.targetActorId;
			return `${src} → ${tgt}`;
		}),
		gate: result.verdict ?? "BLOCKED",
	};
}

export const auditWorkflowReliabilityCompatTool = causalAuditTool;
export default causalAuditTool;
