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

// ---------------------------------------------------------------------------
// One video's details (Video Breakdown)
// ---------------------------------------------------------------------------

/** `videos.list` + `channels.list` + `commentThreads.list`, 1 unit each. */
export const VIDEO_DETAILS_UNITS = 3;
export const DESCRIPTION_MAX = 3_000;
export const TAGS_MAX = 20;
export const COMMENTS_MAX = 20;
export const COMMENT_CHARS_MAX = 300;

export interface YouTubeVideoDetails {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  /** Null when the channel hides it or the read failed. */
  subscriberCount: number | null;
  /** Top comment text only: no authors, ids or avatars. Never stored. */
  comments: string[];
}

export type VideoDetailsErrorCode = YouTubeErrorCode | "video_unavailable";

export type VideoDetailsResult =
  | { ok: true; video: YouTubeVideoDetails; unitsSpent: number }
  | { ok: false; code: VideoDetailsErrorCode; unitsSpent: number };

/** ISO-8601 duration ("PT1M35S", "P1DT2H") → seconds; null for zero (live) or unreadable. */
export function parseIsoDuration(value: string | undefined): number | null {
  const match = value ? /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value) : null;
  if (!match) return null;
  const [, d, h, m, s] = match.map((part) => Number(part ?? 0));
  const seconds = d * 86_400 + h * 3_600 + m * 60 + s;
  return seconds > 0 ? seconds : null;
}

const detailsResponse = z.object({
  items: z
    .array(
      z
        .object({
          id: videoId,
          snippet: z
            .object({
              title: z.string().max(500),
              description: z.string().default(""),
              tags: z.array(z.string()).default([]),
              channelId: z.string().max(100),
              channelTitle: z.string().max(200).default(""),
              publishedAt: z.iso.datetime({ offset: true }),
            })
            .loose(),
          contentDetails: z.object({ duration: z.string().optional() }).loose().optional(),
          statistics: z.object({ viewCount: count, likeCount: count, commentCount: count }).loose().optional(),
        })
        .loose(),
    )
    .default([]),
});

const channelsResponse = z.object({
  items: z
    .array(
      z
        .object({
          statistics: z
            .object({ subscriberCount: count, hiddenSubscriberCount: z.boolean().optional() })
            .loose()
            .optional(),
        })
        .loose(),
    )
    .default([]),
});

const commentsResponse = z.object({
  items: z
    .array(
      z
        .object({
          snippet: z
            .object({
              topLevelComment: z
                .object({ snippet: z.object({ textOriginal: z.string() }).loose() })
                .loose(),
            })
            .loose(),
        })
        .loose(),
    )
    .default([]),
});

export interface VideoDetailsRequest {
  apiKey: string;
  videoId: string;
  fetch?: FetchLike;
}

const clip = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Title, description, tags, length and statistics of one public video, its
 * channel's subscriber count and up to 20 top comments. Never throws. A
 * missing channel count or comments (disabled, failed) is not a failure. A
 * request that reached YouTube counts toward quota even when it failed.
 */
export async function fetchVideoDetails(request: VideoDetailsRequest): Promise<VideoDetailsResult> {
  const fetchFn = request.fetch ?? (globalThis.fetch as unknown as FetchLike);
  if (!videoId.safeParse(request.videoId).success) return { ok: false, code: "video_unavailable", unitsSpent: 0 };

  const videoParams = new URLSearchParams({
    part: "snippet,statistics,contentDetails",
    id: request.videoId,
    key: request.apiKey,
  });
  const details = await call(fetchFn, `${YOUTUBE_API_BASE}/videos?${videoParams}`);
  let spent = details.ok || details.responded ? VIDEOS_UNITS : 0;
  if (!details.ok) return { ok: false, code: details.code, unitsSpent: spent };
  const parsed = detailsResponse.safeParse(details.body);
  if (!parsed.success) return { ok: false, code: "invalid_response", unitsSpent: spent };
  const item = parsed.data.items.find((entry) => entry.id === request.videoId);
  // Private, deleted or never existed: YouTube returns no item.
  if (!item) return { ok: false, code: "video_unavailable", unitsSpent: spent };

  const channelParams = new URLSearchParams({ part: "statistics", id: item.snippet.channelId, key: request.apiKey });
  const commentParams = new URLSearchParams({
    part: "snippet",
    videoId: request.videoId,
    order: "relevance",
    maxResults: String(COMMENTS_MAX),
    textFormat: "plainText",
    key: request.apiKey,
  });
  const [channel, comments] = await Promise.all([
    call(fetchFn, `${YOUTUBE_API_BASE}/channels?${channelParams}`),
    call(fetchFn, `${YOUTUBE_API_BASE}/commentThreads?${commentParams}`),
  ]);
  for (const result of [channel, comments]) if (result.ok || result.responded) spent += 1;

  let subscriberCount: number | null = null;
  if (channel.ok) {
    const stats = channelsResponse.safeParse(channel.body);
    const entry = stats.success ? stats.data.items[0]?.statistics : undefined;
    subscriberCount = entry && !entry.hiddenSubscriberCount ? entry.subscriberCount : null;
  }

  let topComments: string[] = [];
  if (comments.ok) {
    const thread = commentsResponse.safeParse(comments.body);
    if (thread.success) {
      topComments = thread.data.items
        .map((entry) => clip(entry.snippet.topLevelComment.snippet.textOriginal, COMMENT_CHARS_MAX))
        .filter(Boolean)
        .slice(0, COMMENTS_MAX);
    }
  }

  return {
    ok: true,
    unitsSpent: spent,
    video: {
      videoId: item.id,
      title: item.snippet.title,
      description: item.snippet.description.slice(0, DESCRIPTION_MAX),
      tags: item.snippet.tags.map((tag) => clip(tag, 100)).filter(Boolean).slice(0, TAGS_MAX),
      channelId: item.snippet.channelId,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      durationSeconds: parseIsoDuration(item.contentDetails?.duration),
      viewCount: item.statistics?.viewCount ?? null,
      likeCount: item.statistics?.likeCount ?? null,
      commentCount: item.statistics?.commentCount ?? null,
      subscriberCount,
      comments: topComments,
    },
  };
}
