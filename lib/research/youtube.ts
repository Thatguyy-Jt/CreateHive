import "server-only";
import { z } from "zod";

// YouTube Data API v3 adapter: official API only, server-side only. The key
// travels in the request URL to googleapis.com and nowhere else: it is never
// logged, returned or put in an error. Every response is validated.

export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_TIMEOUT_MS = 10_000;
/** Quota cost per call (YouTube Data API v3). */
export const SEARCH_UNITS = 100;
export const VIDEOS_UNITS = 1;
export const REFRESH_UNITS = SEARCH_UNITS + VIDEOS_UNITS;
export const MAX_RESULTS = 10;
export const PUBLISHED_WITHIN_DAYS = 90;

export type YouTubeErrorCode =
  | "quota_exceeded"
  | "invalid_key"
  | "rate_limited"
  | "timeout"
  | "api_error"
  | "invalid_response";

export interface YouTubeVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
}

export type YouTubeSearchResult =
  | { ok: true; videos: YouTubeVideo[]; unitsSpent: number }
  | { ok: false; code: YouTubeErrorCode; unitsSpent: number };

export type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** YouTube's id alphabet only: ids end up in stored links. */
const videoId = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);

const searchResponse = z.object({
  items: z
    .array(z.object({ id: z.object({ videoId: z.string().optional() }).loose() }).loose())
    .default([]),
});

const count = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .optional()
  .transform((value) => value ?? null);

const videosResponse = z.object({
  items: z
    .array(
      z
        .object({
          id: videoId,
          snippet: z
            .object({
              title: z.string().max(500),
              channelTitle: z.string().max(200).default(""),
              publishedAt: z.iso.datetime({ offset: true }),
            })
            .loose(),
          statistics: z.object({ viewCount: count, likeCount: count, commentCount: count }).loose().optional(),
        })
        .loose(),
    )
    .default([]),
});

const errorResponse = z.object({
  error: z
    .object({
      errors: z.array(z.object({ reason: z.string().optional() }).loose()).optional(),
      details: z.array(z.object({ reason: z.string().optional() }).loose()).optional(),
    })
    .loose(),
});

const QUOTA_REASONS = new Set(["quotaExceeded", "dailyLimitExceeded"]);
const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);
const KEY_REASONS = new Set(["keyInvalid", "API_KEY_INVALID", "accessNotConfigured", "SERVICE_DISABLED", "keyExpired"]);

/** Maps an HTTP error response to a code using Google's documented error reasons. */
export function classifyYouTubeError(status: number, body: unknown): YouTubeErrorCode {
  const parsed = errorResponse.safeParse(body);
  const reasons = parsed.success
    ? [...(parsed.data.error.errors ?? []), ...(parsed.data.error.details ?? [])]
        .map((entry) => entry.reason)
        .filter((reason): reason is string => Boolean(reason))
    : [];
  if (reasons.some((reason) => QUOTA_REASONS.has(reason))) return "quota_exceeded";
  if (status === 429 || reasons.some((reason) => RATE_REASONS.has(reason))) return "rate_limited";
  if (reasons.some((reason) => KEY_REASONS.has(reason))) return "invalid_key";
  return "api_error";
}

type CallResult = { ok: true; body: unknown } | { ok: false; code: YouTubeErrorCode; responded: boolean };

async function call(fetchFn: FetchLike, url: string): Promise<CallResult> {
  try {
    const response = await fetchFn(url, {
      signal: AbortSignal.timeout(YOUTUBE_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, code: response.ok ? "invalid_response" : "api_error", responded: true };
    }
    if (!response.ok) return { ok: false, code: classifyYouTubeError(response.status, body), responded: true };
    return { ok: true, body };
  } catch (error) {
    const name = error instanceof Error || (typeof DOMException === "function" && error instanceof DOMException) ? error.name : "";
    return { ok: false, code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "api_error", responded: false };
  }
}

export interface SearchRequest {
  apiKey: string;
  query: string;
  now: number;
  fetch?: FetchLike;
}

/**
 * Recent, most-viewed videos for a query: one `search.list` (100 units) and
 * one `videos.list` (1 unit) for titles and statistics. Never throws. A
 * request that reached YouTube counts toward quota even when it failed.
 */
export async function searchTopVideos(request: SearchRequest): Promise<YouTubeSearchResult> {
  const fetchFn = request.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const publishedAfter = new Date(request.now - PUBLISHED_WITHIN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const searchParams = new URLSearchParams({
    part: "snippet",
    type: "video",
    order: "viewCount",
    q: request.query,
    publishedAfter,
    maxResults: String(MAX_RESULTS),
    relevanceLanguage: "en",
    safeSearch: "moderate",
    key: request.apiKey,
  });
  const search = await call(fetchFn, `${YOUTUBE_API_BASE}/search?${searchParams}`);
  if (!search.ok) return { ok: false, code: search.code, unitsSpent: search.responded ? SEARCH_UNITS : 0 };

  const searched = searchResponse.safeParse(search.body);
  if (!searched.success) return { ok: false, code: "invalid_response", unitsSpent: SEARCH_UNITS };
  const ids = [
    ...new Set(
      searched.data.items
        .map((item) => item.id.videoId)
        .filter((id): id is string => videoId.safeParse(id).success),
    ),
  ];
  if (ids.length === 0) return { ok: true, videos: [], unitsSpent: SEARCH_UNITS };

  const videoParams = new URLSearchParams({ part: "snippet,statistics", id: ids.join(","), key: request.apiKey });
  const details = await call(fetchFn, `${YOUTUBE_API_BASE}/videos?${videoParams}`);
  const spent = SEARCH_UNITS + (details.ok || details.responded ? VIDEOS_UNITS : 0);
  if (!details.ok) return { ok: false, code: details.code, unitsSpent: spent };

  const parsed = videosResponse.safeParse(details.body);
  if (!parsed.success) return { ok: false, code: "invalid_response", unitsSpent: spent };

  return {
    ok: true,
    unitsSpent: spent,
    videos: parsed.data.items.map((item) => ({
      videoId: item.id,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      viewCount: item.statistics?.viewCount ?? null,
      likeCount: item.statistics?.likeCount ?? null,
      commentCount: item.statistics?.commentCount ?? null,
    })),
  };
}
