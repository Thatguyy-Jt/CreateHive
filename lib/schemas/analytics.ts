import { z } from "zod";
import { addDays } from "@/lib/calendar/dates";
import { dateKey, timeKey } from "./calendar";
import { platform } from "./creator";
import type { ResultField } from "./labels";
import { FORMAT_MAX, TITLE_MAX } from "./limits";
import { formatRulesFor } from "./studio";

// Posts (published `content_items`) and their results check-ins
// (`analytics_snapshots`). Form input arrives as strings: empty means "not
// given", and every bound here mirrors a column check or a product rule.

/** How far back a post can be dated. Mirrors `publish_content_item`. */
export const PUBLISHED_LOOKBACK_DAYS = 730;
/** How far ahead of now a post time may be. Mirrors `publish_content_item`. */
export const PUBLISHED_FUTURE_GRACE_MS = 60 * 60 * 1000;
/** Most published posts per creator. */
export const MAX_POSTS = 500;
/** Most check-ins per post. */
export const MAX_CHECKINS = 50;

// TITLE_MAX and FORMAT_MAX are in the zod-free ./limits (client forms import them from there).
export { FORMAT_MAX, TITLE_MAX } from "./limits";
export const URL_MAX = 500;
export const HOOK_MAX = 300;
export const DURATION_MAX_SECONDS = 86_400;
export const COUNT_MAX = 1_000_000_000_000;
export const FOLLOWER_MAX = 1_000_000_000;

// ---------------------------------------------------------------------------
// Field parsers
// ---------------------------------------------------------------------------

/** Trimmed; empty or absent becomes null. */
const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, { error: tooLong })
    .transform((value) => (value === "" ? null : value))
    .default(null);

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

const postUrl = z
  .string()
  .trim()
  .max(URL_MAX, { error: `Keep the link under ${URL_MAX} characters.` })
  .transform((value) => (value === "" ? null : value))
  .refine((value) => value === null || isHttpsUrl(value), { error: "Use a link that starts with https://" })
  .default(null);

/** "95", "1:35" or "1:02:03" → seconds; null for empty; NaN when unreadable. */
export function parseDuration(value: string): number | null {
  const text = value.trim();
  if (text === "") return null;
  if (/^\d+$/.test(text)) return Number(text);
  const match = /^(?:(\d+):)?([0-5]?\d):([0-5]\d)$/.exec(text);
  if (!match) return Number.NaN;
  return Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

// formatDuration lives in the zod-free lib/analytics/format (client charts use it).
export { formatDuration } from "@/lib/analytics/format";

// Absent fields (a form that doesn't show them) count as empty.
const durationField = (label: string) =>
  z
    .string()
    .default("")
    .transform(parseDuration)
    .refine((value) => value === null || Number.isFinite(value), {
      error: `Enter the ${label} in seconds or as m:ss.`,
    })
    .refine((value) => value === null || Number.isNaN(value) || (value >= 1 && value <= DURATION_MAX_SECONDS), {
      error: `The ${label} must be between 1 second and 24 hours.`,
    });

/** Strips thousands separators and spaces: "1,200" → "1200". */
const plain = (value: string) => value.trim().replace(/[,\s_]/g, "").replace(/^−/, "-");

const countField = (label: string) =>
  z
    .string()
    .default("")
    .transform(plain)
    .refine((value) => value === "" || /^\d+$/.test(value), { error: `${label} must be a whole number, 0 or more.` })
    .transform((value) => (value === "" ? null : Number(value)))
    .refine((value) => value === null || value <= COUNT_MAX, { error: `${label} is too large.` });

const followerField = z
  .string()
  .default("")
  .transform(plain)
  .refine((value) => value === "" || /^[-+]?\d+$/.test(value), {
    error: "Follower change must be a whole number (use - for a loss).",
  })
  .transform((value) => (value === "" ? null : Number(value)))
  .refine((value) => value === null || Math.abs(value) <= FOLLOWER_MAX, { error: "Follower change is too large." });

const percentField = z
  .string()
  .default("")
  .transform((value) => plain(value).replace(/%$/, ""))
  .refine((value) => value === "" || /^\d+(\.\d+)?$/.test(value), { error: "Enter a percentage, like 45 or 45.5." })
  .transform((value) => (value === "" ? null : Number(value)))
  .refine((value) => value === null || value <= 100, { error: "Average % viewed can't be over 100." })
  // Stored as 0–1 in `retention_rate numeric(5, 4)`.
  .transform((value) => (value === null ? null : Math.round(value * 100) / 10_000));

// ---------------------------------------------------------------------------
// Post details (publish, past post, edit)
// ---------------------------------------------------------------------------

/** Date keys a post may be dated on, for a creator whose local date is `today`. */
export function postDateRange(today: string): { min: string; max: string } {
  return { min: addDays(today, -PUBLISHED_LOOKBACK_DAYS) ?? today, max: today };
}

function postDate(today: string) {
  const { min, max } = postDateRange(today);
  return dateKey
    .refine((value) => value <= max, { error: "Choose today or an earlier date." })
    .refine((value) => value >= min, { error: "Choose a date in the last 2 years." });
}

function detailsFields(today: string) {
  return {
    date: postDate(today),
    time: timeKey,
    published_url: postUrl,
    hook_used: optionalText(HOOK_MAX, `Keep the hook under ${HOOK_MAX} characters.`),
    duration_seconds: durationField("length"),
  };
}

const identityFields = {
  title: z
    .string()
    .trim()
    .min(2, { error: "Give the post a title of at least 2 characters." })
    .max(TITLE_MAX, { error: `Keep the title under ${TITLE_MAX} characters.` }),
  platform: z.enum(platform.options, { error: "Choose a platform." }),
  format: optionalText(FORMAT_MAX, `Keep the format under ${FORMAT_MAX} characters.`),
};

/** The length only means something for video; other formats store null. */
const keepVideoOnly = <T extends { duration_seconds: number | null }>(data: T, video: boolean): T =>
  video ? data : { ...data, duration_seconds: null };

/** Marking a Studio item as published. `video` comes from the item's platform and format. */
export function publishInputFor(options: { today: string; video: boolean }) {
  return z.object(detailsFields(options.today)).transform((data) => keepVideoOnly(data, options.video));
}
export type PublishInput = z.infer<ReturnType<typeof publishInputFor>>;

/** Logging a post made outside the app. */
export function pastPostInputFor(options: { today: string }) {
  return z
    .object({ ...identityFields, ...detailsFields(options.today) })
    .transform((data) => keepVideoOnly(data, formatRulesFor(data.platform, data.format).video));
}
export type PastPostInput = z.infer<ReturnType<typeof pastPostInputFor>>;

// ---------------------------------------------------------------------------
// Results check-in
// ---------------------------------------------------------------------------

// RESULT_FIELDS and their labels are in the zod-free ./labels (client forms import them from there).
export { RESULT_FIELD_LABELS, RESULT_FIELDS } from "./labels";
export type { ResultField } from "./labels";
export const VIDEO_RESULT_FIELDS: ReadonlySet<ResultField> = new Set(["avg_view_duration_seconds", "avg_percent_viewed"]);


export const EMPTY_RESULTS_MESSAGE = "Enter at least one number.";

/**
 * One check-in for a post. Video-only fields are dropped for other formats; the
 * average view duration can't be longer than the post (when its length is known).
 * Output is ready for `analytics_snapshots` (`retention_rate` as 0–1).
 */
export function resultsInputFor(options: { video: boolean; durationSeconds: number | null }) {
  return z
    .object({
      views: countField("Views"),
      likes: countField("Likes"),
      comments: countField("Comments"),
      shares: countField("Shares"),
      saves: countField("Saves"),
      follower_delta: followerField,
      avg_view_duration_seconds: durationField("average view duration"),
      avg_percent_viewed: percentField,
    })
    .transform(({ avg_percent_viewed, ...data }) => {
      const out = { ...data, retention_rate: avg_percent_viewed };
      return options.video ? out : { ...out, avg_view_duration_seconds: null, retention_rate: null };
    })
    .superRefine((data, ctx) => {
      if (
        options.durationSeconds !== null &&
        data.avg_view_duration_seconds !== null &&
        data.avg_view_duration_seconds > options.durationSeconds
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["avg_view_duration_seconds"],
          message: "The average view duration can't be longer than the post.",
        });
      }
      if (Object.values(data).every((value) => value === null)) {
        ctx.addIssue({ code: "custom", path: [], message: EMPTY_RESULTS_MESSAGE });
      }
    });
}
export type ResultsInput = z.infer<ReturnType<typeof resultsInputFor>>;

// ---------------------------------------------------------------------------
// Stored rows
// ---------------------------------------------------------------------------

/** `bigint` and `numeric` columns may arrive as numbers or strings. */
const storedNumber = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((value, ctx) => {
    if (value === null) return null;
    const number = Number(value);
    if (!Number.isFinite(number)) {
      ctx.addIssue({ code: "custom", message: "not a number" });
      return z.NEVER;
    }
    return number;
  });

export const storedCheckIn = z.object({
  id: z.string(),
  captured_at: z.string(),
  views: storedNumber,
  likes: storedNumber,
  comments: storedNumber,
  shares: storedNumber,
  saves: storedNumber,
  follower_delta: storedNumber,
  avg_view_duration_seconds: storedNumber,
  retention_rate: storedNumber,
});
export type StoredCheckIn = z.infer<typeof storedCheckIn>;

export const CHECKIN_COLUMNS =
  "id, captured_at, views, likes, comments, shares, saves, follower_delta, avg_view_duration_seconds, retention_rate";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AnalyticsErrorCode =
  | "invalid_input"
  | "not_found"
  | "not_publishable"
  | "not_published"
  | "not_yet_published"
  | "date_out_of_range"
  | "date_after_results"
  | "post_limit"
  | "checkin_limit"
  | "empty_results"
  | "missing_timezone"
  | "db_error";

export const ANALYTICS_ERRORS: Record<AnalyticsErrorCode, string> = {
  invalid_input: "Please fix the highlighted fields.",
  not_found: "We couldn't find that post. Refresh the page to see your current posts.",
  not_publishable: "This item is already published or archived. Refresh the page to see its current state.",
  not_published: "Results can only be added to a published post.",
  not_yet_published: "This post's date is in the future. Add results once it's live.",
  date_out_of_range: "Choose a date and time in the last 2 years, and not in the future.",
  date_after_results: "The post date can't be after the first results you entered for it.",
  post_limit: `You've reached ${MAX_POSTS} posts, the most we keep for now. Delete an old post to add another.`,
  checkin_limit: `This post has ${MAX_CHECKINS} results entries, the most we keep. Delete an old entry to add another.`,
  empty_results: EMPTY_RESULTS_MESSAGE,
  missing_timezone: "Confirm your timezone on the calendar first, so dates line up with your week.",
  db_error: "We couldn't save that right now. Please try again in a moment.",
};
