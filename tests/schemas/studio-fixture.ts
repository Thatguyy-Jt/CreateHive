import type { ContentPackageModelOutput } from "@/lib/schemas/studio";

/** A model output that passes app validation for a YouTube long-form video. */
export function validPackage(overrides: Partial<ContentPackageModelOutput> = {}): ContentPackageModelOutput {
  return {
    titles: [
      { text: "10-minute squats for busy parents", why: "Names the audience and the time cost." },
      { text: "No gym? Do this after bedtime", why: "Speaks to the after-bedtime window." },
      { text: "The squat routine I do in pyjamas", why: "Personal and specific." },
    ],
    hooks: [
      { text: "You have ten minutes. That's enough.", why: "Removes the main objection first." },
      { text: "Kids asleep? Let's squat.", why: "Matches the moment the viewer is in." },
      { text: "Here's the routine I actually stick to.", why: "Promises something tried, not theory." },
    ],
    script: {
      beats: [
        { label: "Hook", say: "You have ten minutes. That's enough.", show: "Close-up, living room, lights low" },
        { label: "Routine", say: "Three rounds: squats, pauses, pulses.", show: "Full-body demo" },
        { label: "Close", say: "Save this for tonight.", show: null },
      ],
    },
    shot_list: [
      { shot: "Close-up talking to camera", notes: null },
      { shot: "Wide shot of the full routine", notes: "Phone on the bookshelf" },
      { shot: "Timer on screen", notes: null },
    ],
    caption: "Ten minutes after bedtime is enough. Here's the routine.",
    hashtags: ["homeworkout", "busyparents"],
    cta: "Save this for tonight and tell me how round three felt.",
    thumbnail: { concept: "Creator mid-squat beside a clock showing 10:00", overlay_text: "10 MIN" },
    repurposing: [{ platform: "tiktok", format: "60-second short", adaptation: "Cut to the routine only." }],
    ...overrides,
  };
}
