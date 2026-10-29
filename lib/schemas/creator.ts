import { z } from "zod";
import { experienceLevel } from "./enums";
import { CREATOR_GOALS, PLATFORMS, type Platform } from "./labels";

// Creator identity (onboarding input) and the persistent strategy.
//
// `creator_profiles.platforms` and `.goals` are unconstrained `text[]`; the
// closed vocabularies live in code so adding a platform needs no migration.
// Their value lists and labels are in the zod-free ./labels (client components
// import them from there) and are re-exported here for server code.
export { EXPERIENCE_LABELS, GOAL_LABELS, PLATFORM_LABELS } from "./labels";
export type { CreatorGoal, Platform } from "./labels";

export const platform = z.enum(PLATFORMS);
export const creatorGoal = z.enum(CREATOR_GOALS);

const unique = <T>(items: T[]) => new Set(items).size === items.length;

const listOf = (maxItems: number, maxLength: number, label: string) =>
  z
    .array(z.string().trim().max(maxLength, { error: `Keep each ${label} under ${maxLength} characters.` }))
    .transform((items) => [...new Set(items.filter((item) => item !== ""))])
    .pipe(z.array(z.string()).max(maxItems, { error: `Add at most ${maxItems} ${label}s.` }));

// ---------------------------------------------------------------------------
// Onboarding input (validated server-side in the actions)
// ---------------------------------------------------------------------------

export const creatorProfileInput = z.object({
  niche: z
    .string()
    .trim()
    .min(2, { error: "Tell us your niche in a few words." })
    .max(120, { error: "Keep your niche under 120 characters." }),
  audience_description: z
    .string()
    .trim()
    .min(10, { error: "Describe who you make content for in at least a sentence." })
    .max(600, { error: "Keep this under 600 characters." }),
  goals: z
    .array(z.enum(creatorGoal.options, { error: "Choose from the listed goals." }))
    .min(1, { error: "Pick at least one goal." })
    .max(3, { error: "Pick up to three goals." })
    .refine(unique, { error: "Each goal can only be picked once." }),
  platforms: z
    .array(z.enum(platform.options, { error: "Choose from the listed platforms." }))
    .min(1, { error: "Pick at least one platform." })
    .refine(unique, { error: "Each platform can only be picked once." }),
  posting_capacity_per_week: z.coerce
    .number({ error: "Enter how many posts you can make per week." })
    .int({ error: "Use a whole number." })
    .min(1, { error: "Plan for at least 1 post a week." })
    .max(30, { error: "30 posts a week is the most we plan for." }),
  experience_level: z.enum(experienceLevel.options, { error: "Choose where you are today." }),
});
export type CreatorProfileInput = z.infer<typeof creatorProfileInput>;

export const brandProfileInput = z.object({
  tone: z
    .string()
    .trim()
    .min(2, { error: "Describe your tone in a few words." })
    .max(200, { error: "Keep your tone under 200 characters." }),
  voice_traits: listOf(8, 40, "trait"),
  do_list: listOf(8, 160, "item"),
  dont_list: listOf(8, 160, "item"),
  sample_text: z
    .string()
    .trim()
    .max(2000, { error: "Keep your sample under 2,000 characters." })
    .transform((value) => (value === "" ? null : value)),
});
export type BrandProfileInput = z.infer<typeof brandProfileInput>;

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

/**
 * Model-facing schema. OpenAI strict mode needs every key present and does
 * not enforce lengths, so bounds live in `strategyOutputFor` instead.
 */
export const strategyModelSchema = z.object({
  positioning: z.string(),
  audience_profile: z.object({
    summary: z.string(),
    pain_points: z.array(z.string()),
    desires: z.array(z.string()),
    where_they_are: z.array(z.string()),
  }),
  pillars: z.array(z.object({ name: z.string(), description: z.string() })),
  format_strategy: z.array(
    z.object({
      platform,
      formats: z.array(z.string()),
      cadence: z.string(),
      rationale: z.string(),
    }),
  ),
  voice_profile: z.object({
    summary: z.string(),
    traits: z.array(z.string()),
    sounds_like: z.array(z.string()),
    avoid: z.array(z.string()),
  }),
  growth_objective: z.string(),
  monetization_objective: z.string(),
  thirty_day_plan: z.array(
    z.object({
      week: z.number().int(),
      theme: z.string(),
      focus: z.string(),
      actions: z.array(z.string()),
    }),
  ),
  notes: z.string().nullable(),
});
export type StrategyModelOutput = z.infer<typeof strategyModelSchema>;

const text = (max: number) => z.string().trim().min(1).max(max);
const texts = (min: number, max: number, maxLength: number) => z.array(text(maxLength)).min(min).max(max);

export const audienceProfile = z.object({
  summary: text(600),
  pain_points: texts(2, 6, 200),
  desires: texts(2, 6, 200),
  where_they_are: texts(1, 6, 120),
});
export type AudienceProfile = z.infer<typeof audienceProfile>;

export const formatStrategy = z
  .array(
    z.object({
      platform,
      formats: texts(1, 4, 60),
      cadence: text(120),
      rationale: text(400),
    }),
  )
  .min(1)
  .max(6);
export type FormatStrategy = z.infer<typeof formatStrategy>;

export const voiceProfile = z.object({
  summary: text(400),
  traits: texts(2, 6, 40),
  sounds_like: texts(1, 4, 200),
  avoid: texts(1, 6, 160),
});
export type VoiceProfile = z.infer<typeof voiceProfile>;

export const strategyPillar = z.object({ name: text(60), description: text(300) });
export type StrategyPillar = z.infer<typeof strategyPillar>;

export const planWeek = z.object({
  week: z.number().int().min(1).max(4),
  theme: text(80),
  focus: text(300),
  actions: texts(2, 5, 200),
});

export const thirtyDayPlan = z
  .array(planWeek)
  .length(4)
  .refine((weeks) => weeks.every((week, index) => week.week === index + 1), {
    error: "The plan must cover weeks 1 to 4 in order.",
  });
export type ThirtyDayPlan = z.infer<typeof thirtyDayPlan>;

const strategyOutput = z.object({
  positioning: text(400),
  audience_profile: audienceProfile,
  pillars: z
    .array(strategyPillar)
    .min(3)
    .max(5)
    .refine((pillars) => unique(pillars.map((p) => p.name.toLowerCase())), {
      error: "Pillar names must be unique.",
    }),
  format_strategy: formatStrategy,
  voice_profile: voiceProfile,
  growth_objective: text(400),
  monetization_objective: text(400),
  thirty_day_plan: thirtyDayPlan,
  notes: z
    .string()
    .trim()
    .max(600)
    .nullable()
    .transform((value) => (value ? value : null)),
});
export type StrategyOutput = z.infer<typeof strategyOutput>;

/** App-level validation of a generated strategy for a creator's chosen platforms. */
export function strategyOutputFor(platforms: readonly Platform[]) {
  const allowed = new Set(platforms);
  return strategyOutput.refine(
    (strategy) => strategy.format_strategy.every((entry) => allowed.has(entry.platform)),
    { error: "Format strategy may only cover the creator's platforms.", path: ["format_strategy"] },
  );
}

/** The JSON columns of a stored `creator_strategies` row, re-validated on read. */
export const storedStrategyColumns = z.object({
  audience_profile: audienceProfile,
  format_strategy: formatStrategy,
  voice_profile: voiceProfile,
  thirty_day_plan: thirtyDayPlan,
});
