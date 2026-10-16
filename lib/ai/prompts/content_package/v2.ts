import type { PromptDefinition } from "../types";
import { contentPackageV1, type ContentPackageV1Input } from "./v1";

export type ContentPackageV2Input = ContentPackageV1Input;

/**
 * Content Agent (AGENTS.md §8), v2: v1 plus an explicit rule for the
 * creator's learned insights (Phase 5 learning loop). Input and output are
 * unchanged.
 */
export const contentPackageV2: PromptDefinition<"content_package", ContentPackageV2Input> = {
  ...contentPackageV1,
  version: "v2",
  system: [
    contentPackageV1.system,
    "",
    "Learned insights (the learned_insights section, when present):",
    "- These are patterns from this creator's own results (hooks, formats, lengths, calls to action), each with a",
    "  confidence and the number of posts (n) behind it.",
    "- Apply high and medium confidence insights where they fit this idea, for example the hook style or length",
    "  that has worked for them. Treat low confidence ones as optional.",
    "- Never let an insight override the idea's angle, the platform's conventions, their voice or never-do list.",
    "- When a why line relies on an insight, say it is based on their own past posts. Never cite a number that is",
    "  not in the input, and never predict results.",
  ].join("\n"),
};
