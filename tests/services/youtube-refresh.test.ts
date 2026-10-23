import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "@/lib/research/youtube";
import {
  buildQuery,
  getYouTubeStatus,
  refreshYouTubeSignals,
  YOUTUBE_ERRORS,
} from "@/lib/services/youtube-refresh";
import { fakeSupabase, pgError, type FakeResult, type RecordedQuery } from "./fake-supabase";

const USER_ID = "user_youtube";
const KEY = "AIza-test-key-123";
const NOW = Date.parse("2026-10-12T12:00:00Z");
const ENV = { YOUTUBE_API_KEY: KEY };
const DAY = 24 * 60 * 60 * 1000;

const profileRow = { niche: "Home fitness", platforms: ["youtube", "tiktok"] };
const pillarRows = [
  { name: "Quick workouts", position: 0 },
  { name: "Kitchen fuel", position: 1 },
];

interface Options {
  profile?: unknown;
  pillars?: readonly unknown[];
  attempts?: { created_at: string; metadata: unknown }[];
  budgetRows?: { quantity: number }[];
  usageError?: FakeResult["error"];
  upsert?: FakeResult;
  cleanup?: FakeResult;
  /** The creator's subscription; Pro by default (YouTube research is a Pro feature). null → Free. */
  subscription?: Record<string, unknown> | null;
}

const PRO_ROW = {
  plan: "pro",
  status: "active",
  provider: "paystack",
  current_period_end: "2099-01-01T00:00:00Z",
  cancel_at_period_end: true,
};

function setup(options: Options = {}) {
  const user = fakeSupabase({
    creator_profiles: { data: options.profile === undefined ? profileRow : options.profile },
    content_pillars: { data: options.pillars ?? pillarRows },
    research_signals: (q: RecordedQuery) => {
      if (q.op === "upsert") return options.upsert ?? {};
      if (q.op === "delete") return options.cleanup ?? {};
      return { data: { fetched_at: "2026-10-01T00:00:00+00:00" } };
    },
  });
  const admin = fakeSupabase({
    subscriptions: { data: options.subscription === undefined ? PRO_ROW : options.subscription },
    usage_events: (q: RecordedQuery) => {
      if (q.op === "insert") return {};
      if (options.usageError) return { error: options.usageError };
      const perUser = q.filters.some(([m, col]) => m === "eq" && col === "user_id");
      return { data: perUser ? (options.attempts ?? []) : (options.budgetRows ?? []) };
    },
  });
  return { user, admin };
}

const okFetch = () =>
  vi.fn<FetchLike>(async (url) => {
    const body = url.includes("/search?")
      ? { items: [{ id: { videoId: "abcDEF12345" } }, { id: { videoId: "xyz_9876543" } }] }
      : {
          items: [
            {
              id: "abcDEF12345",
              snippet: { title: "10 Minute Workout", channelTitle: "Example Fit", publishedAt: "2026-09-30T10:00:00Z" },
              statistics: { viewCount: "48210" },
            },
            {
              id: "xyz_9876543",
              snippet: { title: "Meal prep", channelTitle: "Kitchen", publishedAt: "2026-09-01T10:00:00Z" },
            },
          ],
        };
    return { ok: true, status: 200, json: async () => body };
  });

const failingFetch = (status: number, reason: string) =>
  vi.fn<FetchLike>(async () => ({ ok: false, status, json: async () => ({ error: { errors: [{ reason }] } }) }));

let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  errorLog.mockRestore();
  warnLog.mockRestore();
});

const usageInserts = (queries: RecordedQuery[]) => queries.filter((q) => q.table === "usage_events" && q.op === "insert");

describe("refreshYouTubeSignals", () => {
  it("fetches, cleans up expired rows, upserts videos with a 7-day expiry and meters 101 units", async () => {
    const { user, admin } = setup();
    const fetch = okFetch();
    const result = await refreshYouTubeSignals(user.client, admin.client, USER_ID, { env: ENV, fetch, now: () => NOW });

    expect(result).toEqual({ ok: true, added: 2, nextRefreshAt: new Date(NOW + DAY).toISOString() });

    const cleanup = user.queries.find((q) => q.op === "delete")!;
    expect(cleanup.filters).toEqual([
      ["eq", "user_id", USER_ID],
      ["eq", "source", "youtube"],
      ["lt", "expires_at", "2026-10-12T12:00:00.000Z"],
    ]);

    const upsert = user.queries.find((q) => q.op === "upsert")!;
    expect(upsert.options).toEqual({ onConflict: "user_id,source,external_id" });
    expect((upsert.payload as unknown[])[0]).toEqual({
      user_id: USER_ID,
      source: "youtube",
      external_id: "abcDEF12345",
      signal_type: "video",
      title: "10 Minute Workout",
      source_url: "https://www.youtube.com/watch?v=abcDEF12345",
      payload: {
        video_id: "abcDEF12345",
        channel_title: "Example Fit",
        published_at: "2026-09-30T10:00:00Z",
        view_count: 48210,
        like_count: null,
        comment_count: null,
        query: buildQuery("Home fitness", pillarRows, NOW),
      },
      fetched_at: "2026-10-12T12:00:00.000Z",
      expires_at: "2026-10-19T12:00:00.000Z",
    });

    expect(usageInserts(admin.queries).map((q) => q.payload)).toEqual([
      {
        user_id: USER_ID,
        event_type: "youtube_api",
        quantity: 101,
        metadata: { kind: "youtube_search", outcome: "ok" },
      },
    ]);
  });

  it.each([
    ["no key", { env: {} }, {}, "not_configured"],
    ["not on YouTube", { env: ENV }, { profile: { ...profileRow, platforms: ["tiktok"] } }, "not_on_youtube"],
    ["no pillars", { env: ENV }, { pillars: [] }, "no_strategy"],
    ["no niche", { env: ENV }, { profile: { ...profileRow, niche: " " } }, "no_strategy"],
  ] as const)("refuses with %s and makes no API call", async (_label, deps, options, code) => {
    const { user, admin } = setup(options);
    const fetch = okFetch();
    const result = await refreshYouTubeSignals(user.client, admin.client, USER_ID, { ...deps, fetch, now: () => NOW });
    expect(result).toMatchObject({ ok: false, code, message: YOUTUBE_ERRORS[code] });
    expect(fetch).not.toHaveBeenCalled();
    expect(usageInserts(admin.queries)).toEqual([]);
  });

  it("returns cached within 24h of a successful refresh, with no API call", async () => {
    const at = "2026-10-12T08:00:00.000Z";
    const { user, admin } = setup({ attempts: [{ created_at: at, metadata: { kind: "youtube_search", outcome: "ok" } }] });
    const fetch = okFetch();
    const result = await refreshYouTubeSignals(user.client, admin.client, USER_ID, { env: ENV, fetch, now: () => NOW });
    expect(result).toEqual({
      ok: false,
      code: "cached",
      message: YOUTUBE_ERRORS.cached,
      nextRefreshAt: "2026-10-13T08:00:00.000Z",
    });
    expect(fetch).not.toHaveBeenCalled();
    const check = admin.queries.find((q) => q.table === "usage_events" && q.filters.some(([, col]) => col === "user_id"))!;
    expect(check.filters).toEqual(
      expect.arrayContaining([
        ["eq", "event_type", "youtube_api"],
        ["gte", "created_at", "2026-10-11T12:00:00.000Z"],
      ]),
    );
  });

  it("stops after 3 failed attempts in 24h", async () => {
    const failedTry = (h: number) => ({ created_at: `2026-10-12T0${h}:00:00.000Z`, metadata: { outcome: "api_error" } });
    const { user, admin } = setup({ attempts: [failedTry(9), failedTry(8), failedTry(7)] });
    const fetch = okFetch();
    await expect(
      refreshYouTubeSignals(user.client, admin.client, USER_ID, { env: ENV, fetch, now: () => NOW }),
    ).resolves.toMatchObject({ ok: false, code: "too_many_attempts", nextRefreshAt: "2026-10-13T07:00:00.000Z" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses when the app-wide budget can't cover a refresh", async () => {
    const { user, admin } = setup({ budgetRows: [{ quantity: 101 }, { quantity: 101 }] });
    const fetch = okFetch();
    await expect(
      refreshYouTubeSignals(user.client, admin.client, USER_ID, {
        env: { ...ENV, YOUTUBE_DAILY_UNIT_BUDGET: "300" },
        fetch,
        now: () => NOW,
      }),
    ).resolves.toMatchObject({ ok: false, code: "budget_exhausted" });
    expect(fetch).not.toHaveBeenCalled();
    const budget = admin.queries.find((q) => !q.filters.some(([, col]) => col === "user_id"))!;
    expect(budget.filters).toEqual([
      ["eq", "event_type", "youtube_api"],
      ["gte", "created_at", "2026-10-11T12:00:00.000Z"],
    ]);
  });

  it("fails closed when quota usage can't be read", async () => {
    const { user, admin } = setup({ usageError: pgError() });
    const fetch = okFetch();
    await expect(
      refreshYouTubeSignals(user.client, admin.client, USER_ID, { env: ENV, fetch, now: () => NOW }),
    ).resolves.toMatchObject({ ok: false, code: "db_error" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("meters a failed call that reached YouTube, stores nothing, and never leaks the key", async () => {
    const { user, admin } = setup();
    const result = await refreshYouTubeSignals(user.client, admin.client, USER_ID, {
      env: ENV,
      fetch: failingFetch(400, "keyInvalid"),
      now: () => NOW,
    });
    expect(result).toEqual({ ok: false, code: "invalid_key", message: YOUTUBE_ERRORS.invalid_key });
    expect(user.queries.some((q) => q.op === "upsert" || q.op === "delete")).toBe(false);
    expect(usageInserts(admin.queries).map((q) => q.payload)).toEqual([
      expect.objectContaining({ quantity: 100, metadata: { kind: "youtube_search", outcome: "invalid_key" } }),
    ]);
    const logged = [...errorLog.mock.calls, ...warnLog.mock.calls].flat().join(" ");
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(USER_ID);
  });

  it("records a save failure so a paid fetch isn't counted as a successful refresh", async () => {
    const { user, admin } = setup({ upsert: { error: pgError() } });
    await expect(
      refreshYouTubeSignals(user.client, admin.client, USER_ID, { env: ENV, fetch: okFetch(), now: () => NOW }),
    ).resolves.toMatchObject({ ok: false, code: "db_error" });
    expect(usageInserts(admin.queries)[0].payload).toMatchObject({ quantity: 101, metadata: { outcome: "db_error" } });
  });
});

describe("buildQuery", () => {
  it("rotates daily through the pillars", () => {
    const day0 = Math.floor(NOW / DAY) * DAY;
    const queries = [0, 1, 2].map((d) => buildQuery("Home  fitness", pillarRows, day0 + d * DAY));
    expect(new Set(queries).size).toBe(2);
    expect(queries[0]).toBe(queries[2]);
    expect(queries[0]).toMatch(/^Home fitness (Quick workouts|Kitchen fuel)$/);
  });

  it("is capped at 300 characters", () => {
    expect(buildQuery("x".repeat(400), pillarRows, NOW)).toHaveLength(300);
  });
});

describe("getYouTubeStatus", () => {
  it("is available with the last refresh time when nothing blocks a refresh", async () => {
    const { user, admin } = setup();
    await expect(getYouTubeStatus(user.client, admin.client, USER_ID, { env: ENV, now: () => NOW })).resolves.toEqual({
      state: "available",
      lastRefreshedAt: "2026-10-01T00:00:00+00:00",
    });
  });

  it("explains a missing key without showing a button", async () => {
    const { user, admin } = setup();
    await expect(getYouTubeStatus(user.client, admin.client, USER_ID, { env: {}, now: () => NOW })).resolves.toEqual({
      state: "not_configured",
    });
  });
});

describe("YouTube research is a Pro feature", () => {
  it("tells a Free creator it's in Pro, before any quota read or YouTube call", async () => {
    const { user, admin } = setup({ subscription: null });
    const fetch = okFetch();

    await expect(getYouTubeStatus(user.client, admin.client, USER_ID, { env: ENV, now: () => NOW })).resolves.toEqual({
      state: "plan_required",
    });
    const refreshed = await refreshYouTubeSignals(user.client, admin.client, USER_ID, { env: ENV, fetch, now: () => NOW });

    expect(refreshed).toEqual({ ok: false, code: "plan_required", message: YOUTUBE_ERRORS.plan_required });
    expect(fetch).not.toHaveBeenCalled();
    expect(admin.queries.filter((q) => q.table === "usage_events")).toEqual([]);
    expect(user.queries).toEqual([]);
  });
});
