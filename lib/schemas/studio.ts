import { z } from "zod";
import { AI_ERRORS, type AiErrorCode } from "@/lib/ai/errors";
import { platform, type Platform } from "./creator";

// Content Studio packages (Content Agent, AGENTS.md §8). A package is stored
// in `content_versions.content` as `{ schema_version: 1, package }`.
//
// `./content-package` holds an earlier, looser per-section shape that nothing
// stores yet; this file is the shape Studio writes and reads.

export const STUDIO_PACKAGE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Format rules
// ---------------------------------------------------------------------------

const WRITTEN_FORMAT = /\b(post|posts|thread|carousel|article|newsletter|tweet|text|blog|written|slides?|infographic|poll)\b/i;
const VIDEO_FORMAT =
  /\b(video|reels?|shorts?|tiktok|vlog|tutorial|live|stream|clip|long-?form|episode|walkthrough|talking.head)\b|\d+\s*-?\s*(s|secs?|seconds?|mins?|minutes?)\b/i;
const SHORT_VIDEO = /\b(shorts?|reels?)\b|\d+\s*-?\s*(s|secs?|seconds?)\b/i;

export interface FormatRules {
  /** Video formats need a shot list of at least 3 shots. */
  video: boolean;
  /** YouTube long-form needs a thumbnail concept. */
  thumbnailRequired: boolean;
}

/**
 * What a package must contain for this platform and format. A written format
 * name wins over the platform; otherwise YouTube and TikTok default to video.
 * Unclear formats get the lenient rules: the prompt still asks for what fits.
 */
export function formatRulesFor(target: Platform | null, format: string | null): FormatRules {
  const name = format ?? "";
  const written = WRITTEN_FORMAT.test(name);
  const video = !written && (VIDEO_FORMAT.test(name) || target === "youtube" || target === "tiktok");
  return { video, thumbnailRequired: video && target === "youtube" && !SHORT_VIDEO.test(name) };
}

// ---------------------------------------------------------------------------
// Model-facing schema
// ---------------------------------------------------------------------------

/**
 * OpenAI strict mode: every key present, `nullable()` instead of
 * `optional()`. Lengths and counts aren't enforced by the provider, so they
 * live in `contentPackageOutputFor`. `platforms` must not be empty.
 */
export function contentPackageModelSchemaFor(platforms: readonly Platform[]) {
  const choice = z.object({ text: z.string(), why: z.string() });
  return z.object({
    titles: z.array(choice),
    hooks: z.array(choice),
    script: z.object({
      beats: z.array(z.object({ label: z.string(), say: z.string(), show: z.string().nullable() })),
    }),
    shot_list: z.array(z.object({ shot: z.string(), notes: z.string().nullable() })),
    caption: z.string(),
    hashtags: z.array(z.string()),
    cta: z.string(),
    thumbnail: z.object({ concept: z.string(), overlay_text: z.string().nullable() }).nullable(),
    repurposing: z.array(
      z.object({ platform: z.enum(platforms as [Platform, ...Platform[]]), format: z.string(), adaptation: z.string() }),
    ),
  });
}
export type ContentPackageModelOutput = z.infer<ReturnType<typeof contentPackageModelSchemaFor>>;

// ---------------------------------------------------------------------------
// App validation and the stored shape
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max);
/** Blank becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .nullable()
    .transform((value) => (value?.trim() ? value.trim() : null))
    .pipe(z.string().max(max).nullable());

/** Leading `#` and spaces removed, blanks dropped, case-insensitive duplicates dropped. */
export function normalizeHashtags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const clean = tag.replace(/\s+/g, "").replace(/^#+/, "");
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out;
}

const choice = (max: number) => z.object({ text: text(max), why: text(160) });

/** Bounds every package must meet, whoever it was generated for. */
export const studioPackage = z.object({
  titles: z.array(choice(100)).length(3),
  hooks: z.array(choice(200)).length(3),
  script: z.object({
    beats: z.array(z.object({ label: text(60), say: text(1200), show: optionalText(300) })).min(3).max(12),
  }),
  shot_list: z.array(z.object({ shot: text(200), notes: optionalText(200) })).max(15),
  caption: text(2200),
  hashtags: z
    .array(z.string())
    .transform(normalizeHashtags)
    .pipe(z.array(z.string().max(40)).max(8)),
  cta: text(200),
  thumbnail: z.object({ concept: text(300), overlay_text: optionalText(40) }).nullable(),
  repurposing: z.array(z.object({ platform, format: text(60), adaptation: text(300) })).max(3),
});
export type StudioPackage = z.infer<typeof studioPackage>;

/** App validation of one generated package for this creator's platforms and this item's format. */
export function contentPackageOutputFor(options: {
  platforms: readonly Platform[];
  primaryPlatform: Platform | null;
  format: string | null;
}) {
  const platforms = new Set<string>(options.platforms);
  const rules = formatRulesFor(options.primaryPlatform, options.format);
  return studioPackage.superRefine((pkg, ctx) => {
    pkg.repurposing.forEach((item, index) => {
      if (!platforms.has(item.platform)) {
        ctx.addIssue({
          code: "custom",
          path: ["repurposing", index, "platform"],
          message: "Repurposing must target one of the creator's platforms.",
        });
      }
    });
    if (rules.video && pkg.shot_list.length < 3) {
      ctx.addIssue({ code: "custom", path: ["shot_list"], message: "Video formats need at least 3 shots." });
    }
    if (rules.thumbnailRequired && pkg.thumbnail === null) {
      ctx.addIssue({ code: "custom", path: ["thumbnail"], message: "YouTube long-form needs a thumbnail concept." });
    }
  });
}

/** `content_versions.content` as written by Studio. */
export const storedStudioVersion = z.object({
  schema_version: z.literal(STUDIO_PACKAGE_SCHEMA_VERSION),
  package: studioPackage,
});

/**
 * Reads a stored version. An unknown `schema_version` or content that no
 * longer validates is "unreadable": the page offers regeneration instead of
 * crashing.
 */
export function parseStoredPackage(content: unknown): { ok: true; package: StudioPackage } | { ok: false } {
  const parsed = storedStudioVersion.safeParse(content);
  return parsed.success ? { ok: true, package: parsed.data.package } : { ok: false };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type StudioErrorCode =
  | AiErrorCode
  | "not_found"
  | "not_editable"
  | "missing_context"
  | "item_limit"
  | "in_progress"
  | "idea_not_found"
  | "idea_not_available"
  | "not_draft"
  | "db_error";

/** Creator-facing messages: what happened and what to do next. */
export const STUDIO_ERRORS: Record<StudioErrorCode, { message: string; retryable: boolean }> = {
  ...AI_ERRORS,
  invalid_output: { message: "Your package didn't come out right. Please try again.", retryable: true },
  persistence_error: {
    message: "We couldn't save your package. Please try again in a moment.",
    retryable: true,
  },
  limit_reached: {
    message:
      "You've used all of your AI generations for now. Your allowance frees up as generations age past 24 hours.",
    retryable: false,
  },
  not_found: {
    message: "We couldn't find that Studio item. Refresh the page and try again.",
    retryable: false,
  },
  not_editable: {
    message: "This item is published or archived, so a package can't be generated for it.",
    retryable: false,
  },
  missing_context: {
    message: "Finish your profile and strategy first, so your package can sound like you.",
    retryable: false,
  },
  item_limit: {
    message: "You've made 5 packages for this item in the last 24 hours. Try again tomorrow.",
    retryable: false,
  },
  in_progress: {
    message: "We're already creating a package for you. Give it a minute, then refresh the page.",
    retryable: false,
  },
  idea_not_found: {
    message: "We couldn't find that idea. Refresh the page and try again.",
    retryable: false,
  },
  idea_not_available: {
    message: "That idea isn't saved any more. Refresh the page to see its current state.",
    retryable: false,
  },
  not_draft: {
    message: "This item is already scheduled or published. Refresh the page to see its current state.",
    retryable: false,
  },
  db_error: {
    message: "We couldn't open Studio for this right now. Please try again in a moment.",
    retryable: true,
  },
};
