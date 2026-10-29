import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnvSource } from "@/lib/ai/env";
import { getAllowance } from "@/lib/billing/allowance";
import { planIncludes } from "@/lib/billing/features";
import { logEvent } from "@/lib/observability/log";
import { readYouTubeConfig, type YouTubeConfig } from "@/lib/research/env";
import {
  REFRESH_UNITS,
  searchTopVideos,
  type FetchLike,
  type YouTubeErrorCode,
  type YouTubeVideo,
} from "@/lib/research/youtube";
import { parseWith } from "@/lib/schemas/parse";
import { youtubeSignalPayload } from "@/lib/schemas/research";
import type { Database, Json } from "@/lib/supabase/database.types";

type Client = Pick<SupabaseClient<Database>, "from">;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** One successful refresh per creator per window. */
export const REFRESH_WINDOW_MS = DAY;
/** Attempts (including failures that reached YouTube) per creator per window. */
export const MAX_ATTEMPTS_PER_WINDOW = 3;
/** YouTube API data is kept this long, well inside the platform's storage limit. */
export const YOUTUBE_SIGNAL_TTL_MS = 7 * DAY;
export const USAGE_EVENT_TYPE = "youtube_api";
/** `metadata.kind` of Video Breakdown lookups metered under the same event type. */
export const BREAKDOWN_USAGE_KIND = "video_breakdown";
const QUERY_MAX = 300;

export type YouTubeRefreshCode =
  | "not_configured"
  | "plan_required"
  | "not_on_youtube"
  | "no_strategy"
  | "cached"
  | "too_many_attempts"
  | "budget_exhausted"
  | "db_error"
  | YouTubeErrorCode;

/** Creator-facing messages: what happened and what to do next. Never include provider text or the key. */
export const YOUTUBE_ERRORS: Record<YouTubeRefreshCode, string> = {
  not_configured: "YouTube research isn't set up yet.",
  plan_required: "YouTube research is included in Pro. Upgrade to use it.",
  not_on_youtube: "Add YouTube as a platform in your profile to use YouTube research.",
  no_strategy: "Build your strategy first, so we know which topics to look up.",
  cached: "You've already refreshed today. You can refresh again tomorrow.",
  too_many_attempts: "We couldn't reach YouTube after a few tries today. Please try again tomorrow.",
  budget_exhausted: "YouTube research has reached today's limit for everyone. Please try again tomorrow.",
  db_error: "We couldn't save the videos. Please try again in a moment.",
  quota_exceeded: "YouTube research has reached today's limit for everyone. Please try again tomorrow.",
  invalid_key: "We couldn't connect to YouTube right now. Please try again later.",
  rate_limited: "YouTube is busy. Please wait a minute and try again.",
  timeout: "YouTube took too long to respond. Please try again.",
  api_error: "We couldn't reach YouTube. Please try again in a moment.",
  invalid_response: "YouTube sent back something we couldn't read. Please try again later.",
};

export interface YouTubeDeps {
  env?: EnvSource;
  fetch?: FetchLike;
  now?: () => number;
}

export type YouTubeStatus =
  | { state: "not_configured" | "plan_required" | "not_on_youtube" | "no_strategy" | "budget_exhausted" | "error" }
  | { state: "available"; lastRefreshedAt: string | null }
  | { state: "cached" | "too_many_attempts"; lastRefreshedAt: string | null; nextRefreshAt: string };

export type RefreshResult =
  | { ok: true; added: number; nextRefreshAt: string }
  | { ok: false; code: YouTubeRefreshCode; message: string; nextRefreshAt?: string };

function fail(code: YouTubeRefreshCode, nextRefreshAt?: string): RefreshResult {
  return { ok: false, code, message: YOUTUBE_ERRORS[code], ...(nextRefreshAt ? { nextRefreshAt } : {}) };
}

function failed(event: string, stage: string, error: unknown) {
  logEvent("error", event, { stage, name: error instanceof Error ? error.name : typeof error });
}

const iso = (time: number) => new Date(time).toISOString();

/** Niche plus one pillar, rotating daily through the active pillars in order. Deterministic: no AI call. */
export function buildQuery(niche: string, pillars: readonly { name: string }[], now: number): string {
  const pillar = pillars.length ? pillars[Math.floor(now / DAY) % pillars.length].name : "";
  return `${niche} ${pillar}`.replace(/\s+/g, " ").trim().slice(0, QUERY_MAX);
}

type Eligibility =
  | { ok: true; config: YouTubeConfig; query: string; lastRefreshedAt: string | null }
  | { ok: false; status: YouTubeStatus };

/**
 * Everything checked before a call, in order: key configured, creator on
 * YouTube with a strategy, per-creator window, app-wide unit budget.
 * `client` is the creator's RLS client; `admin` reads quota usage only.
 */
async function checkEligibility(client: Client, admin: Client, userId: string, env: EnvSource, now: number): Promise<Eligibility> {
  const configured = readYouTubeConfig(env);
  if (!configured.ok) {
    logEvent("warn", "youtube_not_configured", { variables: configured.variables });
    return { ok: false, status: { state: "not_configured" } };
  }

  // A Pro feature: checked before any quota read or YouTube call.
  const { plan } = await getAllowance(admin, userId, now, env);
  if (!planIncludes(plan.id, "youtube_research")) return { ok: false, status: { state: "plan_required" } };

  const since = iso(now - REFRESH_WINDOW_MS);
  const [profile, pillars, latest, attempts, budget] = await Promise.all([
    client.from("creator_profiles").select("niche, platforms").eq("user_id", userId).maybeSingle(),
    client
      .from("content_pillars")
      .select("name, position")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("position", { ascending: true }),
    client
      .from("research_signals")
      .select("fetched_at")
      .eq("user_id", userId)
      .eq("source", "youtube")
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("usage_events")
      .select("created_at, metadata")
      .eq("user_id", userId)
      .eq("event_type", USAGE_EVENT_TYPE)
      .gte("created_at", since)
      .order("created_at", { ascending: false }),
    admin.from("usage_events").select("quantity").eq("event_type", USAGE_EVENT_TYPE).gte("created_at", since),
  ]);
  const error = [profile, pillars, latest, attempts, budget].find((r) => r.error)?.error;
  if (error) {
    logEvent("error", "youtube_refresh_failed", { stage: "eligibility", db_code: error.code });
    return { ok: false, status: { state: "error" } };
  }

  if (!profile.data?.platforms.includes("youtube")) return { ok: false, status: { state: "not_on_youtube" } };
  const niche = profile.data.niche?.trim();
  if (!niche || !pillars.data?.length) return { ok: false, status: { state: "no_strategy" } };

  const lastRefreshedAt = latest.data?.fetched_at ?? null;
  // Video Breakdown lookups share the event type (and the app-wide budget) but
  // not this per-creator refresh window.
  const tries = (attempts.data ?? []).filter(
    (row) => (row.metadata as { kind?: unknown } | null)?.kind !== BREAKDOWN_USAGE_KIND,
  );
  const success = tries.find((row) => (row.metadata as { outcome?: unknown } | null)?.outcome === "ok");
  if (success) {
    return {
      ok: false,
      status: { state: "cached", lastRefreshedAt, nextRefreshAt: iso(Date.parse(success.created_at) + REFRESH_WINDOW_MS) },
    };
  }
  if (tries.length >= MAX_ATTEMPTS_PER_WINDOW) {
    const oldest = tries[tries.length - 1];
    return {
      ok: false,
      status: {
        state: "too_many_attempts",
        lastRefreshedAt,
        nextRefreshAt: iso(Date.parse(oldest.created_at) + REFRESH_WINDOW_MS),
      },
    };
  }

  const used = (budget.data ?? []).reduce((sum, row) => sum + (row.quantity ?? 0), 0);
  if (used + REFRESH_UNITS > configured.config.dailyUnitBudget) {
    return { ok: false, status: { state: "budget_exhausted" } };
  }

  return { ok: true, config: configured.config, query: buildQuery(niche, pillars.data, now), lastRefreshedAt };
}

/** What the YouTube card should show. Never throws. */
export async function getYouTubeStatus(client: Client, admin: Client, userId: string, deps: YouTubeDeps = {}): Promise<YouTubeStatus> {
  try {
    const checked = await checkEligibility(client, admin, userId, deps.env ?? process.env, (deps.now ?? Date.now)());
    return checked.ok ? { state: "available", lastRefreshedAt: checked.lastRefreshedAt } : checked.status;
  } catch (error) {
    failed("youtube_refresh_failed", "status", error);
    return { state: "error" };
  }
}

/**
 * Research Agent, YouTube adapter: fetches recent popular videos for the
 * creator's niche and stores them as signals that expire after 7 days. Uses no
 * AI generations. Every call that reached YouTube is metered. Never throws.
 */
export async function refreshYouTubeSignals(
  client: Client,
  admin: Client,
  userId: string,
  deps: YouTubeDeps = {},
): Promise<RefreshResult> {
  const now = (deps.now ?? Date.now)();
  try {
    const checked = await checkEligibility(client, admin, userId, deps.env ?? process.env, now);
    if (!checked.ok) {
      const { status } = checked;
      if (status.state === "cached" || status.state === "too_many_attempts") return fail(status.state, status.nextRefreshAt);
      return fail(status.state === "error" || status.state === "available" ? "db_error" : status.state);
    }

    const result = await searchTopVideos({ apiKey: checked.config.apiKey, query: checked.query, now, fetch: deps.fetch });

    let outcome: YouTubeRefreshCode | "ok" = result.ok ? "ok" : result.code;
    let added = 0;
    if (result.ok) {
      const saved = await saveVideos(client, userId, result.videos, checked.query, now);
      if (saved.ok) added = saved.added;
      else outcome = "db_error";
    }

    // Meter every call that reached YouTube, success or not.
    if (result.unitsSpent > 0) {
      const metered = await admin.from("usage_events").insert({
        user_id: userId,
        event_type: USAGE_EVENT_TYPE,
        quantity: result.unitsSpent,
        metadata: { kind: "youtube_search", outcome } satisfies Json,
      });
      if (metered.error) logEvent("error", "youtube_usage_record_failed", { db_code: metered.error.code });
    }

    if (outcome !== "ok") {
      logEvent("error", "youtube_refresh_failed", { stage: "refresh", code: outcome });
      return fail(outcome);
    }
    return { ok: true, added, nextRefreshAt: iso(now + REFRESH_WINDOW_MS) };
  } catch (error) {
    failed("youtube_refresh_failed", "unexpected", error);
    return fail("db_error");
  }
}

async function saveVideos(
  client: Client,
  userId: string,
  videos: readonly YouTubeVideo[],
  query: string,
  now: number,
): Promise<{ ok: true; added: number } | { ok: false }> {
  // Expired API data is deleted, not just hidden.
  const expired = await client
    .from("research_signals")
    .delete()
    .eq("user_id", userId)
    .eq("source", "youtube")
    .lt("expires_at", iso(now));
  if (expired.error) {
    logEvent("error", "youtube_refresh_failed", { stage: "cleanup", db_code: expired.error.code });
    return { ok: false };
  }

  const rows = [];
  for (const video of videos) {
    const payload = parseWith(youtubeSignalPayload, {
      video_id: video.videoId,
      channel_title: video.channelTitle.slice(0, 200),
      published_at: video.publishedAt,
      view_count: video.viewCount,
      like_count: video.likeCount,
      comment_count: video.commentCount,
      query,
    });
    if (!payload.ok) continue;
    rows.push({
      user_id: userId,
      source: "youtube",
      external_id: video.videoId,
      signal_type: "video",
      title: video.title.slice(0, 300),
      source_url: `https://www.youtube.com/watch?v=${video.videoId}`,
      payload: payload.data as unknown as Json,
      fetched_at: iso(now),
      expires_at: iso(now + YOUTUBE_SIGNAL_TTL_MS),
    });
  }
  if (rows.length === 0) return { ok: true, added: 0 };

  const upserted = await client.from("research_signals").upsert(rows, { onConflict: "user_id,source,external_id" });
  if (upserted.error) {
    logEvent("error", "youtube_refresh_failed", { stage: "upsert", db_code: upserted.error.code });
    return { ok: false };
  }
  return { ok: true, added: rows.length };
}
