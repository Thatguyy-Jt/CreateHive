import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { EnvSource } from "@/lib/ai/env";
import { checkMonthlyAllowance } from "@/lib/ai/limits";
import { getPrompt } from "@/lib/ai/prompts/registry";
import type { AiResult, RunStructuredRequest } from "@/lib/ai/run-structured";
import { getAllowance } from "@/lib/billing/allowance";
import { allowanceFor } from "@/lib/billing/features";
import { computeFacts, factLines, type BreakdownFacts } from "@/lib/breakdown/facts";
import { COUNT_FIELDS } from "@/lib/breakdown/platform-guides";
import { logEvent } from "@/lib/observability/log";
import { readYouTubeConfig } from "@/lib/research/env";
import { fetchVideoDetails, VIDEO_DETAILS_UNITS, type FetchLike, type VideoDetailsErrorCode } from "@/lib/research/youtube";
import {
  applyBreakdownHonesty,
  BREAKDOWN_ERRORS,
  breakdownModelSchemaFor,
  creatorInput,
  emptyFacts,
  parseBreakdownForm,
  parseBreakdownOutputFor,
  storedBreakdown,
  storedFacts,
  storedSourceData,
  toStoredBreakdown,
  type Breakdown,
  type BreakdownErrorCode,
  type BreakdownFormField,
  type BreakdownFormValues,
  type BreakdownModelOutput,
  type CreatorInput,
  type StoredBreakdown,
  type StoredFacts,
  type StoredSourceData,
} from "@/lib/schemas/breakdown";
import { platform as platformSchema, PLATFORM_LABELS, type Platform } from "@/lib/schemas/creator";
import type { Database, Json } from "@/lib/supabase/database.types";
import { buildCreatorContext } from "./creator-context";
import { renderCappedContext } from "./studio";
import { BREAKDOWN_USAGE_KIND, USAGE_EVENT_TYPE } from "./youtube-refresh";

// Video Breakdown (prompts/video-breakdown.md). Research + Content agents:
// why a reference video likely worked, and the creator's own version of it.
// YouTube data comes from the official API; everything else is what the
// creator typed. Nothing is scraped, and the creator's link is never fetched.

type Client = Pick<SupabaseClient<Database>, "from">;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** A pending breakdown inside this window blocks another one. */
export const IN_FLIGHT_WINDOW_MS = 2 * 60 * 1000;
/** The same video inside this window reopens the earlier breakdown instead of spending quota. */
export const REUSE_WINDOW_MS = DAY;
/** YouTube API Services: non-authorised API data is kept at most 30 days. */
export const SOURCE_TTL_MS = 30 * DAY;
export const HISTORY_PAGE_SIZE = 20;
export const HISTORY_MAX = 200;
const TITLE_MAX = 120;

const uuid = z.uuid();

export type BreakdownFailure = {
  ok: false;
  code: BreakdownErrorCode;
  message: string;
  retryable: boolean;
};

function fail(code: BreakdownErrorCode): BreakdownFailure {
  return { ok: false, code, ...BREAKDOWN_ERRORS[code] };
}

const failed = (stage: string, fields: { db_code?: string; code?: string } = {}) =>
  logEvent("error", "video_breakdown_failed", { stage, ...fields });

function unexpected(event: string, error: unknown) {
  logEvent("error", event, { stage: "unexpected", name: error instanceof Error ? error.name : typeof error });
}

type RunBreakdown = (
  request: RunStructuredRequest<"video_breakdown", BreakdownModelOutput, Breakdown>,
) => Promise<AiResult<Breakdown>>;

export interface BreakdownDeps {
  /** `runStructured` from `@/lib/ai`; injected so tests never reach a provider. */
  run: RunBreakdown;
  env?: EnvSource;
  fetch?: FetchLike;
  now?: () => number;
}

const iso = (time: number) => new Date(time).toISOString();

function youtubeFailure(code: VideoDetailsErrorCode): BreakdownErrorCode {
  switch (code) {
    case "video_unavailable":
      return "video_unavailable";
    case "quota_exceeded":
      return "youtube_quota";
    case "rate_limited":
    case "timeout":
      return "youtube_busy";
    default:
      return "youtube_error";
  }
}

/** First line of a caption, as a name for the breakdown. */
function captionTitle(caption: string): string | null {
  const first = caption.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  if (!first) return null;
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1).trimEnd()}…` : first;
}

const asTuple = <T>(items: readonly T[]): [T, ...T[]] | null => (items.length ? (items as [T, ...T[]]) : null);

// ---------------------------------------------------------------------------
// Status (what the page shows before any submit)
// ---------------------------------------------------------------------------

export type BreakdownStatus =
  | { state: "error" }
  | { state: "plan_required" }
  | { state: "missing_context" }
  | { state: "available"; used: number; limit: number; platforms: Platform[]; youtubeConfigured: boolean };

/** Plan, allowance and context for /app/breakdown. RLS client only. Never throws. */
export async function getBreakdownStatus(client: Client, userId: string, deps: Pick<BreakdownDeps, "env" | "now"> = {}): Promise<BreakdownStatus> {
  const now = (deps.now ?? Date.now)();
  const env = deps.env ?? process.env;
  try {
    const { plan } = await getAllowance(client, userId, now, env);
    const limit = allowanceFor(plan.id, "video_breakdown") ?? 0;
    if (limit === 0) return { state: "plan_required" };

    const [built, usage] = await Promise.all([
      buildCreatorContext(client, userId, { include: ["profile", "pillars"] }),
      checkMonthlyAllowance(client, userId, "video_breakdown", limit, now),
    ]);
    if (!built.ok || !usage.ok) return { state: "error" };
    const platforms = creatorPlatforms(built.context.profile?.platforms ?? []);
    if (!built.context.profile || !built.context.pillars?.length || platforms.length === 0) return { state: "missing_context" };
    return { state: "available", used: usage.used, limit, platforms, youtubeConfigured: readYouTubeConfig(env).ok };
  } catch (error) {
    unexpected("video_breakdown_read_failed", error);
    return { state: "error" };
  }
}

function creatorPlatforms(values: readonly string[]): Platform[] {
  return values.filter((value): value is Platform => platformSchema.safeParse(value).success);
}

// ---------------------------------------------------------------------------
// Breakdown
// ---------------------------------------------------------------------------

export type AnalyzeResult =
  | { ok: true; breakdownId: string; reused: boolean }
  | (BreakdownFailure & { fieldErrors?: Partial<Record<BreakdownFormField, string>> });

interface Source {
  facts: StoredFacts;
  sourceData: StoredSourceData | null;
  description: string | null;
  tags: string[];
  comments: string[];
}

/**
 * Breaks down one reference video for the creator and stores it. Never
 * throws; nothing is stored on failure. Every gate that can refuse runs before
 * YouTube is called, so a refused request spends no quota.
 *
 * `client` acts as the creator (RLS); `admin` reads the plan, the shared
 * YouTube budget and allowance, and meters YouTube calls. `userId` comes from
 * Clerk's verified session. The daily cap and AI metering happen in `run`.
 */
export async function analyzeReferenceVideo(
  client: Client,
  admin: Client,
  userId: string,
  values: BreakdownFormValues,
  options: {
    /** Skip the "same video in the last 24 hours" reuse. */
    force?: boolean;
    /** A re-run of numbers that were rounded the first time. */
    rounded?: boolean;
  },
  deps: BreakdownDeps,
): Promise<AnalyzeResult> {
  const now = (deps.now ?? Date.now)();
  const env = deps.env ?? process.env;

  const form = parseBreakdownForm(values, now);
  if (!form.ok) return { ...fail("invalid_input"), fieldErrors: form.fieldErrors };
  const { link } = form.data;
  const input: CreatorInput = { ...form.data.input, rounded: form.data.input.rounded || Boolean(options.rounded) };

  try {
    // 1. Pro only, before anything else.
    const { plan } = await getAllowance(admin, userId, now, env);
    const allowance = allowanceFor(plan.id, "video_breakdown") ?? 0;
    if (allowance === 0) return fail("upgrade_required");

    // 2. Creator context: their version needs a profile, pillars and platforms.
    const built = await buildCreatorContext(client, userId, { include: ["profile", "brand", "pillars", "strategy", "insights"] });
    if (!built.ok) return fail("persistence_error");
    const { context } = built;
    const platforms = creatorPlatforms(context.profile?.platforms ?? []);
    const pillarNames = (context.pillars ?? []).map((pillar) => pillar.name);
    const platformTuple = asTuple(platforms);
    const pillarTuple = asTuple(pillarNames);
    if (!context.profile || !platformTuple || !pillarTuple) return fail("missing_context");

    if (input.target_platform && !platforms.includes(input.target_platform)) {
      return { ...fail("invalid_input"), fieldErrors: { target_platform: "Choose one of your platforms." } };
    }
    const target = input.target_platform ?? (platforms.includes(link.platform) ? link.platform : platforms[0]);

    // 3. The same video recently: reopen it, spend nothing.
    if (!options.force) {
      let recent = client
        .from("video_breakdowns")
        .select("id")
        .eq("user_id", userId)
        .eq("platform", link.platform)
        .gte("created_at", iso(now - REUSE_WINDOW_MS));
      recent = link.externalId ? recent.eq("external_id", link.externalId) : recent.eq("source_url", link.canonicalUrl);
      const existing = await recent.order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (existing.error) {
        failed("reuse_check", { db_code: existing.error.code });
        return fail("persistence_error");
      }
      if (existing.data) return { ok: true, breakdownId: existing.data.id, reused: true };
    }

    // 4. Allowance and in-flight, before spending YouTube quota.
    const monthly = await checkMonthlyAllowance(admin, userId, "video_breakdown", allowance, now);
    if (!monthly.ok) {
      failed("allowance_check", { db_code: monthly.code });
      return fail("persistence_error");
    }
    if (monthly.reached) return fail("plan_limit");
    const pending = await client
      .from("ai_generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "video_breakdown")
      .eq("status", "pending")
      .gte("created_at", iso(now - IN_FLIGHT_WINDOW_MS));
    if (pending.error) {
      failed("in_flight_check", { db_code: pending.error.code });
      return fail("persistence_error");
    }
    if ((pending.count ?? 0) > 0) return fail("in_progress");

    // 5. Source data.
    let source: Source;
    if (link.platform === "youtube") {
      const fetched = await youtubeSource(admin, userId, link.externalId!, input, env, now, deps.fetch);
      if (!fetched.ok) return fail(fetched.code);
      source = fetched.source;
    } else {
      source = manualSource(input, now);
    }

    // 6. The model.
    const facts = source.facts;
    const transcript = input.transcript || null;
    const result = await deps.run({
      userId,
      kind: "video_breakdown",
      input: {
        context: renderCappedContext(context),
        video: {
          platform: PLATFORM_LABELS[link.platform],
          title: facts.title,
          author: facts.author,
          posted: facts.published_at ? facts.published_at.slice(0, 10) : null,
          length_seconds: facts.duration_seconds,
          description: source.description,
          tags: source.tags,
          transcript,
        },
        facts: factLines(facts),
        fetched: facts.source === "youtube_api",
        rounded: facts.rounded,
        comments: source.comments,
        creator_note: input.note || null,
        target_platform: PLATFORM_LABELS[target],
      },
      schema: breakdownModelSchemaFor(platformTuple, pillarTuple),
      validate: parseBreakdownOutputFor({ platforms, pillarNames, referenceTitle: facts.title }),
    });
    if (!result.ok) {
      failed("ai", { code: result.code });
      return fail(result.code);
    }

    // 7. Honesty rules, then store.
    const honest = applyBreakdownHonesty(result.data, {
      hasText: Boolean(transcript || source.description),
      followersKnown: facts.followers !== null,
      creatorEntered: facts.source === "creator_entered",
      rounded: facts.rounded,
    });
    // Pasted comments are third-party text: sent to the model, never stored.
    const kept: CreatorInput = { ...input, comments: [], target_platform: target };
    const inserted = await client
      .from("video_breakdowns")
      .insert({
        user_id: userId,
        platform: link.platform,
        source_url: link.canonicalUrl,
        external_id: link.externalId,
        source_data: source.sourceData as unknown as Json,
        source_fetched_at: source.sourceData ? iso(now) : null,
        source_expires_at: source.sourceData ? iso(now + SOURCE_TTL_MS) : null,
        creator_input: kept as unknown as Json,
        // YouTube's numbers live in `source_data`, so they expire with it.
        facts: (source.sourceData ? emptyFacts("youtube_api") : facts) as unknown as Json,
        ai_generation_id: result.generationId,
        prompt_version: getPrompt("video_breakdown").version,
        breakdown: toStoredBreakdown(honest.breakdown, honest.capped) as unknown as Json,
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      failed("insert", { db_code: inserted.error?.code });
      return fail("persistence_error");
    }
    return { ok: true, breakdownId: inserted.data.id, reused: false };
  } catch (error) {
    unexpected("video_breakdown_failed", error);
    return fail("persistence_error");
  }
}

function manualSource(input: CreatorInput, now: number): Source {
  const facts: BreakdownFacts = computeFacts({
    source: "creator_entered",
    ...input.counts,
    durationSeconds: input.duration_seconds,
    publishedAt: input.posted_on ? `${input.posted_on}T00:00:00Z` : null,
    rounded: input.rounded,
    now,
  });
  return {
    facts: { ...facts, title: captionTitle(input.caption), author: null },
    sourceData: null,
    description: input.caption || null,
    tags: [],
    comments: input.comments,
  };
}

async function youtubeSource(
  admin: Client,
  userId: string,
  videoId: string,
  input: CreatorInput,
  env: EnvSource,
  now: number,
  fetchFn: FetchLike | undefined,
): Promise<{ ok: true; source: Source } | { ok: false; code: BreakdownErrorCode }> {
  const configured = readYouTubeConfig(env);
  if (!configured.ok) {
    logEvent("warn", "youtube_not_configured", { variables: configured.variables });
    return { ok: false, code: "not_configured_youtube" };
  }

  // The app-wide YouTube budget is shared with Research.
  const budget = await admin
    .from("usage_events")
    .select("quantity")
    .eq("event_type", USAGE_EVENT_TYPE)
    .gte("created_at", iso(now - DAY));
  if (budget.error) {
    failed("budget_check", { db_code: budget.error.code });
    return { ok: false, code: "persistence_error" };
  }
  const used = (budget.data ?? []).reduce((sum, row) => sum + (row.quantity ?? 0), 0);
  if (used + VIDEO_DETAILS_UNITS > configured.config.dailyUnitBudget) return { ok: false, code: "budget_exhausted" };

  const result = await fetchVideoDetails({ apiKey: configured.config.apiKey, videoId, fetch: fetchFn });
  // Meter every call that reached YouTube, success or not.
  if (result.unitsSpent > 0) {
    const metered = await admin.from("usage_events").insert({
      user_id: userId,
      event_type: USAGE_EVENT_TYPE,
      quantity: result.unitsSpent,
      metadata: { kind: BREAKDOWN_USAGE_KIND, outcome: result.ok ? "ok" : result.code } satisfies Json,
    });
    if (metered.error) logEvent("error", "youtube_usage_record_failed", { db_code: metered.error.code });
  }
  if (!result.ok) {
    failed("youtube", { code: result.code });
    return { ok: false, code: youtubeFailure(result.code) };
  }

  const { video } = result;
  const facts: StoredFacts = {
    ...computeFacts({
      source: "youtube_api",
      views: video.viewCount,
      likes: video.likeCount,
      comments: video.commentCount,
      shares: null,
      saves: null,
      followers: video.subscriberCount,
      durationSeconds: video.durationSeconds,
      publishedAt: video.publishedAt,
      rounded: false,
      now,
    }),
    title: video.title.slice(0, 300),
    author: video.channelTitle || null,
  };
  return {
    ok: true,
    source: {
      facts,
      sourceData: {
        title: facts.title ?? "",
        description: video.description,
        tags: video.tags,
        channel_title: video.channelTitle,
        published_at: video.publishedAt,
        facts,
      },
      description: video.description || input.caption || null,
      tags: video.tags,
      // The creator's own pick of comments wins over YouTube's top ones.
      comments: input.comments.length ? input.comments : video.comments,
    },
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface BreakdownDetail {
  id: string;
  created_at: string;
  platform: Platform;
  source_url: string;
  title: string | null;
  author: string | null;
  /** Null for a YouTube breakdown whose API data has expired. */
  facts: StoredFacts | null;
  /** When the YouTube data was fetched, for the "no longer stored" note. */
  fetchedAt: string | null;
  expired: boolean;
  /** Null when the stored content can't be read. */
  breakdown: StoredBreakdown | null;
  savedIdeaId: string | null;
  generationId: string | null;
  creatorInput: CreatorInput | null;
}

/** One of the creator's breakdowns, or `null` when it doesn't exist (or isn't theirs). Never throws. */
export async function getBreakdown(
  client: Client,
  userId: string,
  breakdownId: unknown,
): Promise<{ ok: true; breakdown: BreakdownDetail | null } | { ok: false }> {
  const id = uuid.safeParse(breakdownId);
  if (!id.success) return { ok: true, breakdown: null };
  try {
    const row = await client
      .from("video_breakdowns")
      .select("id, created_at, platform, source_url, source_data, source_fetched_at, creator_input, facts, ai_generation_id, breakdown")
      .eq("id", id.data)
      .eq("user_id", userId)
      .maybeSingle();
    if (row.error) {
      logEvent("error", "video_breakdown_read_failed", { stage: "detail", db_code: row.error.code });
      return { ok: false };
    }
    if (!row.data) return { ok: true, breakdown: null };
    const data = row.data;

    let savedIdeaId: string | null = null;
    if (data.ai_generation_id) {
      const idea = await client
        .from("content_ideas")
        .select("id")
        .eq("user_id", userId)
        .eq("ai_generation_id", data.ai_generation_id)
        .limit(1)
        .maybeSingle();
      if (idea.error) {
        logEvent("error", "video_breakdown_read_failed", { stage: "saved_idea", db_code: idea.error.code });
        return { ok: false };
      }
      savedIdeaId = idea.data?.id ?? null;
    }

    const parsedBreakdown = storedBreakdown.safeParse(data.breakdown);
    if (!parsedBreakdown.success) logEvent("warn", "video_breakdown_read_skipped", { stage: "validate" });
    const source = data.source_data === null ? null : storedSourceData.safeParse(data.source_data);
    const rowFacts = storedFacts.safeParse(data.facts);
    const facts = source?.success ? source.data.facts : rowFacts.success && rowFacts.data.source === "creator_entered" ? rowFacts.data : null;
    const input = creatorInput.safeParse(data.creator_input);
    const platform = platformSchema.safeParse(data.platform);

    return {
      ok: true,
      breakdown: {
        id: data.id,
        created_at: data.created_at,
        platform: platform.success ? platform.data : "other",
        source_url: data.source_url,
        title: facts?.title ?? null,
        author: facts?.author ?? null,
        facts,
        fetchedAt: data.source_fetched_at,
        expired: data.platform === "youtube" && data.source_data === null,
        breakdown: parsedBreakdown.success ? parsedBreakdown.data : null,
        savedIdeaId,
        generationId: data.ai_generation_id,
        creatorInput: input.success ? input.data : null,
      },
    };
  } catch (error) {
    unexpected("video_breakdown_read_failed", error);
    return { ok: false };
  }
}

export interface BreakdownSummary {
  id: string;
  created_at: string;
  platform: Platform;
  source_url: string;
  title: string | null;
}

/** The creator's breakdowns, newest first. Never throws. */
export async function listBreakdowns(
  client: Client,
  userId: string,
  limit: number = HISTORY_PAGE_SIZE,
): Promise<{ ok: true; items: BreakdownSummary[]; more: boolean } | { ok: false }> {
  const size = Math.min(Math.max(1, Math.floor(limit)), HISTORY_MAX);
  try {
    const { data, error } = await client
      .from("video_breakdowns")
      .select("id, created_at, platform, source_url, source_title:source_data->>title, fact_title:facts->>title")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(size + 1);
    if (error) {
      logEvent("error", "video_breakdown_read_failed", { stage: "list", db_code: error.code });
      return { ok: false };
    }
    const rows = (data ?? []) as unknown as {
      id: string;
      created_at: string;
      platform: string;
      source_url: string;
      source_title: string | null;
      fact_title: string | null;
    }[];
    return {
      ok: true,
      more: rows.length > size,
      items: rows.slice(0, size).map((row) => {
        const platform = platformSchema.safeParse(row.platform);
        return {
          id: row.id,
          created_at: row.created_at,
          platform: platform.success ? platform.data : "other",
          source_url: row.source_url,
          title: row.source_title || row.fact_title || null,
        };
      }),
    };
  } catch (error) {
    unexpected("video_breakdown_read_failed", error);
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Break it down again
// ---------------------------------------------------------------------------

const countText = (value: number | null) => (value === null ? "" : String(value));

/**
 * Re-runs a breakdown with the creator's stored input (YouTube refetches).
 * Always counts. Pasted comments were never stored, so they aren't reused.
 */
export async function rerunBreakdown(
  client: Client,
  admin: Client,
  userId: string,
  breakdownId: unknown,
  deps: BreakdownDeps,
): Promise<AnalyzeResult> {
  const loaded = await getBreakdown(client, userId, breakdownId);
  if (!loaded.ok) return fail("persistence_error");
  if (!loaded.breakdown || !loaded.breakdown.creatorInput) return fail("not_found");
  const { creatorInput: input, source_url: url } = loaded.breakdown;
  const values: BreakdownFormValues = {
    url,
    ...(Object.fromEntries(COUNT_FIELDS.map((field) => [field, countText(input.counts[field])])) as Record<
      (typeof COUNT_FIELDS)[number],
      string
    >),
    duration: countText(input.duration_seconds),
    posted_on: input.posted_on ?? "",
    caption: input.caption,
    transcript: input.transcript,
    top_comments: "",
    note: input.note,
    target_platform: input.target_platform ?? "",
  };
  // The plain numbers above lose their shorthand, so the stored flag carries it.
  return analyzeReferenceVideo(client, admin, userId, values, { force: true, rounded: input.rounded }, deps);
}

// ---------------------------------------------------------------------------
// Save "your version" as an idea
// ---------------------------------------------------------------------------

/**
 * Saves the breakdown's version as a saved idea with `competitor` evidence
 * pointing at the reference video. Idempotent through `ai_generation_id`.
 * Never throws.
 */
export async function saveBreakdownAsIdea(
  client: Client,
  userId: string,
  breakdownId: unknown,
): Promise<{ ok: true; ideaId: string } | BreakdownFailure> {
  try {
    const loaded = await getBreakdown(client, userId, breakdownId);
    if (!loaded.ok) return fail("idea_failed");
    const detail = loaded.breakdown;
    if (!detail) return fail("not_found");
    if (detail.savedIdeaId) return { ok: true, ideaId: detail.savedIdeaId };
    if (!detail.breakdown) {
      logEvent("error", "video_breakdown_idea_failed", { stage: "validate" });
      return fail("idea_failed");
    }

    const version = detail.breakdown.your_version;
    const pillar = await client
      .from("content_pillars")
      .select("id")
      .eq("user_id", userId)
      .eq("name", version.pillar_name)
      .limit(1)
      .maybeSingle();
    if (pillar.error) {
      logEvent("error", "video_breakdown_idea_failed", { stage: "pillar", db_code: pillar.error.code });
      return fail("idea_failed");
    }

    const label = detail.title ? `“${detail.title}”` : `a ${PLATFORM_LABELS[detail.platform]} video`;
    const sourceName = detail.author ? `${detail.author} on ${PLATFORM_LABELS[detail.platform]}` : PLATFORM_LABELS[detail.platform];
    const why = detail.breakdown.why_it_worked[0]?.observation ?? detail.breakdown.summary;
    const inserted = await client
      .from("content_ideas")
      .insert({
        user_id: userId,
        topic: version.topic,
        angle: version.angle,
        hook: version.hooks[0],
        format: version.format,
        platform: version.platform,
        pillar_id: pillar.data?.id ?? null,
        cta: version.cta,
        rationale: version.why_it_fits,
        status: "saved",
        source: "ai",
        ai_generation_id: detail.generationId,
        evidence: [
          {
            kind: "competitor",
            summary: `Breakdown of ${label}: ${why}`.slice(0, 1000),
            source: sourceName.slice(0, 200),
            source_url: detail.source_url,
            observed_at: detail.fetchedAt ?? detail.created_at,
          },
        ],
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) {
      logEvent("error", "video_breakdown_idea_failed", { stage: "insert", db_code: inserted.error?.code });
      return fail("idea_failed");
    }
    return { ok: true, ideaId: inserted.data.id };
  } catch (error) {
    unexpected("video_breakdown_idea_failed", error);
    return fail("idea_failed");
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Deletes one of the creator's breakdowns (RLS). Ideas saved from it are kept. Never throws. */
export async function deleteBreakdown(client: Client, userId: string, breakdownId: unknown): Promise<{ ok: true } | BreakdownFailure> {
  const id = uuid.safeParse(breakdownId);
  if (!id.success) return fail("not_found");
  try {
    const { error, count } = await client
      .from("video_breakdowns")
      .delete({ count: "exact" })
      .eq("id", id.data)
      .eq("user_id", userId);
    if (error) {
      logEvent("error", "video_breakdown_delete_failed", { db_code: error.code });
      return fail("persistence_error");
    }
    return count === 0 ? fail("not_found") : { ok: true };
  } catch (error) {
    unexpected("video_breakdown_delete_failed", error);
    return fail("persistence_error");
  }
}
