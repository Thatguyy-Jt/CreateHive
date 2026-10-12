import { z } from "zod";

// Read lazily, on each call, so `next build` and the test suite run without an
// OpenAI key. Results name the failing variables, never their values.

export type EnvSource = Record<string, string | undefined>;

export const DEFAULT_DAILY_GENERATION_LIMIT = 25;

// One definition of the cap, shared by the AI service and the settings page.
const dailyLimitSchema = z.coerce.number().int().positive().default(DEFAULT_DAILY_GENERATION_LIMIT);

// A blank variable means "use the default", not a misconfiguration.
const blankToUndefined = (value: string | undefined) => (value?.trim() ? value : undefined);

const aiConfigSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1),
  AI_DAILY_GENERATION_LIMIT: dailyLimitSchema,
  AI_MODEL_QUALITY: z.string().trim().optional(),
  AI_MODEL_FAST: z.string().trim().optional(),
});

export interface AiConfig {
  apiKey: string;
  dailyGenerationLimit: number;
  modelOverrides: { quality?: string; fast?: string };
}

export type AiConfigResult = { ok: true; config: AiConfig } | { ok: false; variables: string[] };

/** Kill switch. Only the exact value `false` (any case) turns AI off. */
export function isAiEnabled(source: EnvSource = process.env): boolean {
  return source.AI_ENABLED?.trim().toLowerCase() !== "false";
}

/**
 * The per-creator rolling 24-hour cap, readable without the OpenAI key (the
 * settings page shows it). Returns null when the value is invalid; the AI
 * service treats that as `not_configured`.
 */
export function readDailyGenerationLimit(source: EnvSource = process.env): number | null {
  const result = dailyLimitSchema.safeParse(blankToUndefined(source.AI_DAILY_GENERATION_LIMIT));
  return result.success ? result.data : null;
}

export function readAiConfig(source: EnvSource = process.env): AiConfigResult {
  const result = aiConfigSchema.safeParse({
    OPENAI_API_KEY: source.OPENAI_API_KEY,
    AI_DAILY_GENERATION_LIMIT: blankToUndefined(source.AI_DAILY_GENERATION_LIMIT),
    AI_MODEL_QUALITY: blankToUndefined(source.AI_MODEL_QUALITY),
    AI_MODEL_FAST: blankToUndefined(source.AI_MODEL_FAST),
  });
  if (!result.success) {
    return { ok: false, variables: [...new Set(result.error.issues.map((issue) => issue.path.join(".")))] };
  }
  const env = result.data;
  return {
    ok: true,
    config: {
      apiKey: env.OPENAI_API_KEY,
      dailyGenerationLimit: env.AI_DAILY_GENERATION_LIMIT,
      modelOverrides: { quality: env.AI_MODEL_QUALITY, fast: env.AI_MODEL_FAST },
    },
  };
}
