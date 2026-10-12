import { z } from "zod";
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
