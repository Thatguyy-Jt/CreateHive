import { z } from "zod";
import { AI_ERRORS, type AiErrorCode } from "@/lib/ai/errors";
import { parseCount, parseDuration } from "@/lib/breakdown/counts";
import { COUNT_FIELDS, VIEWS_REQUIRED, type CountField } from "@/lib/breakdown/platform-guides";
import { parseVideoUrl, URL_MESSAGES, type ParsedVideoUrl } from "@/lib/breakdown/url";
import { isDateKey } from "@/lib/calendar/dates";
import { signalLevel, type SignalLevel } from "./enums";
import { platform, type Platform } from "./creator";
import { parseWith } from "./parse";

// Video Breakdown (prompts/video-breakdown.md): why a reference video worked
// and the creator's own version of it. Stored in `video_breakdowns` as
// `{ schema_version: 1, ... }`.

export const BREAKDOWN_SCHEMA_VERSION = 1;

export const CAPTION_MAX = 3_000;
export const TRANSCRIPT_MAX = 8_000;
export const COMMENT_MAX = 300;
export const COMMENTS_MAX = 20;
export const NOTE_MAX = 500;

export const ELEMENTS = [
  "hook",
  "topic",
  "title",
  "format",
  "length",
  "structure",
  "audience_response",
  "cta",
  "other",
] as const;
export type Element = (typeof ELEMENTS)[number];

export const ELEMENT_LABELS: Record<Element, string> = {
  hook: "Hook",
  topic: "Topic",
  title: "Title",
  format: "Format",
  length: "Length",
  structure: "Structure",
  audience_response: "Audience response",
  cta: "Call to action",
  other: "Other",
};

export const MIN_ELEMENTS = 2;
export const MAX_ELEMENTS = 5;
export const HOOK_COUNT = 3;
export const MAX_CAVEATS = 3;

// ---------------------------------------------------------------------------
// Form input
// ---------------------------------------------------------------------------

export const FORM_FIELDS = [
  "url",
  ...COUNT_FIELDS,
  "duration",
  "posted_on",
  "caption",
  "transcript",
  "top_comments",
  "note",
  "target_platform",
] as const;
export type BreakdownFormField = (typeof FORM_FIELDS)[number];
export type BreakdownFormValues = Record<BreakdownFormField, string>;

export type Counts = Record<CountField, number | null>;

/** What the creator gave us, as stored in `video_breakdowns.creator_input` (and reused by "Break it down again"). */
export const creatorInput = z.object({
  counts: z.object(Object.fromEntries(COUNT_FIELDS.map((f) => [f, z.number().int().nonnegative().nullable()])) as Record<
    CountField,
    z.ZodNullable<z.ZodNumber>
  >),
  rounded: z.boolean(),
  duration_seconds: z.number().int().positive().nullable(),
  posted_on: z.string().nullable(),
  caption: z.string().max(CAPTION_MAX),
  transcript: z.string().max(TRANSCRIPT_MAX),
  comments: z.array(z.string().max(COMMENT_MAX)).max(COMMENTS_MAX),
  note: z.string().max(NOTE_MAX),
  target_platform: platform.nullable(),
});
export type CreatorInput = z.infer<typeof creatorInput>;

export interface ParsedBreakdownForm {
  link: ParsedVideoUrl;
  input: CreatorInput;
}

export type BreakdownFormResult =
  | { ok: true; data: ParsedBreakdownForm }
  | { ok: false; fieldErrors: Partial<Record<BreakdownFormField, string>> };

const ENGAGEMENT_FIELDS: readonly CountField[] = ["likes", "comments", "shares", "saves"];

/** One pasted comment per line, trimmed and capped. */
export function splitComments(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().slice(0, COMMENT_MAX))
    .filter(Boolean)
    .slice(0, COMMENTS_MAX);
}

/**
 * Reads the breakdown form. YouTube's numbers come from the API, so its
 * number fields are ignored. Elsewhere views are required where the platform
 * shows them publicly; on LinkedIn and other sites one engagement number is.
 */
export function parseBreakdownForm(values: BreakdownFormValues, now: number): BreakdownFormResult {
  const fieldErrors: Partial<Record<BreakdownFormField, string>> = {};
  const link = parseVideoUrl(values.url);
  if (!link.ok) return { ok: false, fieldErrors: { url: URL_MESSAGES[link.code] } };
  const manual = link.platform !== "youtube";

  const counts = Object.fromEntries(COUNT_FIELDS.map((f) => [f, null])) as Counts;
  let rounded = false;
  let duration: number | null = null;
  let postedOn: string | null = null;
  if (manual) {
    for (const field of COUNT_FIELDS) {
      const parsed = parseCount(values[field]);
      if (!parsed.ok) fieldErrors[field] = "Type the number as the platform shows it, like 1,234 or 1.2K.";
      else {
        counts[field] = parsed.value;
        rounded ||= parsed.rounded && parsed.value !== null;
      }
    }
    const length = parseDuration(values.duration);
    if (!length.ok) fieldErrors.duration = "Type the length like 0:45 or 1:30, or in seconds.";
    else duration = length.value;

    const day = values.posted_on.trim();
    if (day) {
      if (!isDateKey(day) || Date.parse(`${day}T00:00:00Z`) > now) fieldErrors.posted_on = "Pick the day it was posted.";
      else postedOn = day;
    }

    if (!fieldErrors.views && counts.views === null && VIEWS_REQUIRED.has(link.platform)) {
      fieldErrors.views = "Add the views. The guide shows where to find them.";
    }
    if (
      !VIEWS_REQUIRED.has(link.platform) &&
      counts.views === null &&
      ENGAGEMENT_FIELDS.every((f) => counts[f] === null) &&
      ENGAGEMENT_FIELDS.every((f) => !fieldErrors[f])
    ) {
      fieldErrors.likes = "Add at least one number you can see, like reactions or comments.";
    }
  }

  const text = (field: BreakdownFormField, max: number, label: string) => {
    const value = values[field].trim();
    if (value.length > max) fieldErrors[field] = `${label} can be up to ${max.toLocaleString("en-US")} characters.`;
    return value.slice(0, max);
  };
  const caption = text("caption", CAPTION_MAX, "The caption");
  const transcript = text("transcript", TRANSCRIPT_MAX, "The transcript");
  const note = text("note", NOTE_MAX, "Your note");
  const comments = splitComments(values.top_comments);

  const target = platform.safeParse(values.target_platform.trim());
  if (values.target_platform.trim() && !target.success) fieldErrors.target_platform = "Choose one of your platforms.";

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return {
    ok: true,
    data: {
      link: { platform: link.platform, canonicalUrl: link.canonicalUrl, externalId: link.externalId },
      input: {
        counts,
        rounded,
        duration_seconds: duration,
        posted_on: postedOn,
        caption,
        transcript,
        comments,
        note,
        target_platform: target.success ? target.data : null,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Facts and the YouTube data kept with a breakdown
// ---------------------------------------------------------------------------

export const storedFacts = z.object({
  source: z.enum(["youtube_api", "creator_entered"]),
  views: z.number().nullable(),
  likes: z.number().nullable(),
  comments: z.number().nullable(),
  shares: z.number().nullable(),
  saves: z.number().nullable(),
  followers: z.number().nullable(),
  duration_seconds: z.number().nullable(),
  published_at: z.string().nullable(),
  age_days: z.number().nullable(),
  views_per_day: z.number().nullable(),
  engagement_rate: z.number().nullable(),
  views_to_followers: z.number().nullable(),
  rounded: z.boolean(),
  /** Shown as the breakdown's name. */
  title: z.string().nullable(),
  author: z.string().nullable(),
});
export type StoredFacts = z.infer<typeof storedFacts>;

/**
 * YouTube API data, including its facts: everything in here is nulled by the
 * daily job after 30 days. For YouTube rows the `facts` column holds only
 * `emptyFacts("youtube_api")`, so no API statistic outlives that limit.
 */
export const storedSourceData = z.object({
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  channel_title: z.string(),
  published_at: z.string(),
  facts: storedFacts,
});
export type StoredSourceData = z.infer<typeof storedSourceData>;

export function emptyFacts(source: StoredFacts["source"]): StoredFacts {
  return {
    source,
    views: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    followers: null,
    duration_seconds: null,
    published_at: null,
    age_days: null,
    views_per_day: null,
    engagement_rate: null,
    views_to_followers: null,
    rounded: false,
    title: null,
    author: null,
  };
}

// ---------------------------------------------------------------------------
// Model-facing schema (OpenAI strict mode: every key present, no optionals)
// ---------------------------------------------------------------------------

export function breakdownModelSchemaFor(platforms: readonly [Platform, ...Platform[]], pillarNames: readonly [string, ...string[]]) {
  return z.object({
    summary: z.string(),
    why_it_worked: z.array(
      z.object({ element: z.enum(ELEMENTS), observation: z.string(), evidence: z.string(), confidence: signalLevel }),
    ),
    audience_reaction: z.object({ summary: z.string(), themes: z.array(z.string()) }).nullable(),
    your_version: z.object({
      topic: z.string(),
      angle: z.string(),
      hooks: z.array(z.string()),
      format: z.string(),
      platform: z.enum(platforms),
      pillar_name: z.enum(pillarNames as [string, ...string[]]),
      outline: z.array(z.string()),
      title: z.string(),
      cta: z.string(),
      why_it_fits: z.string(),
    }),
    what_not_to_copy: z.array(z.string()),
    caveats: z.array(z.string()),
  });
}
export type BreakdownModelOutput = z.infer<ReturnType<typeof breakdownModelSchemaFor>>;

// ---------------------------------------------------------------------------
// App validation
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max);

/** Lowercased, whitespace-collapsed, for the similarity guard and duplicate hooks. */
export const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

const breakdownShape = z.object({
  summary: text(400),
  why_it_worked: z
    .array(z.object({ element: z.enum(ELEMENTS), observation: text(300), evidence: text(300), confidence: signalLevel }))
    .min(MIN_ELEMENTS)
    .max(MAX_ELEMENTS),
  audience_reaction: z.object({ summary: text(400), themes: z.array(text(120)).max(4) }).nullable(),
  your_version: z.object({
    topic: text(120),
    angle: text(300),
    hooks: z.array(text(200)).length(HOOK_COUNT),
    format: text(60),
    platform,
    pillar_name: text(120),
    outline: z.array(text(200)).min(3).max(6),
    title: text(120),
    cta: text(200),
    why_it_fits: text(400),
  }),
  what_not_to_copy: z.array(text(200)).min(1).max(3),
  caveats: z.array(text(200)).max(MAX_CAVEATS),
});
export type Breakdown = z.infer<typeof breakdownShape>;

/**
 * Validates a generated breakdown for one creator: their platform and pillar,
 * unique hooks, and nothing that repeats the reference video's title.
 */
export function breakdownOutputFor(options: {
  platforms: readonly Platform[];
  pillarNames: readonly string[];
  referenceTitle: string | null;
}) {
  const platforms = new Set<string>(options.platforms);
  const pillars = new Set(options.pillarNames.map(normalizeText));
  const reference = options.referenceTitle ? normalizeText(options.referenceTitle) : null;
  return breakdownShape.superRefine((value, ctx) => {
    const version = value.your_version;
    if (!platforms.has(version.platform)) {
      ctx.addIssue({ code: "custom", path: ["your_version", "platform"], message: "Not one of the creator's platforms." });
    }
    if (!pillars.has(normalizeText(version.pillar_name))) {
      ctx.addIssue({ code: "custom", path: ["your_version", "pillar_name"], message: "Not one of the creator's pillars." });
    }
    const hooks = version.hooks.map(normalizeText);
    if (new Set(hooks).size !== hooks.length) {
      ctx.addIssue({ code: "custom", path: ["your_version", "hooks"], message: "Hooks must be different." });
    }
    if (reference && [normalizeText(version.title), ...hooks].includes(reference)) {
      ctx.addIssue({ code: "custom", path: ["your_version"], message: "Repeats the reference video's title." });
    }
  });
}

export const parseBreakdownOutputFor = (options: Parameters<typeof breakdownOutputFor>[0]) => {
  const schema = breakdownOutputFor(options);
  return (input: unknown) => parseWith(schema, input);
};

// ---------------------------------------------------------------------------
// Honesty rules (deterministic, applied before storing)
// ---------------------------------------------------------------------------

export interface BreakdownEvidence {
  /** A transcript or caption was available, so the hook and structure can be read. */
  hasText: boolean;
  followersKnown: boolean;
  creatorEntered: boolean;
  rounded: boolean;
}

export const FOLLOWERS_UNKNOWN_CAVEAT =
  "We don't know how many followers the poster has, so we can't tell how much of this came from their existing audience.";
export const CREATOR_ENTERED_CAVEAT = "These numbers were entered by you, not fetched from the platform.";
export const ROUNDED_CAVEAT = "Some numbers are rounded as the platform shows them, so rates are approximate.";

const TEXT_ELEMENTS: ReadonlySet<Element> = new Set(["hook", "structure"]);

/**
 * Keeps one video from reading as proof: the hook and structure can't be read
 * confidently without words, and the limits of the numbers are always stated.
 */
export function applyBreakdownHonesty(breakdown: Breakdown, evidence: BreakdownEvidence): { breakdown: Breakdown; capped: boolean } {
  let capped = false;
  const why = breakdown.why_it_worked.map((item) => {
    if (evidence.hasText || !TEXT_ELEMENTS.has(item.element) || item.confidence === ("low" satisfies SignalLevel)) return item;
    capped = true;
    return { ...item, confidence: "low" as const };
  });

  const required = [
    evidence.creatorEntered ? CREATOR_ENTERED_CAVEAT : null,
    evidence.rounded ? ROUNDED_CAVEAT : null,
    evidence.followersKnown ? null : FOLLOWERS_UNKNOWN_CAVEAT,
  ].filter((c): c is string => c !== null);
  const own = breakdown.caveats.filter((c) => !required.includes(c));
  const caveats = [...required, ...own].slice(0, MAX_CAVEATS);

  return { breakdown: { ...breakdown, why_it_worked: why, caveats }, capped };
}

// ---------------------------------------------------------------------------
// Stored rows
// ---------------------------------------------------------------------------

export const storedBreakdown = breakdownShape.extend({
  schema_version: z.literal(BREAKDOWN_SCHEMA_VERSION),
  confidence_capped: z.boolean(),
});
export type StoredBreakdown = z.infer<typeof storedBreakdown>;

export function toStoredBreakdown(breakdown: Breakdown, capped: boolean): StoredBreakdown {
  return { schema_version: BREAKDOWN_SCHEMA_VERSION, confidence_capped: capped, ...breakdown };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type BreakdownErrorCode =
  | AiErrorCode
  | "invalid_input"
  | "not_configured_youtube"
  | "missing_context"
  | "in_progress"
  | "video_unavailable"
  | "budget_exhausted"
  | "youtube_quota"
  | "youtube_busy"
  | "youtube_error"
  | "not_found"
  | "idea_failed";

export const BREAKDOWN_ERRORS: Record<BreakdownErrorCode, { message: string; retryable: boolean }> = {
  ...AI_ERRORS,
  invalid_input: { message: "Check the highlighted fields.", retryable: false },
  upgrade_required: { message: "Video Breakdown is part of Pro. Upgrade to use it.", retryable: false },
  plan_limit: {
    message: "You've used your breakdowns for this month. They free up as older ones pass 30 days.",
    retryable: false,
  },
  not_configured_youtube: {
    message: "YouTube links can't be fetched right now. Try again later, or use a link from another platform.",
    retryable: false,
  },
  missing_context: {
    message: "Build your strategy first, so your version can fit your niche, pillars and voice.",
    retryable: false,
  },
  in_progress: { message: "A breakdown is already running. Wait a moment, then refresh the page.", retryable: false },
  video_unavailable: {
    message: "We couldn't find that video on YouTube. It may be private or deleted. Check the link and try again.",
    retryable: false,
  },
  budget_exhausted: {
    message: "YouTube lookups have reached today's limit for everyone. Please try again tomorrow.",
    retryable: false,
  },
  youtube_quota: {
    message: "YouTube lookups have reached today's limit for everyone. Please try again tomorrow.",
    retryable: false,
  },
  youtube_busy: { message: "YouTube is busy or slow right now. Please wait a minute and try again.", retryable: true },
  youtube_error: { message: "We couldn't reach YouTube. Please try again in a moment.", retryable: true },
  not_found: { message: "We couldn't find that breakdown. It may have been deleted.", retryable: false },
  idea_failed: { message: "We couldn't save this idea right now. Please try again.", retryable: true },
};
