import "server-only";
import { z } from "zod";
import type { EnvSource } from "@/lib/ai/env";

// Read lazily, on each call, so `next build` and the tests run without a
// YouTube key. Results name the failing variables, never their values.

/** App-wide YouTube Data API units per rolling 24 hours (the project's default quota is 10,000). */
export const DEFAULT_YOUTUBE_DAILY_UNIT_BUDGET = 3_000;

const blankToUndefined = (value: string | undefined) => (value?.trim() ? value : undefined);

const youtubeConfigSchema = z.object({
  YOUTUBE_API_KEY: z.string().trim().min(1),
  YOUTUBE_DAILY_UNIT_BUDGET: z.coerce.number().int().positive().default(DEFAULT_YOUTUBE_DAILY_UNIT_BUDGET),
});

export interface YouTubeConfig {
  apiKey: string;
  dailyUnitBudget: number;
}

export type YouTubeConfigResult = { ok: true; config: YouTubeConfig } | { ok: false; variables: string[] };

export function readYouTubeConfig(source: EnvSource = process.env): YouTubeConfigResult {
  const result = youtubeConfigSchema.safeParse({
    YOUTUBE_API_KEY: source.YOUTUBE_API_KEY,
    YOUTUBE_DAILY_UNIT_BUDGET: blankToUndefined(source.YOUTUBE_DAILY_UNIT_BUDGET),
  });
  if (!result.success) {
    return { ok: false, variables: [...new Set(result.error.issues.map((issue) => issue.path.join(".")))] };
  }
  return {
    ok: true,
    config: { apiKey: result.data.YOUTUBE_API_KEY, dailyUnitBudget: result.data.YOUTUBE_DAILY_UNIT_BUDGET },
  };
}
