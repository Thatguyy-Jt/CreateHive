import { describe, expect, it, vi } from "vitest";
import { fetchVideoDetails, parseIsoDuration, type FetchLike } from "@/lib/research/youtube";

const KEY = "AIza-test-key-123";
const ID = "dQw4w9WgXcQ";

const video = {
  id: ID,
  snippet: {
    title: "How I film on a phone",
    description: "A".repeat(4_000),
    tags: ["phone", "filming"],
    channelId: "UC123",
    channelTitle: "Phone Films",
    publishedAt: "2026-10-01T10:00:00Z",
  },
  contentDetails: { duration: "PT1M35S" },
  statistics: { viewCount: "48210", likeCount: "2100", commentCount: "130" },
};

const respond = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

function fetchWith(overrides: { videos?: unknown; channels?: unknown; comments?: unknown; videosStatus?: number; commentsStatus?: number } = {}) {
  return vi.fn<FetchLike>(async (url) => {
    if (url.includes("/videos?")) return respond(overrides.videosStatus ?? 200, overrides.videos ?? { items: [video] });
    if (url.includes("/channels?")) return respond(200, overrides.channels ?? { items: [{ statistics: { subscriberCount: "12000" } }] });
    return respond(
      overrides.commentsStatus ?? 200,
      overrides.comments ?? {
        items: [
          { snippet: { topLevelComment: { snippet: { textOriginal: "This   helped me so much", authorDisplayName: "Someone" } } } },
          { snippet: { topLevelComment: { snippet: { textOriginal: "x".repeat(500) } } } },
        ],
      },
    );
  });
}

describe("parseIsoDuration", () => {
  it.each([
    ["PT1M35S", 95],
    ["PT2H", 7200],
    ["P1DT1S", 86_401],
    ["P0D", null],
    ["nonsense", null],
    [undefined, null],
  ])("%s → %s", (value, expected) => {
    expect(parseIsoDuration(value)).toBe(expected);
  });
});

describe("fetchVideoDetails", () => {
  it("returns details, subscriber count and top comment text, spending 3 units", async () => {
    const fetch = fetchWith();
    const result = await fetchVideoDetails({ apiKey: KEY, videoId: ID, fetch });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unitsSpent).toBe(3);
    expect(result.video).toMatchObject({
      title: "How I film on a phone",
      channelTitle: "Phone Films",
      durationSeconds: 95,
      viewCount: 48_210,
      likeCount: 2_100,
      commentCount: 130,
      subscriberCount: 12_000,
      tags: ["phone", "filming"],
    });
    expect(result.video.description).toHaveLength(3_000);
    expect(result.video.comments[0]).toBe("This helped me so much");
    expect(result.video.comments[1]).toHaveLength(300);
    // Comment authors are never read into the result.
    expect(JSON.stringify(result.video)).not.toContain("Someone");
    const urls = fetch.mock.calls.map(([url]) => url);
    expect(urls[0]).toContain("part=snippet%2Cstatistics%2CcontentDetails");
    expect(urls.some((url) => url.includes("/commentThreads?") && url.includes("order=relevance"))).toBe(true);
  });

  it("treats disabled comments and a hidden subscriber count as missing, not as failures", async () => {
    const fetch = fetchWith({
      channels: { items: [{ statistics: { hiddenSubscriberCount: true, subscriberCount: "0" } }] },
      comments: { error: { errors: [{ reason: "commentsDisabled" }] } },
      commentsStatus: 403,
    });
    const result = await fetchVideoDetails({ apiKey: KEY, videoId: ID, fetch });
    expect(result).toMatchObject({ ok: true, unitsSpent: 3, video: { subscriberCount: null, comments: [] } });
  });

  it("reports a private or deleted video as unavailable after one call", async () => {
    const fetch = fetchWith({ videos: { items: [] } });
    expect(await fetchVideoDetails({ apiKey: KEY, videoId: ID, fetch })).toEqual({
      ok: false,
      code: "video_unavailable",
      unitsSpent: 1,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps quota errors and counts the unit", async () => {
    const fetch = fetchWith({ videosStatus: 403, videos: { error: { errors: [{ reason: "quotaExceeded" }] } } });
    expect(await fetchVideoDetails({ apiKey: KEY, videoId: ID, fetch })).toEqual({
      ok: false,
      code: "quota_exceeded",
      unitsSpent: 1,
    });
  });

  it("spends nothing on a network failure or an invalid id", async () => {
    const down = vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await fetchVideoDetails({ apiKey: KEY, videoId: ID, fetch: down })).toEqual({ ok: false, code: "api_error", unitsSpent: 0 });
    expect(await fetchVideoDetails({ apiKey: KEY, videoId: "bad id!", fetch: down })).toEqual({
      ok: false,
      code: "video_unavailable",
      unitsSpent: 0,
    });
  });
});
