import { z } from "zod";
import { platform, type Platform } from "./creator";
import { difficulty, ideaStatus, signalLevel, type IdeaStatus } from "./enums";
import { parseWith } from "./parse";

// Shape of `content_ideas.evidence`. Every piece of evidence records where it
// came from, so a recommendation can always explain itself (AGENTS.md §12).

export const evidenceKind = z.enum([
  "research_signal",
  "creator_history",
  "audience_comment",
  "competitor",
  "trend",
  "creator_input",
]);
export type EvidenceKind = z.infer<typeof evidenceKind>;

export const evidenceItem = z.object({
  kind: evidenceKind,
  summary: z.string().trim().min(1).max(1000),
  source: z.string().trim().min(1).max(200).optional(),
  source_url: z.url().optional(),
  observed_at: z.iso.datetime({ offset: true }).optional(),
});
export type EvidenceItem = z.infer<typeof evidenceItem>;

export const ideaEvidence = z.array(evidenceItem).max(20);
export type IdeaEvidence = z.infer<typeof ideaEvidence>;

export const parseIdeaEvidence = (input: unknown) => parseWith(ideaEvidence, input);

// ---------------------------------------------------------------------------
// Opportunities (Opportunity Agent)
// ---------------------------------------------------------------------------

/** Ideas per generation. */
export const OPPORTUNITY_BATCH_SIZE = 5;

/** Evidence kinds the model may cite, at least one. Built per request from the data we actually have. */
export type AllowedEvidenceKinds = readonly [EvidenceKind, ...EvidenceKind[]];

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  creator_input: "From your profile",
  creator_history: "From your past performance",
  research_signal: "From research",
  audience_comment: "From audience comments",
  competitor: "From a competitor you noted",
  trend: "From trend data",
};

/** Lowercased, whitespace-collapsed topic, for duplicate checks. */
export function normalizeTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, " ").toLowerCase();
}

const unique = (items: string[]) => new Set(items).size === items.length;

/** Evidence kinds that must cite a signal by ref; `creator_input` may (a creator note), `creator_history` may not. */
export const SIGNAL_BACKED_KINDS: ReadonlySet<EvidenceKind> = new Set([
  "research_signal",
  "audience_comment",
  "competitor",
  "trend",
]);

/**
 * Model-facing schema. Every key is required (OpenAI strict mode) and lengths
 * are not enforced by the provider, so bounds live in `opportunityOutputFor`.
 * `kind` only allows what this creator's data can support, and `signal_ref`
 * only the refs of the signals in this prompt.
 */
export function opportunityModelSchemaFor(allowedEvidenceKinds: AllowedEvidenceKinds, signalRefs: readonly string[] = []) {
  const signalRef = signalRefs.length
    ? z.enum(signalRefs as [string, ...string[]]).nullable()
    : z.null();
  return z.object({
    opportunities: z.array(
      z.object({
        topic: z.string(),
        audience_need: z.string(),
        angle: z.string(),
        hook: z.string(),
        format: z.string(),
        platform,
        pillar_name: z.string(),
        rationale: z.string(),
        cta: z.string(),
        difficulty,
        audience_fit: signalLevel,
        evidence: z.array(z.object({ kind: z.enum(allowedEvidenceKinds), summary: z.string(), signal_ref: signalRef })),
      }),
    ),
  });
}
export type OpportunityModelOutput = z.infer<ReturnType<typeof opportunityModelSchemaFor>>;

const text = (max: number) => z.string().trim().min(1).max(max);

/** App-level validation of a generated batch for one creator's pillars, platforms and evidence. */
export function opportunityOutputFor(options: {
  pillarNames: readonly string[];
  platforms: readonly Platform[];
  allowedEvidenceKinds: AllowedEvidenceKinds;
  /** The signals in this prompt: ref → the evidence kind it may be cited as. */
  signals?: readonly { ref: string; kind: EvidenceKind }[];
}) {
  const pillars = new Set(options.pillarNames.map(normalizeTopic));
  const platforms = new Set<string>(options.platforms);
  const kinds = new Set<string>(options.allowedEvidenceKinds);
  const signalKinds = new Map((options.signals ?? []).map((signal) => [signal.ref, signal.kind]));

  const evidence = z
    .object({
      kind: evidenceKind.refine((value) => kinds.has(value), { error: "Evidence kind is not available." }),
      summary: text(300),
      signal_ref: z.string().nullable(),
    })
    .superRefine((item, ctx) => {
      if (item.signal_ref === null) {
        if (SIGNAL_BACKED_KINDS.has(item.kind)) {
          ctx.addIssue({ code: "custom", path: ["signal_ref"], message: "This evidence kind must cite a signal." });
        }
        return;
      }
      const cited = signalKinds.get(item.signal_ref);
      if (cited === undefined) {
        ctx.addIssue({ code: "custom", path: ["signal_ref"], message: "Unknown signal ref." });
      } else if (cited !== item.kind) {
        ctx.addIssue({ code: "custom", path: ["signal_ref"], message: "Evidence kind doesn't match the cited signal." });
      }
    });

  const opportunity = z.object({
    topic: text(120),
    audience_need: text(300),
    angle: text(300),
    hook: text(200),
    format: text(60),
    platform: platform.refine((value) => platforms.has(value), { error: "Platform must be one the creator uses." }),
    pillar_name: text(200).refine((value) => pillars.has(normalizeTopic(value)), {
      error: "Pillar must be one of the creator's active pillars.",
    }),
    rationale: text(400),
    cta: text(200),
    difficulty,
    audience_fit: signalLevel,
    evidence: z.array(evidence).min(1).max(3),
  });

  return z.object({
    opportunities: z
      .array(opportunity)
      .length(OPPORTUNITY_BATCH_SIZE)
      .refine((items) => unique(items.map((item) => normalizeTopic(item.topic))), {
        error: "Topics must be unique.",
      }),
  });
}
export type OpportunityOutput = z.infer<ReturnType<typeof opportunityOutputFor>>;
export type GeneratedOpportunity = OpportunityOutput["opportunities"][number];

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

/** The page's views. `planned`, `in_production` and `used` belong to calendar and studio. */
export const opportunityView = z.enum(["new", "saved", "dismissed"]);
export type OpportunityView = z.infer<typeof opportunityView>;

/** Allowed status changes from the opportunities page. Anything else is rejected server-side. */
export const IDEA_STATUS_TRANSITIONS: Record<IdeaStatus, readonly IdeaStatus[]> = {
  new: ["saved", "dismissed"],
  saved: ["new", "dismissed"],
  dismissed: ["new"],
  planned: [],
  in_production: [],
  used: [],
};

export function canTransition(from: IdeaStatus, to: IdeaStatus): boolean {
  return IDEA_STATUS_TRANSITIONS[from].includes(to);
}

/** A stored idea as the page shows it, re-validated on read. */
export const storedOpportunity = z.object({
  id: z.string(),
  topic: z.string(),
  audience_need: z.string().nullable(),
  angle: z.string().nullable(),
  hook: z.string().nullable(),
  format: z.string().nullable(),
  platform: platform.nullable(),
  rationale: z.string().nullable(),
  cta: z.string().nullable(),
  difficulty: difficulty.nullable(),
  audience_fit: signalLevel.nullable(),
  evidence_strength: signalLevel.nullable(),
  evidence: ideaEvidence,
  status: ideaStatus,
  created_at: z.string(),
  pillar_name: z.string().nullable(),
});
export type StoredOpportunity = z.infer<typeof storedOpportunity>;
