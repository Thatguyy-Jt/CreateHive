import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AiResult, RunStructuredRequest } from "@/lib/ai/run-structured";
import { getPrompt } from "@/lib/ai/prompts/registry";
import type { DiagnosisOtherPostInput } from "@/lib/ai/prompts/content_diagnosis/v1";
import { baselineFor, engagementRate, isSettled, METRIC_LABELS } from "@/lib/analytics/baseline";
import { formatMetric, formatPercent } from "@/lib/analytics/format";
import { formatWeekday, localDateKey } from "@/lib/calendar/dates";
import { logEvent } from "@/lib/observability/log";
import {
  applyHonestyRules,
  DIAGNOSIS_ERRORS,
  diagnosisModelSchema,
  parseDiagnosisOutput,
  parseStoredDiagnosis,
  toStoredDiagnosis,
  type Diagnosis,
  type DiagnosisErrorCode,
  type DiagnosisModelOutput,
  type StoredDiagnosis,
} from "@/lib/schemas/diagnosis";
import { parseStoredPackage } from "@/lib/schemas/studio";
import type { Database, Json } from "@/lib/supabase/database.types";
import { getPost, readPostSummaries, type PostDetail } from "./analytics";
import { buildCreatorContext } from "./creator-context";
import { renderCappedContext } from "./studio";

type ReadClient = Pick<SupabaseClient<Database>, "from">;

/** A pending diagnosis inside this window blocks another one. */
export const IN_FLIGHT_WINDOW_MS = 2 * 60 * 1000;
/** Diagnoses allowed per post inside `POST_LIMIT_WINDOW_MS`. */
export const POST_DIAGNOSIS_LIMIT = 3;
export const POST_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Other settled posts sent as context. */
export const OTHER_POSTS_LIMIT = 12;
/** Check-ins sent, most recent. */
export const CHECKINS_LIMIT = 10;

const uuid = z.uuid();

export type DiagnosisFailure = { ok: false; code: DiagnosisErrorCode; message: string; retryable: boolean };

function fail(code: DiagnosisErrorCode): DiagnosisFailure {
  return { ok: false, code, ...DIAGNOSIS_ERRORS[code] };
}

const failed = (stage: string, fields: { db_code?: string; code?: string } = {}) =>
  logEvent("error", "content_diagnosis_failed", { stage, ...fields });

function unexpected(event: string, error: unknown) {
  logEvent("error", event, { stage: "unexpected", name: error instanceof Error ? error.name : typeof error });
}

type RunDiagnosis = (
  request: RunStructuredRequest<"content_diagnosis", DiagnosisModelOutput, Diagnosis>,
) => Promise<AiResult<Diagnosis>>;

export interface DiagnosisDeps {
  /** `runStructured` from `@/lib/ai`; injected so tests never reach a provider. */
  run: RunDiagnosis;
  now?: () => number;
}

/** "Tuesday, around 18:00" for a post's local date and time. */
function postedLabel(post: Pick<PostDetail, "date" | "time">): string | null {
  if (!post.date || !post.time) return null;
  const weekday = formatWeekday(post.date);
  return weekday ? `${weekday}, around ${post.time.slice(0, 2)}:00` : null;
}

/** The Studio plan behind a post: its idea and the latest package's first hook and CTA. */
async function readPlan(client: ReadClient, userId: string, itemId: string) {
  const [item, version] = await Promise.all([
    client.from("content_items").select("idea:content_ideas(topic, angle)").eq("id", itemId).eq("user_id", userId).maybeSingle(),
    client
      .from("content_versions")
      .select("content")
      .eq("user_id", userId)
      .eq("content_item_id", itemId)
      .order("version_no", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const error = item.error ?? version.error;
  if (error) return { ok: false as const, code: error.code };
  const idea = (item.data as { idea: { topic: string; angle: string | null } | null } | null)?.idea ?? null;
  const stored = version.data ? parseStoredPackage(version.data.content) : null;
  const pkg = stored?.ok ? stored.package : null;
  return {
    ok: true as const,
    plan: {
      idea_topic: idea?.topic ?? null,
      idea_angle: idea?.angle ?? null,
      planned_hook: pkg?.hooks[0]?.text ?? null,
      planned_cta: pkg?.cta ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

export type AnalyzeResult = { ok: true; diagnosisId: string } | DiagnosisFailure;

/**
 * Diagnosis Agent: explains one published post's results against the
 * creator's own history and proposes one next experiment, then stores it.
 * Never throws; nothing is stored on failure.
 *
 * `client` acts as the creator (`createUserClient()`); `userId` comes from
 * Clerk's verified session. The daily cap and metering happen in `run`.
 */
export async function analyzeContentPerformance(
  client: ReadClient,
  userId: string,
  itemId: unknown,
  tz: string | null,
  deps: DiagnosisDeps,
): Promise<AnalyzeResult> {
  const now = deps.now ?? Date.now;
  const id = uuid.safeParse(itemId);
  if (!id.success) return fail("not_found");

  try {
    // 1. The post, its check-ins and comparison.
    const loaded = await getPost(client, userId, id.data, tz, now());
    if (!loaded.ok) return fail(loaded.code === "not_found" ? "not_found" : "persistence_error");
    const { post } = loaded;
    const latest = post.checkIns.at(-1);
    if (!latest) return fail("no_results");

    // 2. Creator context.
    const built = await buildCreatorContext(client, userId, { include: ["profile", "brand", "pillars", "strategy"] });
    if (!built.ok) return fail("persistence_error");
    if (!built.context.profile) return fail("missing_context");

    // 3. Per-post cap.
    const recent = await client
      .from("content_diagnoses")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("content_item_id", post.id)
      .gte("created_at", new Date(now() - POST_LIMIT_WINDOW_MS).toISOString());
    if (recent.error) {
      failed("post_limit_check", { db_code: recent.error.code });
      return fail("persistence_error");
    }
    if ((recent.count ?? 0) >= POST_DIAGNOSIS_LIMIT) return fail("post_limit");

    // 4. In-flight guard.
    const pending = await client
      .from("ai_generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "content_diagnosis")
      .eq("status", "pending")
      .gte("created_at", new Date(now() - IN_FLIGHT_WINDOW_MS).toISOString());
    if (pending.error) {
      failed("in_flight_check", { db_code: pending.error.code });
      return fail("persistence_error");
    }
    if ((pending.count ?? 0) > 0) return fail("in_progress");

    // 5. Input: the plan behind it and the creator's other settled posts.
    const [plan, summaries] = await Promise.all([readPlan(client, userId, post.id), readPostSummaries(client, userId)]);
    if (!plan.ok) {
      failed("plan", { db_code: plan.code });
      return fail("persistence_error");
    }
    if (!summaries.ok) return fail("persistence_error");
    const others = summaries.posts
      .filter((other) => other.id !== post.id && other.platform === post.platform && isSettled(other))
      .slice(0, OTHER_POSTS_LIMIT);
    // Hooks and lengths of those posts, in one narrow read.
    const extra = others.length
      ? await client
          .from("content_items")
          .select("id, hook_used, duration_seconds")
          .eq("user_id", userId)
          .in(
            "id",
            others.map((other) => other.id),
          )
      : { data: [], error: null };
    if (extra.error) {
      failed("other_posts", { db_code: extra.error.code });
      return fail("persistence_error");
    }
    const details = new Map((extra.data ?? []).map((row) => [row.id, row]));
    const otherPosts: DiagnosisOtherPostInput[] = others.map((other) => {
      const rate = other.latest ? engagementRate(other.latest) : null;
      const day = tz ? localDateKey(other.published_at, tz) : null;
      return {
        title: other.title,
        format: other.format,
        hook_used: details.get(other.id)?.hook_used ?? null,
        duration_seconds: details.get(other.id)?.duration_seconds ?? null,
        weekday: day ? formatWeekday(day) : null,
        views: other.latest?.views ?? null,
        engagement: rate === null ? null : formatPercent(rate),
        label: baselineFor(other, summaries.posts).metrics.find((m) => m.metric === "views")?.label ?? null,
      };
    });

    const { comparison } = post;
    const result = await deps.run({
      userId,
      kind: "content_diagnosis",
      input: {
        context: renderCappedContext(built.context),
        post: {
          title: post.title,
          platform: post.platform,
          format: post.format,
          pillar: post.pillar_name,
          posted: postedLabel(post),
          hook_used: post.hook_used,
          duration_seconds: post.duration_seconds,
          ...plan.plan,
        },
        checkIns: post.checkIns.slice(-CHECKINS_LIMIT).map((c) => ({
          day: c.day,
          views: c.views,
          likes: c.likes,
          comments: c.comments,
          shares: c.shares,
          saves: c.saves,
          follower_delta: c.follower_delta,
          avg_view_duration_seconds: c.avg_view_duration_seconds,
          retention_rate: c.retention_rate,
        })),
        comparison: {
          settled: comparison.settled,
          ageDays: comparison.ageDays ?? 0,
          peers: comparison.peers,
          metrics: comparison.metrics.map((m) => ({
            name: METRIC_LABELS[m.metric],
            value: m.value === null ? null : formatMetric(m.metric, m.value),
            usual: m.median === null ? null : formatMetric(m.metric, m.median),
            sample: m.sampleSize,
            label: m.label,
          })),
        },
        otherPosts,
      },
      schema: diagnosisModelSchema,
      validate: parseDiagnosisOutput,
    });
    if (!result.ok) {
      failed("ai", { code: result.code });
      return fail(result.code);
    }

    // 6. Honesty rules, then store.
    const honest = applyHonestyRules(result.data, {
      settled: comparison.settled,
      ageDays: comparison.ageDays ?? 0,
      peers: comparison.peers,
    });
    const inserted = await client
      .from("content_diagnoses")
      .insert({
        user_id: userId,
        content_item_id: post.id,
        snapshot_id: latest.id,
        ai_generation_id: result.generationId,
        prompt_version: getPrompt("content_diagnosis").version,
        diagnosis: toStoredDiagnosis(honest.diagnosis, honest.capped) as unknown as Json,
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      failed("insert", { db_code: inserted.error?.code });
      return fail("persistence_error");
    }
    return { ok: true, diagnosisId: inserted.data.id };
  } catch (error) {
    unexpected("content_diagnosis_failed", error);
    return fail("persistence_error");
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface LatestDiagnosis {
  id: string;
  created_at: string;
  /** Null when the stored content can't be read. */
  diagnosis: StoredDiagnosis | null;
  /** Made from the post's current latest check-in. */
  current: boolean;
  /** The idea its experiment was saved as, if any. */
  savedIdeaId: string | null;
}

/** The post's newest diagnosis, or null. Never throws. */
export async function getLatestDiagnosis(
  client: ReadClient,
  userId: string,
  itemId: unknown,
  latestSnapshotId: string | null,
): Promise<{ ok: true; latest: LatestDiagnosis | null } | { ok: false }> {
  const id = uuid.safeParse(itemId);
  if (!id.success) return { ok: true, latest: null };
  try {
    const row = await client
      .from("content_diagnoses")
      .select("id, created_at, snapshot_id, ai_generation_id, diagnosis")
      .eq("user_id", userId)
      .eq("content_item_id", id.data)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (row.error) {
      logEvent("error", "diagnosis_read_failed", { stage: "latest", db_code: row.error.code });
      return { ok: false };
    }
    if (!row.data) return { ok: true, latest: null };

    let savedIdeaId: string | null = null;
    if (row.data.ai_generation_id) {
      const idea = await client
        .from("content_ideas")
        .select("id")
        .eq("user_id", userId)
        .eq("ai_generation_id", row.data.ai_generation_id)
        .limit(1)
        .maybeSingle();
      if (idea.error) {
        logEvent("error", "diagnosis_read_failed", { stage: "saved_idea", db_code: idea.error.code });
        return { ok: false };
      }
      savedIdeaId = idea.data?.id ?? null;
    }

    const parsed = parseStoredDiagnosis(row.data.diagnosis);
    if (!parsed.ok) logEvent("warn", "diagnosis_read_skipped", { stage: "validate" });
    return {
      ok: true,
      latest: {
        id: row.data.id,
        created_at: row.data.created_at,
        diagnosis: parsed.ok ? parsed.diagnosis : null,
        current: row.data.snapshot_id !== null && row.data.snapshot_id === latestSnapshotId,
        savedIdeaId,
      },
    };
  } catch (error) {
    unexpected("diagnosis_read_failed", error);
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Save the next experiment as an idea
// ---------------------------------------------------------------------------

const diagnosisRow = z.object({
  id: z.string(),
  ai_generation_id: z.string().nullable(),
  diagnosis: z.unknown(),
  item: z.object({
    title: z.string(),
    platform: z.string().nullable(),
    format: z.string().nullable(),
    pillar_id: z.string().nullable(),
  }),
});

/**
 * Saves a diagnosis's next experiment as a saved idea with `creator_history`
 * evidence. Idempotent: an idea already saved from the same generation is
 * returned instead. Never throws.
 */
export async function saveExperimentAsIdea(
  client: ReadClient,
  userId: string,
  diagnosisId: unknown,
): Promise<{ ok: true; ideaId: string } | DiagnosisFailure> {
  const id = uuid.safeParse(diagnosisId);
  if (!id.success) return fail("not_found");
  try {
    const row = await client
      .from("content_diagnoses")
      .select("id, ai_generation_id, diagnosis, item:content_items(title, platform, format, pillar_id)")
      .eq("id", id.data)
      .eq("user_id", userId)
      .maybeSingle();
    if (row.error) {
      logEvent("error", "diagnosis_idea_failed", { stage: "read", db_code: row.error.code });
      return fail("idea_failed");
    }
    if (!row.data) return fail("not_found");
    const parsedRow = diagnosisRow.safeParse(row.data);
    const stored = parsedRow.success ? parseStoredDiagnosis(parsedRow.data.diagnosis) : null;
    if (!parsedRow.success || !stored?.ok) {
      logEvent("error", "diagnosis_idea_failed", { stage: "validate" });
      return fail("idea_failed");
    }
    const { ai_generation_id: generationId, item } = parsedRow.data;
    const { next_experiment: experiment } = stored.diagnosis;

    if (generationId) {
      const existing = await client
        .from("content_ideas")
        .select("id")
        .eq("user_id", userId)
        .eq("ai_generation_id", generationId)
        .limit(1)
        .maybeSingle();
      if (existing.error) {
        logEvent("error", "diagnosis_idea_failed", { stage: "existing", db_code: existing.error.code });
        return fail("idea_failed");
      }
      if (existing.data) return { ok: true, ideaId: existing.data.id };
    }

    const inserted = await client
      .from("content_ideas")
      .insert({
        user_id: userId,
        topic: experiment.idea.topic,
        angle: experiment.idea.angle,
        format: experiment.idea.format ?? item.format,
        platform: item.platform,
        pillar_id: item.pillar_id,
        rationale: experiment.why,
        status: "saved",
        source: "ai",
        ai_generation_id: generationId,
        evidence: [
          {
            kind: "creator_history",
            summary: `From the diagnosis of “${item.title}”: ${experiment.change}`.slice(0, 1000),
          },
        ],
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      logEvent("error", "diagnosis_idea_failed", { stage: "insert", db_code: inserted.error?.code });
      return fail("idea_failed");
    }
    return { ok: true, ideaId: inserted.data.id };
  } catch (error) {
    unexpected("diagnosis_idea_failed", error);
    return fail("idea_failed");
  }
}
