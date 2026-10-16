import type { PromptDefinition } from "../types";
import { contentOpportunitiesV2, type ContentOpportunitiesV2Input } from "./v2";

export type ContentOpportunitiesV3Input = ContentOpportunitiesV2Input;

/**
 * Opportunity Agent (AGENTS.md §8), v3: v2 plus an explicit rule for the
 * creator's learned insights (Phase 5 learning loop). Input and output are
 * unchanged.
 */
export const contentOpportunitiesV3: PromptDefinition<"content_opportunities", ContentOpportunitiesV3Input> = {
  ...contentOpportunitiesV2,
  version: "v3",
  system: [
    contentOpportunitiesV2.system,
    "",
    "Learned insights (the learned_insights section, when present):",
    "- These are patterns from this creator's own results, each with a confidence and the number of posts (n) behind it.",
    "- Lean on high and medium confidence insights when choosing topics, hooks and formats. Treat low confidence ones",
    "  as something worth testing, not a rule.",
    "- Never let an insight override their pillars, platforms, voice or never-do list.",
    "- When an idea builds on an insight, add a creator_history evidence item that names the pattern, for example",
    '  "Your how-to posts with a question hook have done better than your usual (4 posts)".',
    "- Per-post results show how each post compared with the creator's usual. Never cite a number that is not there.",
  ].join("\n"),
};
