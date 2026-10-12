import { z } from "zod";

// Every value list here mirrors a `check` constraint in
// supabase/migrations/20261009000100_core_schema.sql. `DB_ENUM_COLUMNS` maps
// each constrained column to its schema; tests/db/schema-parity.test.ts fails
// if the two drift apart.

export const subscriptionStatus = z.enum(["active", "trialing", "past_due", "canceled", "incomplete"]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatus>;

export const experienceLevel = z.enum(["beginner", "growing", "established"]);
export type ExperienceLevel = z.infer<typeof experienceLevel>;

export const onboardingStatus = z.enum(["not_started", "in_progress", "completed"]);
export type OnboardingStatus = z.infer<typeof onboardingStatus>;

export const difficulty = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof difficulty>;

/** Qualitative strength for opportunity signals and insight confidence. Deliberately not a score. */
export const signalLevel = z.enum(["low", "medium", "high"]);
export type SignalLevel = z.infer<typeof signalLevel>;

export const ideaStatus = z.enum(["new", "saved", "planned", "in_production", "used", "dismissed"]);
export type IdeaStatus = z.infer<typeof ideaStatus>;

export const authorSource = z.enum(["ai", "user"]);
export type AuthorSource = z.infer<typeof authorSource>;

export const contentItemStatus = z.enum(["draft", "ready", "scheduled", "published", "archived"]);
export type ContentItemStatus = z.infer<typeof contentItemStatus>;

export const analyticsSource = z.enum(["manual", "import", "api"]);
export type AnalyticsSource = z.infer<typeof analyticsSource>;

export const insightType = z.enum([
  "topic",
  "hook",
  "format",
  "duration",
  "cta",
  "audience",
  "underperformance",
  "other",
]);
export type InsightType = z.infer<typeof insightType>;

export const insightStatus = z.enum(["active", "dismissed", "superseded"]);
export type InsightStatus = z.infer<typeof insightStatus>;

export const generationStatus = z.enum(["pending", "succeeded", "failed"]);
export type GenerationStatus = z.infer<typeof generationStatus>;

/** `table.column` → schema, for every column with a value-list `check` constraint. */
export const DB_ENUM_COLUMNS = {
  "subscriptions.status": subscriptionStatus,
  "creator_profiles.experience_level": experienceLevel,
  "creator_profiles.onboarding_status": onboardingStatus,
  "content_ideas.difficulty": difficulty,
  "content_ideas.audience_fit": signalLevel,
  "content_ideas.evidence_strength": signalLevel,
  "content_ideas.trend_signal": signalLevel,
  "content_ideas.content_gap": signalLevel,
  "content_ideas.status": ideaStatus,
  "content_ideas.source": authorSource,
  "content_items.status": contentItemStatus,
  "content_versions.source": authorSource,
  "analytics_snapshots.source": analyticsSource,
  "creator_insights.insight_type": insightType,
  "creator_insights.confidence": signalLevel,
  "creator_insights.status": insightStatus,
  "ai_generations.status": generationStatus,
} as const;
