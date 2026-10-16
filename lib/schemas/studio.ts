import { z } from "zod";
import { AI_ERRORS, type AiErrorCode } from "@/lib/ai/errors";
import { platform, PLATFORM_LABELS, type Platform } from "./creator";

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
// Sections (editing and section-level regeneration)
// ---------------------------------------------------------------------------

export const SECTION_KEYS = ["titles", "hooks", "script", "shot_list", "caption", "cta", "thumbnail", "repurposing"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const sectionKey = z.enum(SECTION_KEYS);

/** The package fields each section owns. Caption owns its hashtags. */
export const SECTION_FIELDS: Record<SectionKey, readonly (keyof StudioPackage)[]> = {
  titles: ["titles"],
  hooks: ["hooks"],
  script: ["script"],
  shot_list: ["shot_list"],
  caption: ["caption", "hashtags"],
  cta: ["cta"],
  thumbnail: ["thumbnail"],
  repurposing: ["repurposing"],
};

export const SECTION_LABELS: Record<SectionKey, string> = {
  titles: "Titles",
  hooks: "Hooks",
  script: "Script",
  shot_list: "Shot list",
  caption: "Caption",
  cta: "Call to action",
  thumbnail: "Thumbnail",
  repurposing: "Repurposing",
};

/** One section's fields of a package (see `SECTION_FIELDS`). */
export type SectionValue = Partial<StudioPackage>;

const mask = (section: SectionKey) =>
  Object.fromEntries(SECTION_FIELDS[section].map((field) => [field, true])) as Record<keyof StudioPackage, true>;

/** One section of a package, picked out (for the editor's initial value and for merging). */
export function pickSection(pkg: StudioPackage, section: SectionKey): SectionValue {
  return Object.fromEntries(SECTION_FIELDS[section].map((field) => [field, pkg[field]])) as SectionValue;
}

/**
 * Validates a browser-sent value for one section against that section's part
 * of `studioPackage`: unknown keys are stripped and strings trimmed.
 */
export function sectionInputFor(section: SectionKey) {
  return studioPackage.pick(mask(section));
}

/** Creator edits: package bounds plus "repurposing targets one of my platforms". No AI-only format rules. */
export function userPackageFor(options: { platforms: readonly Platform[] }) {
  const platforms = new Set<string>(options.platforms);
  return studioPackage.superRefine((pkg, ctx) => {
    pkg.repurposing.forEach((item, index) => {
      if (!platforms.has(item.platform)) {
        ctx.addIssue({
          code: "custom",
          path: ["repurposing", index, "platform"],
          message: "Repurposing must target one of your platforms.",
        });
      }
    });
  });
}

/**
 * Model-facing schema for regenerating one section (strict: every key
 * present). A regenerated thumbnail is never null, so regeneration can't
 * silently delete it.
 */
export function sectionModelSchemaFor(section: SectionKey, platforms: readonly Platform[]) {
  const full = contentPackageModelSchemaFor(platforms);
  if (section === "thumbnail") {
    return z.object({ thumbnail: z.object({ concept: z.string(), overlay_text: z.string().nullable() }) });
  }
  return full.pick(mask(section));
}
export type SectionModelOutput = z.infer<ReturnType<typeof sectionModelSchemaFor>>;

/** App validation of a regenerated section: package bounds plus the section's AI rules. */
export function sectionOutputFor(section: SectionKey, options: { platforms: readonly Platform[]; video: boolean }) {
  const platforms = new Set<string>(options.platforms);
  return studioPackage.pick(mask(section)).superRefine((value: Partial<StudioPackage>, ctx) => {
    if (section === "shot_list") {
      const min = options.video ? 3 : 1;
      if ((value.shot_list ?? []).length < min) {
        ctx.addIssue({ code: "custom", path: ["shot_list"], message: `Needs at least ${min} shots.` });
      }
    }
    if (section === "thumbnail" && !value.thumbnail) {
      ctx.addIssue({ code: "custom", path: ["thumbnail"], message: "A regenerated thumbnail can't be empty." });
    }
    (value.repurposing ?? []).forEach((item, index) => {
      if (!platforms.has(item.platform)) {
        ctx.addIssue({
          code: "custom",
          path: ["repurposing", index, "platform"],
          message: "Repurposing must target one of the creator's platforms.",
        });
      }
    });
  });
}

const FIELD_NAMES: Record<string, string> = {
  titles: "Title",
  hooks: "Hook",
  beats: "Beat",
  shot_list: "Shot",
  repurposing: "Repurposing idea",
  hashtags: "Hashtag",
  caption: "Caption",
  cta: "Call to action",
  thumbnail: "Thumbnail",
  text: "text",
  why: "why it works",
  label: "label",
  say: "what to say",
  show: "what to show",
  shot: "description",
  notes: "notes",
  concept: "concept",
  overlay_text: "text on image",
  format: "format",
  adaptation: "adaptation",
  platform: "platform",
};

/** One validation issue as a sentence a creator can act on, e.g. "Title 2 text is too long (max 100 characters)." */
export function describeIssue(issue: z.core.$ZodIssue): string {
  const words: string[] = [];
  for (const key of issue.path) {
    if (typeof key === "number") words.push(String(key + 1));
    else if (key !== "script" && FIELD_NAMES[String(key)]) words.push(FIELD_NAMES[String(key)]);
  }
  const subject = words.join(" ") || "This section";
  const limit = "maximum" in issue ? Number(issue.maximum) : "minimum" in issue ? Number(issue.minimum) : 0;
  const isString = "origin" in issue && issue.origin === "string";
  if (issue.code === "too_big") return isString ? `${subject} is too long (max ${limit} characters).` : `${subject}: use at most ${limit}.`;
  if (issue.code === "too_small") return isString ? `${subject} can't be empty.` : `${subject}: use at least ${limit}.`;
  if (issue.code === "custom") return issue.message;
  return `Check ${subject.toLowerCase()}.`;
}

/** Version notes are server constants, never creator text. They also label versions in History. */
export const GENERATED_NOTE = "Generated package";
export const REGENERATED_NOTE_PREFIX = "Regenerated ";
export const editedNote = (section: SectionKey) => `Edited ${SECTION_LABELS[section].toLowerCase()}`;
export const regeneratedNote = (section: SectionKey) => `${REGENERATED_NOTE_PREFIX}${SECTION_LABELS[section].toLowerCase()}`;
export const restoredNote = (versionNo: number) => `Restored version ${versionNo}`;

// ---------------------------------------------------------------------------
// Plain text (Copy, Copy all, Download)
// ---------------------------------------------------------------------------

const numbered = (lines: string[]) => lines.map((line, index) => `${index + 1}. ${line}`).join("\n");

/** Each section as plain text; an empty string for a section with nothing in it. */
export function sectionTexts(pkg: StudioPackage): Record<SectionKey, string> {
  const hashtags = pkg.hashtags.map((tag) => `#${tag}`).join(" ");
  return {
    titles: numbered(pkg.titles.map((title) => title.text)),
    hooks: numbered(pkg.hooks.map((hook) => hook.text)),
    script: pkg.script.beats
      .map((beat) => [beat.label, `Say: ${beat.say}`, beat.show ? `Show: ${beat.show}` : null].filter(Boolean).join("\n"))
      .join("\n\n"),
    shot_list: numbered(pkg.shot_list.map((shot) => (shot.notes ? `${shot.shot} (${shot.notes})` : shot.shot))),
    caption: hashtags ? `${pkg.caption}\n\n${hashtags}` : pkg.caption,
    cta: pkg.cta,
    thumbnail: pkg.thumbnail
      ? [pkg.thumbnail.concept, pkg.thumbnail.overlay_text ? `Text on image: ${pkg.thumbnail.overlay_text}` : null]
          .filter(Boolean)
          .join("\n")
      : "",
    repurposing: pkg.repurposing
      .map((item) => `${PLATFORM_LABELS[item.platform]} · ${item.format}: ${item.adaptation}`)
      .join("\n"),
  };
}

/** The whole package with section headings, as Copy all and Download produce it. */
export function packageToText(pkg: StudioPackage, title?: string): string {
  const texts = sectionTexts(pkg);
  const parts = SECTION_KEYS.filter((key) => texts[key]).map((key) => `${SECTION_LABELS[key].toUpperCase()}\n${texts[key]}`);
  return [title?.trim() || null, ...parts].filter(Boolean).join("\n\n") + "\n";
}

/** A safe download name: `10-minute-squats.txt`. */
export function downloadFileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${slug || "content-package"}.txt`;
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
  | "db_error"
  | "version_conflict"
  | "version_limit"
  | "section_limit"
  | "invalid_input"
  | "version_not_found"
  | "already_latest"
  | "unreadable_version";

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
    message: "Something went wrong on our side. Please try again in a moment.",
    retryable: true,
  },
  version_conflict: {
    message: "This package changed in another tab. Refresh to see the latest.",
    retryable: false,
  },
  version_limit: {
    message: "This item has reached 100 versions. Discard it and start again from the idea to keep editing.",
    retryable: false,
  },
  section_limit: {
    message: "You've regenerated 10 sections of this item in the last 24 hours. Edit it by hand, or try again tomorrow.",
    retryable: false,
  },
  invalid_input: {
    message: "Some of that doesn't fit. Check the fields and try again.",
    retryable: false,
  },
  version_not_found: {
    message: "We couldn't find that version. Go back to the latest version.",
    retryable: false,
  },
  already_latest: {
    message: "This is already your latest version.",
    retryable: false,
  },
  unreadable_version: {
    message: "This version couldn't be shown, so it can't be used. Regenerate the whole package to continue.",
    retryable: false,
  },
};
