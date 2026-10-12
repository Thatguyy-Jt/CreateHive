import type { StrategyModelOutput } from "@/lib/schemas/creator";

/** A valid model output for a creator on YouTube and TikTok. */
export function validStrategy(overrides: Partial<StrategyModelOutput> = {}): StrategyModelOutput {
  return {
    positioning: "I help busy parents get fit at home in 20 minutes a day.",
    audience_profile: {
      summary: "Parents of young kids with little time and no gym.",
      pain_points: ["No time", "Low energy"],
      desires: ["Feel strong", "Set an example"],
      where_they_are: ["TikTok", "Parenting Facebook groups"],
    },
    pillars: [
      { name: "Quick workouts", description: "Follow-along sessions under 20 minutes." },
      { name: "Family food", description: "Simple meals the whole family eats." },
      { name: "Mindset", description: "Staying consistent when life is chaotic." },
    ],
    format_strategy: [
      { platform: "youtube", formats: ["Follow-along"], cadence: "1 per week", rationale: "Long-form builds trust." },
      { platform: "tiktok", formats: ["Short tips"], cadence: "2 per week", rationale: "Short clips reach new parents." },
    ],
    voice_profile: {
      summary: "Warm, practical and honest.",
      traits: ["Warm", "Practical"],
      sounds_like: ["You don't need an hour. You need 20 minutes and a chair."],
      avoid: ["Shaming"],
    },
    growth_objective: "Build a consistent posting habit and learn which topics resonate.",
    monetization_objective: "Start an email list for a future program.",
    thirty_day_plan: [1, 2, 3, 4].map((week) => ({
      week,
      theme: `Theme ${week}`,
      focus: `Focus for week ${week}.`,
      actions: ["Film two workouts", "Reply to every comment"],
    })),
    notes: null,
    ...overrides,
  };
}
