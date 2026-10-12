import { z } from "zod";
import { parseWith } from "./parse";

// Shape of `creator_insights.evidence`: the observations an insight rests on.
// The row's `sample_size` and `confidence` say how much weight it deserves,
// so one outlier post does not become a permanent preference (AGENTS.md §8).

export const insightEvidenceItem = z.object({
  observation: z.string().trim().min(1).max(1000),
  content_item_id: z.uuid().optional(),
  metric: z.string().trim().min(1).max(60).optional(),
  value: z.number().optional(),
  baseline: z.number().optional(),
});
export type InsightEvidenceItem = z.infer<typeof insightEvidenceItem>;

export const insightEvidence = z.array(insightEvidenceItem).max(50);
export type InsightEvidence = z.infer<typeof insightEvidence>;

export const parseInsightEvidence = (input: unknown) => parseWith(insightEvidence, input);
