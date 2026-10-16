import { isAiKind, type AiKind } from "./prompts/registry";

export type AiTier = "quality" | "fast";
export type ReasoningEffort = "low" | "medium";

/**
 * Model per tier. IDs, prices and supported efforts from OpenAI's models page
 * (checked 2026-10-11); re-check before deploying. `AI_MODEL_QUALITY` and
 * `AI_MODEL_FAST` override the IDs without a code change.
 */
export const AI_TIERS: Record<AiTier, { defaultModel: string; reasoning: ReasoningEffort }> = {
  // Strategy, opportunities, content packages, diagnosis.
  quality: { defaultModel: "gpt-6.1-sol", reasoning: "medium" },
  // Rewrites, variations, tagging.
  fast: { defaultModel: "gpt-6-luna", reasoning: "low" },
};

interface TaskRoute {
  tier: AiTier;
  /** Ceiling on output tokens, reasoning tokens included. */
  maxOutputTokens: number;
}

/** One routing table: each task kind picks a tier, never a model directly. */
export const AI_TASK_ROUTES: Record<AiKind, TaskRoute> = {
  smoke_test: { tier: "fast", maxOutputTokens: 1_000 },
  creator_strategy: { tier: "quality", maxOutputTokens: 8_000 },
  content_opportunities: { tier: "quality", maxOutputTokens: 6_000 },
  weekly_plan: { tier: "quality", maxOutputTokens: 3_000 },
  content_package: { tier: "quality", maxOutputTokens: 8_000 },
  content_section: { tier: "quality", maxOutputTokens: 4_000 },
  content_diagnosis: { tier: "quality", maxOutputTokens: 3_000 },
};

export interface ResolvedRoute {
  tier: AiTier;
  modelId: string;
  reasoning: ReasoningEffort;
  maxOutputTokens: number;
}

export function modelForTier(tier: AiTier, overrides: Partial<Record<AiTier, string>> = {}): string {
  return overrides[tier] || AI_TIERS[tier].defaultModel;
}

export function routeTask(kind: AiKind, overrides: Partial<Record<AiTier, string>> = {}): ResolvedRoute {
  if (!isAiKind(kind)) throw new Error(`Unknown AI task kind: ${String(kind)}`);
  const { tier, maxOutputTokens } = AI_TASK_ROUTES[kind];
  return {
    tier,
    modelId: modelForTier(tier, overrides),
    reasoning: AI_TIERS[tier].reasoning,
    maxOutputTokens,
  };
}
