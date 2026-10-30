// enterpriseee/enterprise-simulator/src/physics/alphabet/compiler.ts

import type {
  Actor,
  CandidatePerturbation,
  CompiledAlphabetGraph,
  Contract,
  DecompositionResult,
  EpistemicConfidence,
  EpistemicState,
  InvoiceEvidence,
  Letter,
  ProvenanceRecord,
  Vowel,
} from "./types.ts";
import { Cell } from "./vowels/cell.ts";
import { Log } from "./vowels/log.ts";
import { Lease } from "./vowels/lease.ts";
import { Channel } from "./vowels/channel.ts";

export class AlphabetCompiler {
  compileFromNaturalLanguage(workflowText: string): CompiledAlphabetGraph {
    const textLower = workflowText.toLowerCase();

    // Check for physical semantics below the software causal abstraction
    const unrepresentablePatterns = [
      { regex: /cosmic\s+ray/i, term: "hardware-level bit flip" },
      { regex: /bit\s+flip/i, term: "hardware-level bit flip" },
      { regex: /l1\s+cache/i, term: "hardware-level bit flip" },
      { regex: /quantum\s+fluctuation/i, term: "quantum noise" },
      { regex: /optical\s+fiber\s+cut/i, term: "physical fiber damage" },
      { regex: /silicon\s+defect/i, term: "silicon-level fault" },
    ];

    const unrepresentable: string[] = [];
    for (const pat of unrepresentablePatterns) {
      if (pat.regex.test(workflowText)) {
        unrepresentable.push(pat.term);
      }
    }

    if (unrepresentable.length > 0) {
      return {
        actors: [],
        vowels: [],
        channels: [],
        contracts: [],
        candidatePerturbations: [],
        epistemicStatus: ["NOT_REPRESENTABLE"],
        unrepresentableSemantics: unrepresentable,
        provenance: [],
      };
    }

    const actors: Actor[] = [];
    const vowels: Vowel[] = [];
    const channels: Channel[] = [];
    const contracts: Contract[] = [];
    const candidatePerturbations: CandidatePerturbation[] = [];
    const epistemicStatus: EpistemicState[] = ["INFERRED"];
    const provenance: ProvenanceRecord[] = [];

    // Actor extraction
    const addActor = (id: string, name: string, kind = "service", guarantees: string[] = []) => {
      const actor: Actor = { id, name, kind, contract: { guarantees } };
      actors.push(actor);
      return actor;
    };

    if (textLower.includes("cfo") || textLower.includes("cfo agent")) {
      addActor("cfo-agent", "CFO Agent", "agent");
    }
    if (textLower.includes("postgres")) {
      addActor("postgres", "Postgres Database", "database", ["read_committed"]);
    }
    if (textLower.includes("zendesk")) {
      addActor("zendesk", "Zendesk Support", "saas_api");
    }
    if (textLower.includes("github")) {
      addActor("github", "GitHub Issues", "saas_api");
    }
    if (textLower.includes("stripe")) {
      addActor("stripe", "Stripe Billing", "payment_service");
    }
    if (textLower.includes("sendgrid")) {
      addActor("sendgrid", "SendGrid Email", "notification_service");
    }
    if (textLower.includes("slack") || textLower.includes("dev team")) {
      addActor("slack", "Slack Workspace", "chat_service");
    }

    // Default actors if text is generic
    if (actors.length === 0) {
      addActor("caller-agent", "Caller Agent", "agent");
      addActor("target-service", "Target Service", "service");
    }

    // Vowel extraction: Cells
    if (textLower.includes("postgres")) {
      const dbCell = new Cell({
        id: "cell-postgres-churn",
        actorId: "postgres",
        persistence: "DURABLE",
        idempotencyEnforced: false,
        fencingTokenEnforced: false,
        initialState: { churnedCustomers: [{ id: "cust-1", name: "Acme Corp", mrr: 25000 }] },
      });
      vowels.push(dbCell);
      provenance.push({
        property: "persistence",
        source: "user_text",
        confidence: "INFERRED",
        evidence: "Postgres implies durable storage",
      });
    }

    if (textLower.includes("stripe")) {
      const stripeLedger = new Cell({
        id: "cell-stripe-credit",
        actorId: "stripe",
        persistence: "DURABLE",
        idempotencyEnforced: false, // Default un-enforced unless stated
        fencingTokenEnforced: false,
        initialState: { creditsGranted: 0 },
      });
      vowels.push(stripeLedger);
      provenance.push({
        property: "idempotencyEnforced",
        source: "user_text",
        confidence: "UNKNOWN",
        evidence: "User text does not specify Stripe idempotency key enforcement",
      });
    }

    // Vowel extraction: Leases
    // Notice: Do NOT invent infrastructure limits from product names.
    // If pool or capacity mentioned in text, extract explicit; otherwise record UNKNOWN confidence.
    const poolMatch = workflowText.match(/pool\s+(?:of\s+)?(\d+)/i);
    const capacityMatch = workflowText.match(/(\d+)\s*(?:mb|gb|rpm|connections)/i);

    if (poolMatch && poolMatch[1]) {
      const cap = parseInt(poolMatch[1], 10);
      const lease = new Lease({
        id: "lease-db-pool",
        actorId: "postgres",
        maxCapacity: cap,
        ttlMs: 5000,
        overflowPolicy: "WAIT_TIMEOUT",
      });
      vowels.push(lease);
      provenance.push({
        property: "maxCapacity",
        source: "user_text",
        confidence: "EXPLICIT",
        evidence: `Extracted '${poolMatch[0]}'`,
      });
    } else if (textLower.includes("postgres")) {
      // Inferred lease with UNKNOWN capacity confidence as mandated
      const lease = new Lease({
        id: "lease-postgres-pool",
        actorId: "postgres",
        maxCapacity: 20,
        ttlMs: 10000,
        overflowPolicy: "WAIT_TIMEOUT",
      });
      vowels.push(lease);
      provenance.push({
        property: "maxCapacity",
        source: "user_text",
        confidence: "UNKNOWN",
        evidence: "Postgres mentioned but connection limit not specified in user text; marked UNKNOWN",
      });
    }

    // Vowel extraction: Channels
    const cfoActor = actors.find((a) => a.id === "cfo-agent");
    if (cfoActor) {
      if (actors.some((a) => a.id === "postgres")) {
        const ch = new Channel({
          id: "channel-cfo-postgres",
          sourceActorId: "cfo-agent",
          targetActorId: "postgres",
          timeoutMs: 5000,
        });
        channels.push(ch);
        vowels.push(ch);
      }
      if (actors.some((a) => a.id === "zendesk")) {
        const ch = new Channel({
          id: "channel-cfo-zendesk",
          sourceActorId: "cfo-agent",
          targetActorId: "zendesk",
          timeoutMs: 5000,
        });
        channels.push(ch);
        vowels.push(ch);
      }
      if (actors.some((a) => a.id === "github")) {
        const ch = new Channel({
          id: "channel-cfo-github",
          sourceActorId: "cfo-agent",
          targetActorId: "github",
          timeoutMs: 5000,
        });
        channels.push(ch);
        vowels.push(ch);
      }
      if (actors.some((a) => a.id === "stripe")) {
        const ch = new Channel({
          id: "channel-cfo-stripe",
          sourceActorId: "cfo-agent",
          targetActorId: "stripe",
          timeoutMs: 3000,
        });
        channels.push(ch);
        vowels.push(ch);
      }
      if (actors.some((a) => a.id === "sendgrid")) {
        const ch = new Channel({
          id: "channel-cfo-sendgrid",
          sourceActorId: "cfo-agent",
          targetActorId: "sendgrid",
          timeoutMs: 5000,
        });
        channels.push(ch);
        vowels.push(ch);
      }
      if (actors.some((a) => a.id === "slack")) {
        const ch = new Channel({
          id: "channel-cfo-slack",
          sourceActorId: "cfo-agent",
          targetActorId: "slack",
          timeoutMs: 5000,
        });
        channels.push(ch);
        vowels.push(ch);
      }
    }

    // Fallback channel if none created
    if (channels.length === 0 && actors.length >= 2) {
      const ch = new Channel({
        id: `channel-${actors[0]!.id}-${actors[1]!.id}`,
        sourceActorId: actors[0]!.id,
        targetActorId: actors[1]!.id,
        timeoutMs: 5000,
      });
      channels.push(ch);
      vowels.push(ch);
    }

    // Candidate Perturbations
    const stripeChannel = channels.find((c) => c.id === "channel-cfo-stripe");
    if (stripeChannel) {
      candidatePerturbations.push({
        consonant: { kind: "SEVER", phase: "POST_COMMIT" },
        targetId: stripeChannel.id,
        description: "Sever ACK after Stripe credit mutation to observe divergence",
      });
      candidatePerturbations.push({
        consonant: { kind: "DELAY", durationMs: 4000 },
        targetId: stripeChannel.id,
        description: "Delay Stripe response past timeout",
      });
      candidatePerturbations.push({
        consonant: { kind: "DUPLICATE", count: 2 },
        targetId: stripeChannel.id,
        description: "Duplicate credit call without idempotency key",
      });
    }

    const lease = vowels.find((v) => v.kind === "LEASE");
    if (lease) {
      candidatePerturbations.push({
        consonant: { kind: "SATURATE", loadUnits: 25 },
        targetId: lease.id,
        description: "Saturate connection lease past capacity",
      });
    }

    return {
      actors,
      vowels,
      channels,
      contracts,
      candidatePerturbations,
      epistemicStatus,
      unrepresentableSemantics: [],
      provenance,
    };
  }

  compileFromInvoiceEvidence(evidence: InvoiceEvidence[]): CompiledAlphabetGraph {
    const actors: Actor[] = [];
    const vowels: Vowel[] = [];
    const channels: Channel[] = [];
    const candidatePerturbations: CandidatePerturbation[] = [];
    const epistemicStatus: EpistemicState[] = ["INFERRED"];
    const provenance: ProvenanceRecord[] = [];

    for (let i = 0; i < evidence.length; i++) {
      const item = evidence[i]!;
      const actorId =
        item.actorId ??
        (item.sku.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `actor-${i}`);
      const actorName = item.sku;

      const fullText = `${item.sku} ${item.evidence} ${item.inferredCapacity?.evidence ?? ""}`.toLowerCase();

      // Generic numeric extraction from evidence strings (e.g. 128MB, 5000 RPM, 400 connections)
      let parsedCapacity: number | undefined;
      const numMatch = fullText.match(/(\d+(?:\.\d+)?)\s*(mb|gb|rpm|connections?|tpm|req\/s|rps)/i);
      if (numMatch) {
        parsedCapacity = parseFloat(numMatch[1]!);
      }

      const maxCapacity = item.inferredCapacity?.maxCapacity ?? parsedCapacity ?? 100;

      let confidence: EpistemicConfidence;
      if (item.inferredCapacity?.confidence) {
        confidence = item.inferredCapacity.confidence;
      } else if (parsedCapacity !== undefined) {
        confidence = "EXPLICIT";
      } else {
        confidence = "UNKNOWN";
      }

      // Infer overflow policy generically from workload semantics:
      // - Connection / pool limits -> WAIT_TIMEOUT
      // - Rate limits / throughput quotas -> REJECT_429
      // - Memory exhaustion / heap limits -> PANIC_CRASH (held during external calls)
      let overflowPolicy: "WAIT_TIMEOUT" | "REJECT_429" | "PANIC_CRASH" = "WAIT_TIMEOUT";
      let heldDuringExternalChannel = false;

      if (fullText.includes("connection") || fullText.includes("pool")) {
        overflowPolicy = "WAIT_TIMEOUT";
      } else if (
        fullText.includes("rpm") ||
        fullText.includes("tpm") ||
        fullText.includes("rate limit") ||
        fullText.includes("429") ||
        fullText.includes("quota")
      ) {
        overflowPolicy = "REJECT_429";
      } else if (
        fullText.includes("mb") ||
        fullText.includes("gb") ||
        fullText.includes("memory") ||
        fullText.includes("ram") ||
        fullText.includes("panic") ||
        fullText.includes("crash")
      ) {
        overflowPolicy = "PANIC_CRASH";
        heldDuringExternalChannel = true;
      }

      // Infer actor kind generically
      let kind = "service";
      if (fullText.includes("worker") || fullText.includes("compute") || fullText.includes("lambda")) {
        kind = "worker";
      } else if (fullText.includes("llm") || fullText.includes("ai") || fullText.includes("model")) {
        kind = "llm_service";
      } else if (fullText.includes("db") || fullText.includes("database") || fullText.includes("sql")) {
        kind = "database";
      }

      actors.push({ id: actorId, name: actorName, kind });

      const lease = new Lease({
        id: `lease-${actorId}-${i}`,
        actorId,
        maxCapacity,
        ttlMs: overflowPolicy === "REJECT_429" ? 60000 : overflowPolicy === "PANIC_CRASH" ? 30000 : 10000,
        overflowPolicy,
        heldDuringExternalChannel,
      });
      vowels.push(lease);

      provenance.push({
        property: "maxCapacity",
        source: item.source,
        confidence,
        evidence: item.evidence,
      });
    }

    return {
      actors,
      vowels,
      channels,
      contracts: [],
      candidatePerturbations,
      epistemicStatus,
      unrepresentableSemantics: [],
      provenance,
    };
  }

  attemptProposedMechanism(proposedId: string, description: string): DecompositionResult {
    const combined = `${proposedId} ${description}`.toLowerCase();

    // Check for hardware / cosmic / unrepresentable physics
    if (
      combined.includes("cosmic") ||
      combined.includes("bit flip") ||
      combined.includes("hardware") ||
      combined.includes("quantum") ||
      combined.includes("l1 cache")
    ) {
      return {
        status: "INSUFFICIENT_PHYSICS",
        missingSemantics: ["hardware-level bit flip"],
      };
    }

    // Bounded resource consumer: maps to V3 LEASE + C4 SATURATE
    if (
      proposedId.includes("bounded_resource") ||
      description.includes("bounded resource") ||
      description.includes("resource limit") ||
      description.includes("memory limit")
    ) {
      const letters: Letter[] = ["V3", "C4"];
      return {
        status: "REPRESENTABLE",
        letters,
        coverage: 1.0,
        missingSemantics: [],
      };
    }

    // Default insufficient physics if no clean alphabet mapping
    return {
      status: "INSUFFICIENT_PHYSICS",
      missingSemantics: [`Cannot map proposed mechanism ${proposedId} to V1-V4 + C1-C6`],
    };
  }
}

