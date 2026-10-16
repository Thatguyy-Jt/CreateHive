import { contentDiagnosisV1 } from "./content_diagnosis/v1";
import { contentOpportunitiesV3 } from "./content_opportunities/v3";
import { contentPackageV2 } from "./content_package/v2";
import { contentSectionV1 } from "./content_section/v1";
import { creatorInsightsV1 } from "./creator_insights/v1";
import { creatorStrategyV1 } from "./creator_strategy/v1";
import { smokeTestV1 } from "./smoke_test/v1";
import { weeklyPlanV1 } from "./weekly_plan/v1";

/**
 * The active prompt version for every AI task kind. Adding a task means adding
 * its prompt here and its route in `../models.ts`; the compiler enforces both.
 */
export const ACTIVE_PROMPTS = {
  smoke_test: smokeTestV1,
  creator_strategy: creatorStrategyV1,
  content_opportunities: contentOpportunitiesV3,
  weekly_plan: weeklyPlanV1,
  content_package: contentPackageV2,
  content_section: contentSectionV1,
  content_diagnosis: contentDiagnosisV1,
  creator_insights: creatorInsightsV1,
} as const;

export type AiKind = keyof typeof ACTIVE_PROMPTS;

export type PromptInput<K extends AiKind> = Parameters<(typeof ACTIVE_PROMPTS)[K]["buildUser"]>[0];

export function isAiKind(value: string): value is AiKind {
  return Object.hasOwn(ACTIVE_PROMPTS, value);
}

export function getPrompt<K extends AiKind>(kind: K): (typeof ACTIVE_PROMPTS)[K] {
  if (!isAiKind(kind)) throw new Error(`Unknown AI task kind: ${String(kind)}`);
  return ACTIVE_PROMPTS[kind];
}
