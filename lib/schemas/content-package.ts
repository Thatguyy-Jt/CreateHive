import { z } from "zod";
import { parseWith } from "./parse";

// Shape of `content_versions.content`. Every section is optional so one
// section can be generated or regenerated without the others (AGENTS.md §9).
// Unknown keys are stripped rather than rejected.

const text = (max: number) => z.string().trim().min(1).max(max);

export const hook = z.object({
  text: text(500),
  style: text(60).optional(),
});

export const scriptSection = z.object({
  heading: text(120).optional(),
  body: text(5000),
  duration_seconds: z.number().int().positive().max(3600).optional(),
});

export const script = z.object({
  sections: z.array(scriptSection).min(1).max(30),
});

export const shot = z.object({
  description: text(1000),
  shot_type: text(60).optional(),
  duration_seconds: z.number().positive().max(3600).optional(),
});

export const caption = z.object({
  text: text(5000),
  hashtags: z.array(text(100)).max(30).optional(),
  platform: text(40).optional(),
});

export const callToAction = z.object({
  text: text(300),
});

export const thumbnailConcept = z.object({
  description: text(1000),
  text_overlay: text(100).optional(),
});

export const repurposingSuggestion = z.object({
  platform: text(40),
  format: text(60),
  notes: text(1000).optional(),
});

export const contentPackage = z.object({
  hooks: z.array(hook).max(10).optional(),
  script: script.optional(),
  shot_list: z.array(shot).max(50).optional(),
  caption: caption.optional(),
  cta: callToAction.optional(),
  titles: z.array(text(150)).max(10).optional(),
  thumbnail_concept: thumbnailConcept.optional(),
  repurposing: z.array(repurposingSuggestion).max(10).optional(),
});
export type ContentPackage = z.infer<typeof contentPackage>;
export type ContentPackageSection = keyof ContentPackage;

export const parseContentPackage = (input: unknown) => parseWith(contentPackage, input);
