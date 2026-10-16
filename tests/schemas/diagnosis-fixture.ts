import type { Diagnosis } from "@/lib/schemas/diagnosis";

/** A valid diagnosis as the model (and app schema) would return it. */
export const validDiagnosis: Diagnosis = {
  headline: "Your question hook pulled more viewers in than usual.",
  what_happened: "This post got 2,300 views against your usual 1,100, with engagement close to normal.",
  factors: [
    {
      factor: "hook",
      observation: "You opened with a direct question instead of a statement.",
      evidence: "2,300 views vs usual 1,100; your two other question hooks also beat your usual.",
      confidence: "high",
    },
    {
      factor: "format",
      observation: "Shorter than most of your posts.",
      evidence: "Length 35s; your usual posts run 50-60s.",
      confidence: "medium",
    },
  ],
  next_experiment: {
    change: "Open your next post with a question that names the viewer's problem.",
    why: "Question hooks have done better for you three times now.",
    how_to_tell: "Views above your usual 1,100 after a week.",
    idea: { topic: "Why your squats hurt your knees", angle: "Open on the question, fix it in 30s", format: "short" },
  },
  caveats: [],
};
