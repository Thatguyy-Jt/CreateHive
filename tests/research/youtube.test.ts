import { describe, expect, it, vi } from "vitest";
import { readYouTubeConfig } from "@/lib/research/env";
import { classifyYouTubeError, searchTopVideos, type FetchLike } from "@/lib/research/youtube";

const KEY = "AIza-test-key-123";
const NOW = Date.parse("2026-10-12T12:00:00Z");

const respond = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const searchBody = {
  items: [{ id: { videoId: "abcDEF12345" } }, { id: { videoId: "xyz_9876543" } }, { id: { channelId: "UCx" } }],
};
const videosBody = {
  items: [
    {
      id: "abcDEF12345",
      snippet: { title: "10 Minute Workout", channelTitle: "Example Fit", publishedAt: "2026-09-30T10:00:00Z" },
      statistics: { viewCount: "48210", likeCount: "900", commentCount: "31" },
    },
    {
      id: "xyz_9876543",
      snippet: { title: "Meal prep", channelTitle: "Kitchen", publishedAt: "2026-09-01T10:00:00Z" },
      statistics: {},
    },
  ],
};

function fakeFetch(...responses: (ReturnType<typeof respond> | Error)[]) {
  const urls: string[] = [];
  const fn = vi.fn<FetchLike>(async (url) => {
    urls.push(url);
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fn, urls };
}

describe("readYouTubeConfig", () => {
  it("requires the key and defaults the budget", () => {
    expect(readYouTubeConfig({})).toEqual({ ok: false, variables: ["YOUTUBE_API_KEY"] });
    expect(readYouTubeConfig({ YOUTUBE_API_KEY: KEY, YOUTUBE_DAILY_UNIT_BUDGET: " " })).toEqual({
      ok: true,
      config: { apiKey: KEY, dailyUnitBudget: 3000 },
    });
    expect(readYouTubeConfig({ YOUTUBE_API_KEY: KEY, YOUTUBE_DAILY_UNIT_BUDGET: "500" })).toMatchObject({
      config: { dailyUnitBudget: 500 },
    });
  });

  it("names invalid variables without echoing values", () => {
    const result = readYouTubeConfig({ YOUTUBE_API_KEY: KEY, YOUTUBE_DAILY_UNIT_BUDGET: "-5" });
    expect(result).toEqual({ ok: false, variables: ["YOUTUBE_DAILY_UNIT_BUDGET"] });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});

describe("searchTopVideos", () => {
  it("searches recent most-viewed videos, then reads their statistics (101 units)", async () => {
    const { fn, urls } = fakeFetch(respond(200, searchBody), respond(200, videosBody));
    const result = await searchTopVideos({ apiKey: KEY, query: "home fitness quick workouts", now: NOW, fetch: fn });

    expect(result).toEqual({
      ok: true,
      unitsSpent: 101,
      videos: [
        {
          videoId: "abcDEF12345",
          title: "10 Minute Workout",
          channelTitle: "Example Fit",
          publishedAt: "2026-09-30T10:00:00Z",
          viewCount: 48210,
          likeCount: 900,
          commentCount: 31,
        },
        {
          videoId: "xyz_9876543",
          title: "Meal prep",
          channelTitle: "Kitchen",
          publishedAt: "2026-09-01T10:00:00Z",
          viewCount: null,
          likeCount: null,
          commentCount: null,
        },
      ],
    });

    const search = new URL(urls[0]);
    expect(search.origin + search.pathname).toBe("https://www.googleapis.com/youtube/v3/search");
    expect(Object.fromEntries(search.searchParams)).toEqual({
      part: "snippet",
      type: "video",
      order: "viewCount",
      q: "home fitness quick workouts",
      publishedAfter: "2026-07-14T12:00:00.000Z",
      maxResults: "10",
      relevanceLanguage: "en",
      safeSearch: "moderate",
      key: KEY,
    });
    const videos = new URL(urls[1]);
    expect(videos.pathname).toBe("/youtube/v3/videos");
    expect(videos.searchParams.get("id")).toBe("abcDEF12345,xyz_9876543");
    expect(videos.searchParams.get("part")).toBe("snippet,statistics");
    expect(fn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("skips the videos call when the search finds nothing", async () => {
    const { fn } = fakeFetch(respond(200, { items: [] }));
    await expect(searchTopVideos({ apiKey: KEY, query: "q", now: NOW, fetch: fn })).resolves.toEqual({
      ok: true,
      videos: [],
      unitsSpent: 100,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, { error: { errors: [{ reason: "quotaExceeded" }] } }, "quota_exceeded"],
    [400, { error: { errors: [{ reason: "badRequest" }], details: [{ reason: "API_KEY_INVALID" }] } }, "invalid_key"],
    [403, { error: { errors: [{ reason: "accessNotConfigured" }] } }, "invalid_key"],
    [403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }, "rate_limited"],
    [429, {}, "rate_limited"],
    [500, { error: { errors: [{ reason: "backendError" }] } }, "api_error"],
  ] as const)("maps HTTP %i errors to %s and counts the search units", async (status, body, code) => {
    const { fn } = fakeFetch(respond(status, body));
    await expect(searchTopVideos({ apiKey: KEY, query: "q", now: NOW, fetch: fn })).resolves.toEqual({
      ok: false,
      code,
      unitsSpent: 100,
    });
  });

  it("maps a timeout and spends nothing when YouTube was never reached", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const { fn } = fakeFetch(timeout);
    await expect(searchTopVideos({ apiKey: KEY, query: "q", now: NOW, fetch: fn })).resolves.toEqual({
      ok: false,
      code: "timeout",
      unitsSpent: 0,
    });
  });

  it("rejects malformed responses", async () => {
    const malformed = { ...respond(200, null), json: async () => JSON.parse("{not json") };
    await expect(searchTopVideos({ apiKey: KEY, query: "q", now: NOW, fetch: fakeFetch(malformed).fn })).resolves.toEqual(
      { ok: false, code: "invalid_response", unitsSpent: 100 },
    );

    const badVideos = { items: [{ id: "abcDEF12345", snippet: { title: "t", publishedAt: "yesterday" } }] };
    await expect(
      searchTopVideos({ apiKey: KEY, query: "q", now: NOW, fetch: fakeFetch(respond(200, searchBody), respond(200, badVideos)).fn }),
    ).resolves.toEqual({ ok: false, code: "invalid_response", unitsSpent: 101 });
  });

  it("drops ids outside YouTube's alphabet so they never reach a stored link", async () => {
    const hostile = { items: [{ id: { videoId: "abc/../../evil" } }, { id: { videoId: "abcDEF12345" } }] };
    const { fn, urls } = fakeFetch(respond(200, hostile), respond(200, { items: [] }));
    await searchTopVideos({ apiKey: KEY, query: "q", now: NOW, fetch: fn });
    expect(new URL(urls[1]).searchParams.get("id")).toBe("abcDEF12345");
  });

  it("never puts the key in a result", async () => {
    const { fn } = fakeFetch(respond(400, { error: { message: `API key not valid: ${KEY}`, errors: [{ reason: "keyInvalid" }] } }));
    const result = await searchTopVideos({ apiKey: KEY, query: "q", now: NOW, fetch: fn });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
});

describe("classifyYouTubeError", () => {
  it("falls back to api_error for unreadable bodies", () => {
    expect(classifyYouTubeError(500, "nope")).toBe("api_error");
    expect(classifyYouTubeError(403, { error: { errors: [{ reason: "dailyLimitExceeded" }] } })).toBe("quota_exceeded");
  });
});
