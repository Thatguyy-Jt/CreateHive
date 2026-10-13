import type { OpportunityModelOutput } from "@/lib/schemas/opportunities";

type Idea = OpportunityModelOutput["opportunities"][number];

export const FIXTURE_PILLARS = ["Quick workouts", "Kitchen fuel", "Mindset"];

export function validIdea(index: number, overrides: Partial<Idea> = {}): Idea {
  return {
    topic: `Idea number ${index}`,
    audience_need: "Busy parents who need a short workout they can do at home.",
    angle: "Use the kids' nap time as the workout window.",
    hook: "You have 12 minutes. Let's use them.",
    format: "60-second tutorial",
    platform: "youtube",
    pillar_name: FIXTURE_PILLARS[index % FIXTURE_PILLARS.length],
    rationale: "Fits your quick-workouts pillar and your audience's time limits.",
    cta: "Save this for your next nap window.",
    difficulty: "easy",
    audience_fit: "high",
    evidence: [{ kind: "creator_input", summary: "You said your audience has 20 minutes a day.", signal_ref: null }],
    ...overrides,
  };
}

/** A batch that passes `opportunityOutputFor` for FIXTURE_PILLARS, youtube + tiktok, creator_input. */
export function validBatch(): OpportunityModelOutput {
  return { opportunities: [0, 1, 2, 3, 4].map((index) => validIdea(index)) };
}
