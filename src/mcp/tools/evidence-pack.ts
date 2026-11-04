import { randomUUID } from "node:crypto";

const MAX_PACKS_PER_SESSION = 20;
const PACK_TTL_MS = 24 * 60 * 60 * 1000;

interface EvidencePack {
  id: string;
  name: string;
  savedAt: number;
  evidence: Record<string, unknown>;
}

const packsBySession = new Map<string, Map<string, EvidencePack>>();

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getSessionPacks(sessionId: string): Map<string, EvidencePack> {
  const packs = packsBySession.get(sessionId) ?? new Map<string, EvidencePack>();
  const now = Date.now();
  for (const [id, pack] of packs) {
    if (now - pack.savedAt > PACK_TTL_MS) packs.delete(id);
  }
  packsBySession.set(sessionId, packs);
  return packs;
}

export const saveEvidencePackTool = {
  name: "save_evidence_pack",
  description: "Save the current session's trace, configuration, and audit findings for later review.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Optional label for this evidence pack" },
    },
    required: [],
  },
  async handler(args: Record<string, unknown>, context?: Record<string, unknown>) {
    const sessionId = typeof context?.sessionId === "string" ? context.sessionId : "";
    if (!context || !sessionId) return { success: false, error: "A session is required to save evidence." };

    const evidence: Record<string, unknown> = {};
    for (const key of ["lastTrace", "lastConfig", "lastFindings", "lastFailedFinding", "lastCausalAudit", "lastViolatedInvariants"]) {
      if (context[key] !== undefined) evidence[key] = context[key];
    }
    if (Object.keys(evidence).length === 0) {
      return { success: false, error: "No trace, configuration, or audit findings are available to save." };
    }

    let clonedEvidence: Record<string, unknown>;
    try {
      clonedEvidence = cloneJson(evidence);
    } catch {
      return { success: false, error: "Current evidence is not JSON-serializable." };
    }

    const packs = getSessionPacks(sessionId);
    const id = randomUUID();
    const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : "Evidence pack";
    packs.set(id, { id, name, savedAt: Date.now(), evidence: clonedEvidence });
    while (packs.size > MAX_PACKS_PER_SESSION) {
      const oldestId = packs.keys().next().value as string | undefined;
      if (!oldestId) break;
      packs.delete(oldestId);
    }

    return { success: true, packId: id, name, savedAt: packs.get(id)!.savedAt };
  },
};

export const loadEvidencePackTool = {
  name: "load_evidence_pack",
  description: "Restore a previously saved evidence pack into the current session context.",
  inputSchema: {
    type: "object",
    properties: {
      packId: { type: "string", description: "Evidence pack ID returned by save_evidence_pack" },
    },
    required: ["packId"],
  },
  async handler(args: Record<string, unknown>, context?: Record<string, unknown>) {
    const sessionId = typeof context?.sessionId === "string" ? context.sessionId : "";
    const packId = typeof args.packId === "string" ? args.packId : "";
    if (!context || !sessionId) return { success: false, error: "A session is required to load evidence." };
    if (!packId) return { success: false, error: "packId is required." };

    const pack = getSessionPacks(sessionId).get(packId);
    if (!pack) return { success: false, error: "Evidence pack not found or expired in this session." };

    Object.assign(context, cloneJson(pack.evidence));
    return { success: true, packId, name: pack.name, savedAt: pack.savedAt, restoredFields: Object.keys(pack.evidence) };
  },
};