import { z } from "zod";
import { AI_ERRORS, type AiErrorCode } from "@/lib/ai/errors";
import { COMPARISON_TEXT, METRIC_LABELS, METRICS, type ComparisonLabel, type Metric } from "@/lib/analytics/baseline";
import { formatMetric } from "@/lib/analytics/format";
import { PLATFORM_LABELS, type Platform } from "./creator";
import { insightType, signalLevel, type InsightType, type SignalLevel } from "./enums";
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

// ---------------------------------------------------------------------------
// Learning Agent (AGENTS.md §8): patterns across the creator's settled posts.
// ---------------------------------------------------------------------------

/** Settled posts needed before an insights update can run. */
export const MIN_SETTLED_POSTS = 5;
export const MAX_INSIGHTS = 6;
export const MAX_NOTES = 2;
/** One post is not a pattern. */
export const MIN_SUPPORTING_POSTS = 2;
export const MAX_SUPPORTING_POSTS = 12;
/** Fewer settled posts in total than this caps every insight at `medium`. */
export const MEDIUM_CONFIDENCE_TOTAL = 8;

export const INSIGHT_TYPE_LABELS: Record<InsightType, string> = {
  topic: "Topic",
  hook: "Hook",
  format: "Format",
  duration: "Length",
  cta: "Call to action",
  audience: "Audience",
  underperformance: "What's holding posts back",
  other: "Other",
};

export { CONFIDENCE_LABELS } from "./diagnosis";

/** Post refs the model sees instead of ids: "P1" … "P30". */
export const postRef = (index: number) => `P${index + 1}`;
const POST_REF = /^P\d{1,2}$/;

// Model-facing schema (OpenAI strict mode: every key present, no optionals).
export const insightsModelSchema = z.object({
  insights: z.array(
    z.object({
      insight_type: insightType,
      summary: z.string(),
      next_step: z.string(),
      metric: z.enum(METRICS),
      supporting_posts: z.array(z.string()),
      confidence: signalLevel,
    }),
  ),
  notes: z.array(z.string()),
});
export type InsightsModelOutput = z.infer<typeof insightsModelSchema>;

const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * App validation. Supporting posts are not required to be 2+ here: a single
 * weak insight is dropped by `applyInsightRules` instead of failing the run.
 */
export const insightsOutput = z.object({
  insights: z
    .array(
      z.object({
        insight_type: insightType,
        summary: text(200),
        next_step: text(200),
        metric: z.enum(METRICS),
        supporting_posts: z.array(z.string().trim().regex(POST_REF)).max(MAX_SUPPORTING_POSTS),
        confidence: signalLevel,
      }),
    )
    .max(MAX_INSIGHTS),
  notes: z.array(text(200)).max(MAX_NOTES),
});
export type InsightsOutput = z.infer<typeof insightsOutput>;

export const parseInsightsOutput = (input: unknown) => parseWith(insightsOutput, input);

// ---------------------------------------------------------------------------
// Honesty rules (deterministic, applied before storing)
// ---------------------------------------------------------------------------

/** What the app knows about one post sent to the model, by ref. */
export interface PostFacts {
  id: string;
  title: string;
  platform: Platform | null;
  /** "Oct 14", or null without a timezone. */
  dateLabel: string | null;
  metrics: Partial<Record<Metric, { value: number | null; median: number | null; label: ComparisonLabel | null }>>;
}

/** A row ready for `replace_creator_insights`. */
export interface InsightRow {
  insight_type: InsightType;
  summary: string;
  next_step: string;
  evidence: InsightEvidence;
  confidence: SignalLevel;
  sample_size: number;
}

const RANK: Record<SignalLevel, number> = { low: 0, medium: 1, high: 2 };

/** The highest confidence `supporting` posts (out of `settledTotal`) can carry. */
export function confidenceCeiling(supporting: number, settledTotal: number): SignalLevel {
  const bySample: SignalLevel = supporting <= 2 ? "low" : supporting <= 4 ? "medium" : "high";
  if (settledTotal < MEDIUM_CONFIDENCE_TOTAL && bySample === "high") return "medium";
  return bySample;
}

/** One evidence line per supporting post, built from stored numbers only. */
export function evidenceFor(facts: PostFacts, metric: Metric): InsightEvidenceItem {
  const where = [facts.platform ? PLATFORM_LABELS[facts.platform] : null, facts.dateLabel].filter(Boolean).join(", ");
  const reading = facts.metrics[metric];
  const name = METRIC_LABELS[metric];
  const result =
    !reading || reading.value === null
      ? `${name} not entered`
      : reading.label
        ? `${name} ${formatMetric(metric, reading.value)}, ${COMPARISON_TEXT[reading.label].toLowerCase()}`
        : `${name} ${formatMetric(metric, reading.value)}, not compared yet`;
  return {
    observation: `“${facts.title}”${where ? ` (${where})` : ""}: ${result}`.slice(0, 1000),
    content_item_id: facts.id,
    metric,
    ...(reading?.value !== null && reading?.value !== undefined ? { value: reading.value } : {}),
    ...(reading?.median !== null && reading?.median !== undefined ? { baseline: reading.median } : {}),
  };
}

const normalize = (summary: string) =>
  summary
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Drops unknown and duplicate post refs and any insight left with fewer than
 * two posts, computes the sample size, caps confidence by it, builds evidence
 * from the stored numbers and removes duplicate summaries.
 */
export function applyInsightRules(
  output: InsightsOutput,
  { facts, settledTotal }: { facts: ReadonlyMap<string, PostFacts>; settledTotal: number },
): { insights: InsightRow[]; capped: boolean } {
  const seen = new Set<string>();
  const insights: InsightRow[] = [];
  let capped = false;

  for (const insight of output.insights) {
    const posts = [...new Set(insight.supporting_posts)]
      .map((ref) => facts.get(ref))
      .filter((post): post is PostFacts => post !== undefined);
    if (posts.length < MIN_SUPPORTING_POSTS) continue;

    const key = normalize(insight.summary);
    if (seen.has(key)) continue;
    seen.add(key);

    const ceiling = confidenceCeiling(posts.length, settledTotal);
    const confidence = RANK[insight.confidence] > RANK[ceiling] ? ceiling : insight.confidence;
    if (confidence !== insight.confidence) capped = true;

    insights.push({
      insight_type: insight.insight_type,
      summary: insight.summary,
      next_step: insight.next_step,
      evidence: posts.map((post) => evidenceFor(post, insight.metric)),
      confidence,
      sample_size: posts.length,
    });
  }
  return { insights, capped };
}

// ---------------------------------------------------------------------------
// Stored rows
// ---------------------------------------------------------------------------

export const INSIGHT_COLUMNS =
  "id, insight_type, summary, next_step, evidence, confidence, sample_size, ai_generation_id, created_at";

const storedInsightRow = z.object({
  id: z.string(),
  insight_type: insightType,
  summary: z.string(),
  next_step: z.string().nullable(),
  evidence: z.unknown(),
  confidence: signalLevel.nullable(),
  sample_size: z.number().int().nullable(),
  ai_generation_id: z.string().nullable(),
  created_at: z.string(),
});

export interface StoredInsight extends Omit<z.infer<typeof storedInsightRow>, "evidence"> {
  /** Empty when the stored evidence no longer validates; the insight is still shown. */
  evidence: InsightEvidence;
}

/** Null when the row itself is unreadable. */
export function parseStoredInsight(input: unknown): StoredInsight | null {
  const row = storedInsightRow.safeParse(input);
  if (!row.success) return null;
  const evidence = insightEvidence.safeParse(row.data.evidence);
  return { ...row.data, evidence: evidence.success ? evidence.data : [] };
}

const CONFIDENCE_RANK: Record<SignalLevel, number> = RANK;

/** High confidence first, then larger samples, then newest. */
export function compareInsights(a: StoredInsight, b: StoredInsight): number {
  const rank = (i: StoredInsight) => (i.confidence ? CONFIDENCE_RANK[i.confidence] : -1);
  return (
    rank(b) - rank(a) ||
    (b.sample_size ?? 0) - (a.sample_size ?? 0) ||
    Date.parse(b.created_at) - Date.parse(a.created_at)
  );
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type InsightErrorCode =
  | AiErrorCode
  | "not_enough_data"
  | "missing_context"
  | "update_limit"
  | "in_progress"
  | "not_found"
  | "save_failed";

export const INSIGHT_ERRORS: Record<InsightErrorCode, { message: string; retryable: boolean }> = {
  ...AI_ERRORS,
  not_enough_data: {
    message: `Insights need at least ${MIN_SETTLED_POSTS} posts with results from a week or more after posting.`,
    retryable: false,
  },
  missing_context: {
    message: "Finish your creator profile first, so insights can use your goals and audience.",
    retryable: false,
  },
  update_limit: {
    message: "You've updated your insights 3 times today. Try again tomorrow.",
    retryable: false,
  },
  in_progress: {
    message: "An insights update is already running. Wait a moment, then refresh the page.",
    retryable: false,
  },
  not_found: {
    message: "We couldn't find that insight. Refresh the page to see your current insights.",
    retryable: false,
  },
  save_failed: { message: "We couldn't save that change. Please try again.", retryable: true },
};
