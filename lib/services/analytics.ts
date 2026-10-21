import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  baselineFor,
  latestCheckIn,
  needsResults,
  platformSummaries,
  type BaselinePost,
  type PlatformSummary,
  type PostComparison,
} from "@/lib/analytics/baseline";
import { chartPointsFor, SPARK_POST_LIMIT, type ChartPoint } from "@/lib/analytics/chart-data";
import { platformOverview, type PlatformOverview } from "@/lib/analytics/overview";
import { localDateKey, localTimeKey, localToInstant, todayIn } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import {
  ANALYTICS_ERRORS,
  CHECKIN_COLUMNS,
  MAX_CHECKINS,
  MAX_POSTS,
  PUBLISHED_FUTURE_GRACE_MS,
  PUBLISHED_LOOKBACK_DAYS,
  pastPostInputFor,
  publishInputFor,
  resultsInputFor,
  storedCheckIn,
  type AnalyticsErrorCode,
  type PastPostInput,
  type PublishInput,
  type StoredCheckIn,
} from "@/lib/schemas/analytics";
import { platform as platformSchema, type Platform } from "@/lib/schemas/creator";
import { formatRulesFor } from "@/lib/schemas/studio";
import type { Database } from "@/lib/supabase/database.types";

type AnalyticsClient = Pick<SupabaseClient<Database>, "from" | "rpc">;
type ReadClient = Pick<SupabaseClient<Database>, "from">;

/** Published posts the baseline, lists and dashboard read (newest first). */
export const BASELINE_POST_LIMIT = 200;
/** Posts listed on /app/analytics. */
export const POST_LIST_LIMIT = 50;
/** Posts listed under "Needs results". */
export const NEEDS_RESULTS_LIMIT = 5;

const DAY_MS = 24 * 60 * 60 * 1000;
const uuid = z.uuid();

export type AnalyticsFailure = {
  ok: false;
  code: AnalyticsErrorCode;
  message: string;
  /** Field name → message, for form inputs. */
  fieldErrors: Record<string, string>;
};

function fail(code: AnalyticsErrorCode, fieldErrors: Record<string, string> = {}): AnalyticsFailure {
  return { ok: false, code, message: ANALYTICS_ERRORS[code], fieldErrors };
}

/** `invalid_input` (or `empty_results`) with one message per field. */
function invalid(error: z.ZodError): AnalyticsFailure {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  if (fieldErrors.form === ANALYTICS_ERRORS.empty_results && Object.keys(fieldErrors).length === 1) {
    return fail("empty_results");
  }
  return fail("invalid_input", fieldErrors);
}

function dbFailed(event: string, stage: string, code?: string): AnalyticsFailure {
  logEvent("error", event, { stage, db_code: code });
  return fail("db_error");
}

function unexpected(event: string, error: unknown) {
  logEvent("error", event, { stage: "unexpected", name: error instanceof Error ? error.name : typeof error });
}

const asPlatform = (value: string | null): Platform | null => {
  const parsed = platformSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

type FormInput = Record<string, unknown>;

/** The UTC instant for a post's local date and time, inside the allowed window. */
function postInstant(date: string, time: string, tz: string, now: number): { ok: true; instant: string } | AnalyticsFailure {
  const instant = localToInstant(date, time, tz);
  if (!instant) return fail("invalid_input", { date: "Choose a valid date." });
  const ms = Date.parse(instant);
  if (ms > now + PUBLISHED_FUTURE_GRACE_MS || ms < now - PUBLISHED_LOOKBACK_DAYS * DAY_MS) {
    return fail("date_out_of_range", { date: ANALYTICS_ERRORS.date_out_of_range });
  }
  return { ok: true, instant };
}

// ---------------------------------------------------------------------------
// Publishing and logging posts
// ---------------------------------------------------------------------------

/**
 * Marks one of the creator's Studio items (draft, ready or scheduled) as
 * published at a local date and time in `tz` (`publish_content_item`); its
 * idea becomes `used`. Never throws.
 */
export async function publishStudioItem(
  client: AnalyticsClient,
  userId: string,
  itemId: unknown,
  input: FormInput,
  tz: string,
  now: number = Date.now(),
): Promise<{ ok: true } | AnalyticsFailure> {
  const id = uuid.safeParse(itemId);
  if (!id.success) return fail("not_found");
  const today = todayIn(tz, now);
  if (!today) return fail("missing_timezone");
  try {
    const row = await client
      .from("content_items")
      .select("status, platform, format")
      .eq("id", id.data)
      .eq("user_id", userId)
      .maybeSingle();
    if (row.error) return dbFailed("analytics_write_failed", "publish_item", row.error.code);
    if (!row.data) return fail("not_found");
    if (!["draft", "ready", "scheduled"].includes(row.data.status)) return fail("not_publishable");

    const video = formatRulesFor(asPlatform(row.data.platform), row.data.format).video;
    const parsed = publishInputFor({ today, video }).safeParse(input);
    if (!parsed.success) return invalid(parsed.error);
    const at = postInstant(parsed.data.date, parsed.data.time, tz, now);
    if (!at.ok) return at;

    const { published_url, hook_used, duration_seconds } = parsed.data;
    const result = await client.rpc("publish_content_item", {
      p_item_id: id.data,
      p_published_at: at.instant,
      ...(published_url === null ? {} : { p_published_url: published_url }),
      ...(hook_used === null ? {} : { p_hook_used: hook_used }),
      ...(duration_seconds === null ? {} : { p_duration_seconds: duration_seconds }),
    });
    if (result.error) {
      if (result.error.message === "item_not_found") return fail("not_found");
      if (result.error.message === "item_not_publishable") return fail("not_publishable");
      if (result.error.message === "published_at_out_of_range") {
        return fail("date_out_of_range", { date: ANALYTICS_ERRORS.date_out_of_range });
      }
      return dbFailed("analytics_write_failed", "publish_rpc", result.error.code);
    }
    return { ok: true };
  } catch (error) {
    unexpected("analytics_write_failed", error);
    return fail("db_error");
  }
}

/** Logs a post made outside the app as a published item. Never throws. */
export async function logPastPost(
  client: ReadClient,
  userId: string,
  input: FormInput,
  tz: string,
  now: number = Date.now(),
): Promise<{ ok: true; itemId: string } | AnalyticsFailure> {
  const today = todayIn(tz, now);
  if (!today) return fail("missing_timezone");
  const parsed = pastPostInputFor({ today }).safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const at = postInstant(parsed.data.date, parsed.data.time, tz, now);
  if (!at.ok) return at;

  try {
    const count = await client
      .from("content_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "published");
    if (count.error || count.count === null) return dbFailed("analytics_write_failed", "post_count", count.error?.code);
    if (count.count >= MAX_POSTS) return fail("post_limit");

    const { title, platform, format, published_url, hook_used, duration_seconds } = parsed.data;
    const inserted = await client
      .from("content_items")
      .insert({
        user_id: userId,
        title,
        platform,
        format,
        status: "published",
        published_at: at.instant,
        published_url,
        hook_used,
        duration_seconds,
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) return dbFailed("analytics_write_failed", "post_insert", inserted.error?.code);
    return { ok: true, itemId: inserted.data.id };
  } catch (error) {
    unexpected("analytics_write_failed", error);
    return fail("db_error");
  }
}

/**
 * Edits a published post's details. Posts logged outside Studio (no idea) can
 * also change title, platform and format. The date can't move after the
 * post's first results. Never throws.
 */
export async function updatePostDetails(
  client: ReadClient,
  userId: string,
  itemId: unknown,
  input: FormInput,
  tz: string,
  now: number = Date.now(),
): Promise<{ ok: true } | AnalyticsFailure> {
  const id = uuid.safeParse(itemId);
  if (!id.success) return fail("not_found");
  const today = todayIn(tz, now);
  if (!today) return fail("missing_timezone");
  try {
    const [row, first] = await Promise.all([
      client
        .from("content_items")
        .select("idea_id, platform, format")
        .eq("id", id.data)
        .eq("user_id", userId)
        .eq("status", "published")
        .maybeSingle(),
      client
        .from("analytics_snapshots")
        .select("captured_at")
        .eq("user_id", userId)
        .eq("content_item_id", id.data)
        .order("captured_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    const readError = row.error ?? first.error;
    if (readError) return dbFailed("analytics_write_failed", "details_read", readError.code);
    if (!row.data) return fail("not_found");

    // Posts logged outside Studio (no idea) can also change title, platform and format.
    let fields: PublishInput & Partial<Pick<PastPostInput, "title" | "platform" | "format">>;
    if (row.data.idea_id === null) {
      const parsed = pastPostInputFor({ today }).safeParse(input);
      if (!parsed.success) return invalid(parsed.error);
      fields = parsed.data;
    } else {
      const video = formatRulesFor(asPlatform(row.data.platform), row.data.format).video;
      const parsed = publishInputFor({ today, video }).safeParse(input);
      if (!parsed.success) return invalid(parsed.error);
      fields = parsed.data;
    }
    const at = postInstant(fields.date, fields.time, tz, now);
    if (!at.ok) return at;
    if (first.data && Date.parse(at.instant) > Date.parse(first.data.captured_at)) {
      return fail("date_after_results", { date: ANALYTICS_ERRORS.date_after_results });
    }

    const updated = await client
      .from("content_items")
      .update({
        published_at: at.instant,
        published_url: fields.published_url,
        hook_used: fields.hook_used,
        duration_seconds: fields.duration_seconds,
        ...(fields.title === undefined ? {} : { title: fields.title, platform: fields.platform, format: fields.format }),
      })
      .eq("id", id.data)
      .eq("user_id", userId)
      .eq("status", "published")
      .select("id");
    if (updated.error) return dbFailed("analytics_write_failed", "details_update", updated.error.code);
    if (!updated.data?.length) return fail("not_found");
    return { ok: true };
  } catch (error) {
    unexpected("analytics_write_failed", error);
    return fail("db_error");
  }
}

/** Deletes a published post; its results (and package) cascade. Never throws. */
export async function deletePost(
  client: ReadClient,
  userId: string,
  itemId: unknown,
): Promise<{ ok: true } | AnalyticsFailure> {
  const id = uuid.safeParse(itemId);
  if (!id.success) return fail("not_found");
  try {
    const deleted = await client
      .from("content_items")
      .delete()
      .eq("id", id.data)
      .eq("user_id", userId)
      .eq("status", "published")
      .select("id");
    if (deleted.error) return dbFailed("analytics_write_failed", "post_delete", deleted.error.code);
    if (!deleted.data?.length) return fail("not_found");
    return { ok: true };
  } catch (error) {
    unexpected("analytics_write_failed", error);
    return fail("db_error");
  }
}

// ---------------------------------------------------------------------------
// Results check-ins
// ---------------------------------------------------------------------------

/** Adds one results check-in (captured now) to a published post. Never throws. */
export async function addResults(
  client: ReadClient,
  userId: string,
  itemId: unknown,
  input: FormInput,
  now: number = Date.now(),
): Promise<{ ok: true } | AnalyticsFailure> {
  const id = uuid.safeParse(itemId);
  if (!id.success) return fail("not_found");
  try {
    const [row, count] = await Promise.all([
      client
        .from("content_items")
        .select("status, platform, format, published_at, duration_seconds")
        .eq("id", id.data)
        .eq("user_id", userId)
        .maybeSingle(),
      client
        .from("analytics_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("content_item_id", id.data),
    ]);
    if (row.error) return dbFailed("analytics_write_failed", "results_item", row.error.code);
    if (!row.data) return fail("not_found");
    if (row.data.status !== "published" || !row.data.published_at) return fail("not_published");
    if (Date.parse(row.data.published_at) > now) return fail("not_yet_published");
    if (count.error || count.count === null) return dbFailed("analytics_write_failed", "results_count", count.error?.code);
    if (count.count >= MAX_CHECKINS) return fail("checkin_limit");

    const platform = asPlatform(row.data.platform);
    const parsed = resultsInputFor({
      video: formatRulesFor(platform, row.data.format).video,
      durationSeconds: row.data.duration_seconds,
    }).safeParse(input);
    if (!parsed.success) return invalid(parsed.error);

    const inserted = await client.from("analytics_snapshots").insert({
      user_id: userId,
      content_item_id: id.data,
      platform: row.data.platform,
      source: "manual",
      ...parsed.data,
    });
    if (inserted.error) return dbFailed("analytics_write_failed", "results_insert", inserted.error.code);
    return { ok: true };
  } catch (error) {
    unexpected("analytics_write_failed", error);
    return fail("db_error");
  }
}

/** Deletes one check-in; returns its post for revalidation. Never throws. */
export async function deleteResults(
  client: ReadClient,
  userId: string,
  snapshotId: unknown,
): Promise<{ ok: true; itemId: string | null } | AnalyticsFailure> {
  const id = uuid.safeParse(snapshotId);
  if (!id.success) return fail("not_found");
  try {
    const deleted = await client
      .from("analytics_snapshots")
      .delete()
      .eq("id", id.data)
      .eq("user_id", userId)
      .select("content_item_id");
    if (deleted.error) return dbFailed("analytics_write_failed", "results_delete", deleted.error.code);
    const row = deleted.data?.[0];
    if (!row) return fail("not_found");
    return { ok: true, itemId: row.content_item_id };
  } catch (error) {
    unexpected("analytics_write_failed", error);
    return fail("db_error");
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface PostSummary extends BaselinePost {
  title: string;
  format: string | null;
  pillar_name: string | null;
  /** Made in Studio (from an idea). */
  from_studio: boolean;
  latest: StoredCheckIn | null;
}

const SUMMARY_COLUMNS = `id, title, platform, format, published_at, idea_id, pillar:content_pillars(name), analytics_snapshots(${CHECKIN_COLUMNS})`;

const summaryRow = z.object({
  id: z.string(),
  title: z.string(),
  platform: z.string().nullable(),
  format: z.string().nullable(),
  published_at: z.string(),
  idea_id: z.string().nullable(),
  pillar: z.object({ name: z.string() }).nullable(),
  analytics_snapshots: z.array(z.unknown()).nullable(),
});

function toCheckIns(rows: readonly unknown[] | null): StoredCheckIn[] {
  const checkIns: StoredCheckIn[] = [];
  for (const row of rows ?? []) {
    const parsed = storedCheckIn.safeParse(row);
    if (parsed.success) checkIns.push(parsed.data);
    else logEvent("warn", "analytics_read_skipped", { stage: "checkin_validate" });
  }
  return checkIns;
}

/**
 * The creator's newest published posts, each with its latest check-in only.
 * Rows that no longer validate are skipped and logged.
 */
export async function readPostSummaries(
  client: ReadClient,
  userId: string,
): Promise<{ ok: true; posts: PostSummary[] } | { ok: false }> {
  const rows = await client
    .from("content_items")
    .select(SUMMARY_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(BASELINE_POST_LIMIT)
    // Only the latest check-in represents a post.
    .order("captured_at", { ascending: false, referencedTable: "analytics_snapshots" })
    .limit(1, { referencedTable: "analytics_snapshots" });
  if (rows.error) {
    logEvent("error", "analytics_read_failed", { stage: "posts", db_code: rows.error.code });
    return { ok: false };
  }
  const posts: PostSummary[] = [];
  for (const row of rows.data ?? []) {
    const parsed = summaryRow.safeParse(row);
    if (!parsed.success) {
      logEvent("warn", "analytics_read_skipped", { stage: "post_validate" });
      continue;
    }
    const { pillar, idea_id, analytics_snapshots: snapshots, ...rest } = parsed.data;
    const platform = asPlatform(rest.platform);
    posts.push({
      ...rest,
      platform,
      pillar_name: pillar?.name ?? null,
      from_studio: idea_id !== null,
      video: formatRulesFor(platform, rest.format).video,
      latest: latestCheckIn(toCheckIns(snapshots)),
    });
  }
  return { ok: true, posts };
}

export interface PostListEntry extends PostSummary {
  comparison: PostComparison;
}

export interface AnalyticsOverview {
  posts: PostListEntry[];
  /** More published posts exist than are listed. */
  truncated: boolean;
  needsResults: PostSummary[];
  platforms: PlatformSummary[];
  /** The overview (KPIs, series, top posts, formats, mix) for each platform in `platforms`, same order. */
  overviews: PlatformOverview[];
}

/** Everything /app/analytics shows. Never throws. */
export async function getAnalyticsOverview(
  client: ReadClient,
  userId: string,
  now: number = Date.now(),
): Promise<{ ok: true; overview: AnalyticsOverview } | { ok: false }> {
  try {
    const read = await readPostSummaries(client, userId);
    if (!read.ok) return read;
    const { posts } = read;
    const summaries = platformSummaries(posts);
    return {
      ok: true,
      overview: {
        posts: posts.slice(0, POST_LIST_LIMIT).map((post) => ({ ...post, comparison: baselineFor(post, posts) })),
        truncated: posts.length > POST_LIST_LIMIT,
        needsResults: needsResults(posts, now).slice(0, NEEDS_RESULTS_LIMIT),
        platforms: summaries,
        overviews: summaries.map((summary) => platformOverview(posts, summary.platform)),
      },
    };
  } catch (error) {
    unexpected("analytics_read_failed", error);
    return { ok: false };
  }
}

export interface CheckInEntry extends StoredCheckIn {
  /** Whole days after publishing. */
  day: number;
  /** Local date in the creator's zone, when one is known. */
  date: string | null;
}

export interface PostDetail {
  id: string;
  title: string;
  platform: Platform | null;
  format: string | null;
  published_at: string;
  published_url: string | null;
  hook_used: string | null;
  duration_seconds: number | null;
  pillar_name: string | null;
  /** The Studio item behind this post, when it was made from an idea. */
  from_studio: boolean;
  video: boolean;
  /** The post date has passed, so results can be added. */
  live: boolean;
  /** Local date and time in the creator's zone, when one is known. */
  date: string | null;
  time: string | null;
  /** Oldest first. */
  checkIns: CheckInEntry[];
  comparison: PostComparison;
}

const DETAIL_COLUMNS = `id, title, platform, format, published_at, published_url, hook_used, duration_seconds, idea_id, pillar:content_pillars(name), analytics_snapshots(${CHECKIN_COLUMNS})`;

const detailRow = summaryRow.extend({
  published_url: z.string().nullable(),
  hook_used: z.string().nullable(),
  duration_seconds: z.number().nullable(),
});

export type GetPostResult = { ok: true; post: PostDetail } | { ok: false; code: "not_found" | "read_error" };

/**
 * One of the creator's published posts with all its check-ins and how it
 * compares. An invalid id, a missing or unpublished item, or another
 * creator's item is `not_found`. Never throws.
 */
export async function getPost(
  client: ReadClient,
  userId: string,
  itemId: unknown,
  tz: string | null,
  now: number = Date.now(),
): Promise<GetPostResult> {
  const id = uuid.safeParse(itemId);
  if (!id.success) return { ok: false, code: "not_found" };
  try {
    const [row, summaries] = await Promise.all([
      client
        .from("content_items")
        .select(DETAIL_COLUMNS)
        .eq("id", id.data)
        .eq("user_id", userId)
        .eq("status", "published")
        .order("captured_at", { ascending: true, referencedTable: "analytics_snapshots" })
        .maybeSingle(),
      readPostSummaries(client, userId),
    ]);
    if (row.error) {
      logEvent("error", "analytics_read_failed", { stage: "post", db_code: row.error.code });
      return { ok: false, code: "read_error" };
    }
    if (!row.data) return { ok: false, code: "not_found" };
    if (!summaries.ok) return { ok: false, code: "read_error" };
    const parsed = detailRow.safeParse(row.data);
    if (!parsed.success) {
      logEvent("error", "analytics_read_failed", { stage: "post_validate" });
      return { ok: false, code: "read_error" };
    }

    const { pillar, idea_id, analytics_snapshots: snapshots, ...rest } = parsed.data;
    const platform = asPlatform(rest.platform);
    const video = formatRulesFor(platform, rest.format).video;
    const checkIns = toCheckIns(snapshots).toSorted((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
    const self: BaselinePost = { id: rest.id, platform, published_at: rest.published_at, video, latest: latestCheckIn(checkIns) };
    // Peers come from the summaries; this post is excluded by id inside `baselineFor`.
    const comparison = baselineFor(self, summaries.posts);
    return {
      ok: true,
      post: {
        ...rest,
        platform,
        video,
        live: Date.parse(rest.published_at) <= now,
        pillar_name: pillar?.name ?? null,
        from_studio: idea_id !== null,
        date: tz ? localDateKey(rest.published_at, tz) : null,
        time: tz ? localTimeKey(rest.published_at, tz) : null,
        checkIns: checkIns.map((checkIn) => ({
          ...checkIn,
          day: Math.max(0, Math.floor((Date.parse(checkIn.captured_at) - Date.parse(rest.published_at)) / DAY_MS)),
          date: tz ? localDateKey(checkIn.captured_at, tz) : null,
        })),
        comparison,
      },
    };
  } catch (error) {
    unexpected("analytics_read_failed", error);
    return { ok: false, code: "read_error" };
  }
}

export interface PerformanceSummary {
  totalPosts: number;
  /** The most recently published settled post, with its comparison. */
  latestSettled: PostListEntry | null;
  needsResultsCount: number;
  /** The oldest post that needs results. */
  firstNeedsResults: PostSummary | null;
  /** Recent views on the platform of the latest post, for the sparkline; null without posts. */
  spark: { platform: Platform | null; points: ChartPoint[]; usualViews: number | null } | null;
}

/** What the dashboard's Performance card shows. Never throws. */
export async function getPerformanceSummary(
  client: ReadClient,
  userId: string,
  now: number = Date.now(),
): Promise<{ ok: true; summary: PerformanceSummary } | { ok: false }> {
  try {
    const read = await readPostSummaries(client, userId);
    if (!read.ok) return read;
    const { posts } = read;
    // Posts are newest first, so the first settled one is the latest.
    const settled = posts.find((post) => baselineFor(post, posts).settled) ?? null;
    const pending = needsResults(posts, now);
    const sparkPlatform = posts[0]?.platform;
    const spark =
      sparkPlatform === undefined
        ? null
        : {
            platform: sparkPlatform,
            points: chartPointsFor(posts, sparkPlatform, SPARK_POST_LIMIT),
            usualViews: platformSummaries(posts).find((p) => p.platform === sparkPlatform)?.usualViews ?? null,
          };
    return {
      ok: true,
      summary: {
        totalPosts: posts.length,
        latestSettled: settled ? { ...settled, comparison: baselineFor(settled, posts) } : null,
        needsResultsCount: pending.length,
        firstNeedsResults: pending[0] ?? null,
        spark,
      },
    };
  } catch (error) {
    unexpected("analytics_read_failed", error);
    return { ok: false };
  }
}
