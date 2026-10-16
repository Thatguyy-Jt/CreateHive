import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AiResult, RunStructuredRequest } from "@/lib/ai/run-structured";
import type { InsightsDiagnosisInput, InsightsPostInput } from "@/lib/ai/prompts/creator_insights/v1";
import { baselineFor, isSettled, METRIC_LABELS } from "@/lib/analytics/baseline";
import { formatMetric } from "@/lib/analytics/format";
import { formatDay, formatWeekday, localDateKey, localTimeKey } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import { FACTOR_LABELS, parseStoredDiagnosis } from "@/lib/schemas/diagnosis";
import {
  applyInsightRules,
  compareInsights,
  INSIGHT_COLUMNS,
  INSIGHT_ERRORS,
  insightsModelSchema,
  MIN_SETTLED_POSTS,
  parseInsightsOutput,
  parseStoredInsight,
  postRef,
  type InsightErrorCode,
  type InsightsModelOutput,
  type InsightsOutput,
  type PostFacts,
  type StoredInsight,
} from "@/lib/schemas/insights";
import type { Database, Json } from "@/lib/supabase/database.types";
import { readPostSummaries, type PostSummary } from "./analytics";
import { buildCreatorContext } from "./creator-context";
import { renderCappedContext } from "./studio";

type ReadClient = Pick<SupabaseClient<Database>, "from">;
type WriteClient = Pick<SupabaseClient<Database>, "from" | "rpc">;

/** A pending update inside this window blocks another one. */
export const IN_FLIGHT_WINDOW_MS = 2 * 60 * 1000;
/** Successful updates allowed per creator inside `UPDATE_LIMIT_WINDOW_MS`. */
export const UPDATE_LIMIT = 3;
export const UPDATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Settled posts sent, newest first. */
export const POSTS_LIMIT = 30;
/** Diagnoses sent (the latest per post). */
export const DIAGNOSES_LIMIT = 10;
/** Dismissed summaries sent, newest first. */
export const DISMISSED_LIMIT = 10;
/** Creator context sent, in characters. */
export const INSIGHTS_CONTEXT_LIMIT = 3_000;
/** Active insights listed on /app/insights. */
export const ACTIVE_LIST_LIMIT = 20;

const KIND = "creator_insights";
const uuid = z.uuid();

export type InsightFailure = { ok: false; code: InsightErrorCode; message: string; retryable: boolean };

function fail(code: InsightErrorCode): InsightFailure {
  return { ok: false, code, ...INSIGHT_ERRORS[code] };
}

const failed = (stage: string, fields: { db_code?: string; code?: string } = {}) =>
  logEvent("error", "creator_insights_failed", { stage, ...fields });

function unexpected(event: string, error: unknown) {
  logEvent("error", event, { stage: "unexpected", name: error instanceof Error ? error.name : typeof error });
}

type RunInsights = (
  request: RunStructuredRequest<"creator_insights", InsightsModelOutput, InsightsOutput>,
) => Promise<AiResult<InsightsOutput>>;

export interface InsightsDeps {
  /** `runStructured` from `@/lib/ai`; injected so tests never reach a provider. */
  run: RunInsights;
  now?: () => number;
}

/** "Tuesday, around 18:00" in the creator's zone, or null without one. */
function postedLabel(publishedAt: string, tz: string | null): string | null {
  if (!tz) return null;
  const day = localDateKey(publishedAt, tz);
  const time = localTimeKey(publishedAt, tz);
  const weekday = day ? formatWeekday(day) : null;
  return weekday && time ? `${weekday}, around ${time.slice(0, 2)}:00` : null;
}

/** Successful updates since `since`. */
function countUpdates(client: ReadClient, userId: string, since: number) {
  return client
    .from("ai_generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", KIND)
    .eq("status", "succeeded")
    .gte("created_at", new Date(since).toISOString());
}

/** The newest successful update, or null. */
function readLastUpdate(client: ReadClient, userId: string) {
  return client
    .from("ai_generations")
    .select("id, created_at")
    .eq("user_id", userId)
    .eq("kind", KIND)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export type UpdateInsightsResult = { ok: true; count: number; notes: string[] } | InsightFailure;

/**
 * Learning Agent: finds recurring patterns across the creator's settled posts
 * (and their diagnoses), applies the honesty rules and replaces the active
 * insights in one RPC. Never throws; nothing changes on failure.
 *
 * `client` acts as the creator (`createUserClient()`); `userId` comes from
 * Clerk's verified session. The daily cap and metering happen in `run`.
 */
export async function updateCreatorInsights(
  client: WriteClient,
  userId: string,
  tz: string | null,
  deps: InsightsDeps,
): Promise<UpdateInsightsResult> {
  const now = deps.now ?? Date.now;
  try {
    // 1. Creator context.
    const built = await buildCreatorContext(client, userId, { include: ["profile", "pillars", "strategy"] });
    if (!built.ok) return fail("persistence_error");
    if (!built.context.profile) return fail("missing_context");

    // 2. Enough settled posts.
    const summaries = await readPostSummaries(client, userId);
    if (!summaries.ok) return fail("persistence_error");
    const settled = summaries.posts.filter(isSettled);
    if (settled.length < MIN_SETTLED_POSTS) return fail("not_enough_data");

    // 3. Per-creator cap.
    const recent = await countUpdates(client, userId, now() - UPDATE_LIMIT_WINDOW_MS);
    if (recent.error) {
      failed("update_limit_check", { db_code: recent.error.code });
      return fail("persistence_error");
    }
    if ((recent.count ?? 0) >= UPDATE_LIMIT) return fail("update_limit");

    // 4. In-flight guard.
    const pending = await client
      .from("ai_generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", KIND)
      .eq("status", "pending")
      .gte("created_at", new Date(now() - IN_FLIGHT_WINDOW_MS).toISOString());
    if (pending.error) {
      failed("in_flight_check", { db_code: pending.error.code });
      return fail("persistence_error");
    }
    if ((pending.count ?? 0) > 0) return fail("in_progress");

    // 5. Input.
    const posts = settled.slice(0, POSTS_LIMIT);
    const ids = posts.map((post) => post.id);
    const [extra, diagnoses, insights] = await Promise.all([
      client.from("content_items").select("id, hook_used, duration_seconds").eq("user_id", userId).in("id", ids),
      client
        .from("content_diagnoses")
        .select("content_item_id, diagnosis")
        .eq("user_id", userId)
        .in("content_item_id", ids)
        .order("created_at", { ascending: false })
        .limit(POSTS_LIMIT * 3),
      client
        .from("creator_insights")
        .select("insight_type, summary, confidence, sample_size, status")
        .eq("user_id", userId)
        .in("status", ["active", "dismissed"])
        .order("updated_at", { ascending: false })
        .limit(ACTIVE_LIST_LIMIT + DISMISSED_LIMIT),
    ]);
    for (const [stage, read] of [
      ["post_details", extra],
      ["diagnoses", diagnoses],
      ["insights", insights],
    ] as const) {
      if (read.error) {
        failed(stage, { db_code: read.error.code });
        return fail("persistence_error");
      }
    }

    const refs = new Map(posts.map((post, index) => [post.id, postRef(index)]));
    const details = new Map((extra.data ?? []).map((row) => [row.id, row]));
    const facts = new Map<string, PostFacts>();
    const postInputs: InsightsPostInput[] = posts.map((post, index) => {
      const comparison = baselineFor(post, summaries.posts);
      const day = tz ? localDateKey(post.published_at, tz) : null;
      facts.set(postRef(index), {
        id: post.id,
        title: post.title,
        platform: post.platform,
        dateLabel: day ? formatDay(day) : null,
        metrics: Object.fromEntries(
          comparison.metrics.map((m) => [m.metric, { value: m.value, median: m.median, label: m.label }]),
        ),
      });
      return {
        ref: postRef(index),
        title: post.title,
        platform: post.platform,
        format: post.format,
        pillar: post.pillar_name,
        hook_used: details.get(post.id)?.hook_used ?? null,
        duration_seconds: details.get(post.id)?.duration_seconds ?? null,
        posted: postedLabel(post.published_at, tz),
        from_studio: post.from_studio,
        metrics: comparison.metrics.map((m) => ({
          name: METRIC_LABELS[m.metric],
          value: m.value === null ? null : formatMetric(m.metric, m.value),
          usual: m.median === null ? null : formatMetric(m.metric, m.median),
          label: m.label,
        })),
      };
    });

    // The latest readable diagnosis per post, newest first.
    const diagnosisInputs: InsightsDiagnosisInput[] = [];
    const diagnosed = new Set<string>();
    for (const row of diagnoses.data ?? []) {
      if (diagnosisInputs.length >= DIAGNOSES_LIMIT) break;
      const ref = refs.get(row.content_item_id);
      if (!ref || diagnosed.has(row.content_item_id)) continue;
      diagnosed.add(row.content_item_id);
      const parsed = parseStoredDiagnosis(row.diagnosis);
      if (!parsed.ok) continue;
      diagnosisInputs.push({
        ref,
        headline: parsed.diagnosis.headline,
        factors: parsed.diagnosis.factors.map((f) => ({
          factor: FACTOR_LABELS[f.factor],
          observation: f.observation,
          confidence: f.confidence,
        })),
      });
    }

    const insightRows = insights.data ?? [];
    const result = await deps.run({
      userId,
      kind: KIND,
      input: {
        context: renderCappedContext(built.context, INSIGHTS_CONTEXT_LIMIT),
        posts: postInputs,
        diagnoses: diagnosisInputs,
        currentInsights: insightRows
          .filter((row) => row.status === "active")
          .map(({ insight_type, summary, confidence, sample_size }) => ({ insight_type, summary, confidence, sample_size })),
        dismissed: insightRows
          .filter((row) => row.status === "dismissed")
          .slice(0, DISMISSED_LIMIT)
          .map((row) => row.summary),
      },
      schema: insightsModelSchema,
      validate: parseInsightsOutput,
    });
    if (!result.ok) {
      failed("ai", { code: result.code });
      return fail(result.code);
    }

    // 6. Honesty rules, then replace the active set atomically.
    const { insights: rows } = applyInsightRules(result.data, { facts, settledTotal: settled.length });
    const replaced = await client.rpc("replace_creator_insights", {
      p_generation_id: result.generationId,
      p_insights: rows as unknown as Json,
    });
    if (replaced.error) {
      failed("replace", { db_code: replaced.error.code });
      return fail("persistence_error");
    }
    return { ok: true, count: rows.length, notes: result.data.notes };
  } catch (error) {
    unexpected("creator_insights_failed", error);
    return fail("persistence_error");
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface InsightsOverview {
  /** Active insights, high confidence first. */
  insights: StoredInsight[];
  /** Posts with results a week or more after posting. */
  settled: number;
  needed: number;
  /** Null before the first successful update. */
  lastUpdatedAt: string | null;
  /** The generation behind the current insights; Undo only applies to its rows. */
  latestGenerationId: string | null;
  /** A settled post's latest results are newer than the last update. */
  newResults: boolean;
  updatesUsed: number;
  updatesLimit: number;
  /** Published posts that still exist, so evidence only links to live pages. */
  livePostIds: string[];
}

/** Settled posts whose latest results came in after `since`. */
function hasNewResults(posts: readonly PostSummary[], since: string | null): boolean {
  if (!since) return false;
  const after = Date.parse(since);
  return posts.some((post) => isSettled(post) && post.latest !== null && Date.parse(post.latest.captured_at) > after);
}

/** Everything /app/insights and the dashboard card show. Never calls AI; never throws. */
export async function getInsightsOverview(
  client: ReadClient,
  userId: string,
  now: number = Date.now(),
): Promise<{ ok: true; overview: InsightsOverview } | { ok: false }> {
  try {
    const [active, summaries, last, used] = await Promise.all([
      client
        .from("creator_insights")
        .select(INSIGHT_COLUMNS)
        .eq("user_id", userId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(ACTIVE_LIST_LIMIT),
      readPostSummaries(client, userId),
      readLastUpdate(client, userId),
      countUpdates(client, userId, now - UPDATE_LIMIT_WINDOW_MS),
    ]);
    for (const [stage, read] of [
      ["active", active],
      ["last_update", last],
      ["updates_used", used],
    ] as const) {
      if (read.error) {
        logEvent("error", "insights_read_failed", { stage, db_code: read.error.code });
        return { ok: false };
      }
    }
    if (!summaries.ok) return { ok: false };

    const insights: StoredInsight[] = [];
    for (const row of active.data ?? []) {
      const parsed = parseStoredInsight(row);
      if (parsed) insights.push(parsed);
      else logEvent("warn", "insights_read_skipped", { stage: "validate" });
    }
    const lastUpdatedAt = last.data?.created_at ?? null;
    return {
      ok: true,
      overview: {
        insights: insights.toSorted(compareInsights),
        settled: summaries.posts.filter(isSettled).length,
        needed: MIN_SETTLED_POSTS,
        lastUpdatedAt,
        latestGenerationId: last.data?.id ?? null,
        newResults: hasNewResults(summaries.posts, lastUpdatedAt),
        updatesUsed: used.count ?? 0,
        updatesLimit: UPDATE_LIMIT,
        livePostIds: summaries.posts.map((post) => post.id),
      },
    };
  } catch (error) {
    unexpected("insights_read_failed", error);
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Dismiss and undo
// ---------------------------------------------------------------------------

/**
 * Dismisses an active insight, or restores a dismissed one from the latest
 * update (Undo). Restoring anything older would bring back a superseded
 * reading. Never throws.
 */
export async function setInsightStatus(
  client: ReadClient,
  userId: string,
  insightId: unknown,
  status: "dismissed" | "active",
): Promise<{ ok: true } | InsightFailure> {
  const id = uuid.safeParse(insightId);
  if (!id.success) return fail("not_found");
  try {
    let query = client
      .from("creator_insights")
      .update({ status })
      .eq("id", id.data)
      .eq("user_id", userId)
      .eq("status", status === "dismissed" ? "active" : "dismissed");

    if (status === "active") {
      const last = await readLastUpdate(client, userId);
      if (last.error) {
        logEvent("error", "insight_status_failed", { stage: "last_update", db_code: last.error.code });
        return fail("save_failed");
      }
      if (!last.data) return fail("not_found");
      query = query.eq("ai_generation_id", last.data.id);
    }

    const updated = await query.select("id");
    if (updated.error) {
      logEvent("error", "insight_status_failed", { stage: "update", db_code: updated.error.code });
      return fail("save_failed");
    }
    return (updated.data ?? []).length > 0 ? { ok: true } : fail("not_found");
  } catch (error) {
    unexpected("insight_status_failed", error);
    return fail("save_failed");
  }
}
