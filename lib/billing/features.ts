import type { AiKind } from "@/lib/ai/prompts/registry";
import type { SubscriptionPlan } from "@/lib/schemas/enums";

// What each plan includes. One definition, used by the AI service (to
// enforce), the billing and settings pages (to show usage) and /pricing (to
// sell). Every number here must map to a working, enforced feature.

/** Allowances count uses in this rolling window (provider failures excluded). */
export const ALLOWANCE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** AI tasks with a monthly allowance. `smoke_test` is internal and has none. */
export type QuotaKind = Exclude<AiKind, "smoke_test">;

export interface QuotaFeature {
  kind: QuotaKind;
  /** "Content packages" */
  label: string;
  /** "content package" / "content packages", for sentences. */
  singular: string;
  plural: string;
}

export const QUOTA_FEATURES: readonly QuotaFeature[] = [
  { kind: "content_package", label: "Content packages", singular: "content package", plural: "content packages" },
  { kind: "content_opportunities", label: "Idea batches", singular: "idea batch", plural: "idea batches" },
  { kind: "content_section", label: "Section rewrites", singular: "section rewrite", plural: "section rewrites" },
  { kind: "content_diagnosis", label: "Post diagnoses", singular: "post diagnosis", plural: "post diagnoses" },
  { kind: "creator_strategy", label: "Strategy generations", singular: "strategy generation", plural: "strategy generations" },
  { kind: "creator_insights", label: "Insights updates", singular: "insights update", plural: "insights updates" },
  { kind: "weekly_plan", label: "Weekly plan suggestions", singular: "weekly plan", plural: "weekly plans" },
];

/** The headline number on the dashboard: the product's core output. */
export const HEADLINE_KIND: QuotaKind = "content_package";

/**
 * Uses per 30 days. Free covers about one post a week end to end; Pro covers
 * a creator posting 5–7 times a week with a package and a diagnosis per post.
 */
export const PLAN_ALLOWANCES: Record<SubscriptionPlan, Record<QuotaKind, number>> = {
  free: {
    creator_strategy: 2,
    content_opportunities: 4,
    content_package: 5,
    content_section: 15,
    content_diagnosis: 3,
    creator_insights: 2,
    weekly_plan: 2,
  },
  pro: {
    creator_strategy: 6,
    content_opportunities: 20,
    content_package: 30,
    content_section: 100,
    content_diagnosis: 30,
    creator_insights: 8,
    weekly_plan: 8,
  },
};

/** The plan's allowance for an AI task, or null when the task has none. */
export function allowanceFor(plan: SubscriptionPlan, kind: AiKind): number | null {
  return kind === "smoke_test" ? null : PLAN_ALLOWANCES[plan][kind];
}

export function quotaFeature(kind: QuotaKind): QuotaFeature {
  return QUOTA_FEATURES.find((feature) => feature.kind === kind)!;
}

/** Features that aren't metered and are only on some plans. */
export type GatedFeature = "youtube_research";

export const GATED_FEATURES: Record<GatedFeature, { label: string; plans: readonly SubscriptionPlan[] }> = {
  youtube_research: { label: "YouTube research", plans: ["pro"] },
};

export function planIncludes(plan: SubscriptionPlan, feature: GatedFeature): boolean {
  return GATED_FEATURES[feature].plans.includes(plan);
}

/** No AI cost, so no limit, on every plan. */
export const UNLIMITED_FEATURES: readonly string[] = [
  "Analytics, results entry and charts",
  "Content calendar",
  "Studio editing and version history",
  "Manual research signals",
];

/** The headline features on a plan card, in order. Every line maps to a real limit or feature. */
const HIGHLIGHT_KINDS: readonly QuotaKind[] = ["content_package", "content_opportunities", "content_diagnosis", "content_section"];

export function planHighlights(plan: SubscriptionPlan): string[] {
  const allowances = PLAN_ALLOWANCES[plan];
  const lines = HIGHLIGHT_KINDS.map((kind) => {
    const feature = quotaFeature(kind);
    return `${allowances[kind]} ${allowances[kind] === 1 ? feature.singular : feature.plural} a month`;
  });
  if (plan === "pro") return [...lines, "YouTube research", "Everything in Free"];
  return [...lines, "Unlimited analytics, calendar and editing"];
}
