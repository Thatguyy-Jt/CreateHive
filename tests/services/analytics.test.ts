import { describe, expect, it } from "vitest";
import { ANALYTICS_ERRORS, MAX_CHECKINS, MAX_POSTS } from "@/lib/schemas/analytics";
import {
  addResults,
  deletePost,
  deleteResults,
  getAnalyticsOverview,
  getPerformanceSummary,
  getPost,
  logPastPost,
  publishStudioItem,
  updatePostDetails,
} from "@/lib/services/analytics";
import { fakeSupabase, pgError, type FakeResult, type RecordedQuery } from "./fake-supabase";

const USER_ID = "user_analytics";
const ITEM_ID = "8b3e30bf-6f2c-4daf-9c59-2f309f4dbe33";
const SNAPSHOT_ID = "6f1c1f9e-4d0a-4b8e-9a37-0d1f7e2b9c11";
const TZ = "Africa/Lagos"; // UTC+1, no DST
// Fri 2026-10-16 10:00 in Lagos.
const NOW = Date.parse("2026-10-16T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

const details = { date: "2026-10-15", time: "09:30", published_url: "", hook_used: "", duration_seconds: "" };
const results = { views: "1200", likes: "80" };

const scopedTo = (query: RecordedQuery, ...filters: [string, ...unknown[]][]) => {
  for (const filter of filters) expect(query.filters).toContainEqual(filter);
};

const byOp = (handlers: Partial<Record<RecordedQuery["op"], FakeResult>>) => (query: RecordedQuery) =>
  handlers[query.op] ?? new Error(`unexpected ${query.op} on ${query.table}`);

describe("publishStudioItem", () => {
  const item = (status = "scheduled", format = "short") => ({ data: { status, platform: "youtube", format } });

  it("converts the local date and calls publish_content_item with only the given details", async () => {
    const { client, queries, rpcCalls } = fakeSupabase({ content_items: item() }, () => ({ data: null }));
    const result = await publishStudioItem(
      client,
      USER_ID,
      ITEM_ID,
      { ...details, hook_used: "Stop squatting wrong", duration_seconds: "0:45" },
      TZ,
      NOW,
    );
    expect(result).toEqual({ ok: true });
    scopedTo(queries[0], ["eq", "id", ITEM_ID], ["eq", "user_id", USER_ID]);
    expect(rpcCalls).toEqual([
      {
        name: "publish_content_item",
        args: {
          p_item_id: ITEM_ID,
          p_published_at: "2026-10-15T08:30:00.000Z",
          p_hook_used: "Stop squatting wrong",
          p_duration_seconds: 45,
        },
      },
    ]);
  });

  it("refuses published items, other creators' items and bad ids without calling the database function", async () => {
    for (const [handler, id, code] of [
      [item("published"), ITEM_ID, "not_publishable"],
      [{ data: null }, ITEM_ID, "not_found"],
      [item(), "not-a-uuid", "not_found"],
    ] as const) {
      const { client, rpcCalls } = fakeSupabase({ content_items: handler });
      const result = await publishStudioItem(client, USER_ID, id, details, TZ, NOW);
      expect(result).toMatchObject({ ok: false, code });
      expect(rpcCalls).toEqual([]);
    }
  });

  it("returns field errors for invalid input", async () => {
    const { client } = fakeSupabase({ content_items: item() });
    const result = await publishStudioItem(client, USER_ID, ITEM_ID, { ...details, published_url: "http://x" }, TZ, NOW);
    expect(result).toMatchObject({ ok: false, code: "invalid_input", fieldErrors: { published_url: expect.any(String) } });
  });

  it("refuses a time more than an hour ahead, even today", async () => {
    const { client, rpcCalls } = fakeSupabase({ content_items: item() });
    const result = await publishStudioItem(client, USER_ID, ITEM_ID, { ...details, date: "2026-10-16", time: "23:00" }, TZ, NOW);
    expect(result).toMatchObject({ ok: false, code: "date_out_of_range", fieldErrors: { date: expect.any(String) } });
    expect(rpcCalls).toEqual([]);
  });

  it("maps database tokens", async () => {
    for (const [message, code] of [
      ["item_not_found", "not_found"],
      ["item_not_publishable", "not_publishable"],
      ["published_at_out_of_range", "date_out_of_range"],
      ["something else", "db_error"],
    ] as const) {
      const { client } = fakeSupabase({ content_items: item() }, () => ({ error: pgError("P0001", message) }));
      expect(await publishStudioItem(client, USER_ID, ITEM_ID, details, TZ, NOW)).toMatchObject({ ok: false, code });
    }
  });

  it("needs a usable timezone", async () => {
    const { client } = fakeSupabase({});
    expect(await publishStudioItem(client, USER_ID, ITEM_ID, details, "Not/AZone", NOW)).toMatchObject({
      code: "missing_timezone",
    });
  });
});

describe("logPastPost", () => {
  const past = { ...details, title: "Old video", platform: "youtube", format: "long-form", duration_seconds: "8:00" };

  it("counts posts, then inserts a published item scoped to the creator", async () => {
    const { client, queries } = fakeSupabase({
      content_items: (query) => (query.op === "select" ? { count: 3 } : { data: { id: ITEM_ID } }),
    });
    expect(await logPastPost(client, USER_ID, past, TZ, NOW)).toEqual({ ok: true, itemId: ITEM_ID });
    scopedTo(queries[0], ["eq", "user_id", USER_ID], ["eq", "status", "published"]);
    expect(queries[1]).toMatchObject({
      op: "insert",
      payload: {
        user_id: USER_ID,
        title: "Old video",
        platform: "youtube",
        format: "long-form",
        status: "published",
        published_at: "2026-10-15T08:30:00.000Z",
        published_url: null,
        hook_used: null,
        duration_seconds: 480,
      },
    });
  });

  it(`stops at ${MAX_POSTS} posts without inserting`, async () => {
    const { client, queries } = fakeSupabase({ content_items: { count: MAX_POSTS } });
    expect(await logPastPost(client, USER_ID, past, TZ, NOW)).toMatchObject({ ok: false, code: "post_limit" });
    expect(queries.map((q) => q.op)).toEqual(["select"]);
  });

  it("validates before touching the database", async () => {
    const { client, queries } = fakeSupabase({});
    expect(await logPastPost(client, USER_ID, { ...past, title: "" }, TZ, NOW)).toMatchObject({
      code: "invalid_input",
      fieldErrors: { title: expect.any(String) },
    });
    expect(queries).toEqual([]);
  });
});

describe("updatePostDetails", () => {
  const read = (ideaId: string | null, firstCapturedAt: string | null = null) =>
    fakeSupabase({
      content_items: byOp({
        select: { data: { idea_id: ideaId, platform: "youtube", format: "short" } },
        update: { data: [{ id: ITEM_ID }] },
      }),
      analytics_snapshots: { data: firstCapturedAt ? { captured_at: firstCapturedAt } : null },
    });

  it("lets posts logged outside Studio change title and platform", async () => {
    const { client, queries } = read(null);
    const input = { ...details, title: "Renamed", platform: "tiktok", format: "" };
    expect(await updatePostDetails(client, USER_ID, ITEM_ID, input, TZ, NOW)).toEqual({ ok: true });
    const update = queries.find((q) => q.op === "update")!;
    expect(update.payload).toMatchObject({ title: "Renamed", platform: "tiktok", format: null });
    scopedTo(update, ["eq", "id", ITEM_ID], ["eq", "user_id", USER_ID], ["eq", "status", "published"]);
  });

  it("keeps Studio posts' title and platform", async () => {
    const { client, queries } = read("idea-1");
    const input = { ...details, title: "Sneaky", platform: "tiktok" };
    expect(await updatePostDetails(client, USER_ID, ITEM_ID, input, TZ, NOW)).toEqual({ ok: true });
    const payload = queries.find((q) => q.op === "update")!.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("title");
    expect(payload).not.toHaveProperty("platform");
  });

  it("refuses moving the date after the first results", async () => {
    const { client, queries } = read("idea-1", "2026-10-15T00:00:00Z");
    expect(await updatePostDetails(client, USER_ID, ITEM_ID, details, TZ, NOW)).toMatchObject({
      code: "date_after_results",
    });
    expect(queries.some((q) => q.op === "update")).toBe(false);
  });

  it("is not_found for a post that isn't published or isn't theirs", async () => {
    const { client } = fakeSupabase({ content_items: { data: null }, analytics_snapshots: { data: null } });
    expect(await updatePostDetails(client, USER_ID, ITEM_ID, details, TZ, NOW)).toMatchObject({ code: "not_found" });
  });
});

describe("deletePost and deleteResults", () => {
  it("deletes only the creator's published post", async () => {
    const { client, queries } = fakeSupabase({ content_items: { data: [{ id: ITEM_ID }] } });
    expect(await deletePost(client, USER_ID, ITEM_ID)).toEqual({ ok: true });
    scopedTo(queries[0], ["eq", "id", ITEM_ID], ["eq", "user_id", USER_ID], ["eq", "status", "published"]);
    expect(queries[0].op).toBe("delete");
  });

  it("is not_found when nothing was deleted", async () => {
    const { client } = fakeSupabase({ content_items: { data: [] }, analytics_snapshots: { data: [] } });
    expect(await deletePost(client, USER_ID, ITEM_ID)).toMatchObject({ code: "not_found" });
    expect(await deleteResults(client, USER_ID, SNAPSHOT_ID)).toMatchObject({ code: "not_found" });
  });

  it("deletes one check-in and returns its post", async () => {
    const { client, queries } = fakeSupabase({ analytics_snapshots: { data: [{ content_item_id: ITEM_ID }] } });
    expect(await deleteResults(client, USER_ID, SNAPSHOT_ID)).toEqual({ ok: true, itemId: ITEM_ID });
    scopedTo(queries[0], ["eq", "id", SNAPSHOT_ID], ["eq", "user_id", USER_ID]);
  });
});

describe("addResults", () => {
  const post = (overrides: Record<string, unknown> = {}) => ({
    data: { status: "published", platform: "youtube", format: "short", published_at: daysAgo(2), duration_seconds: 40, ...overrides },
  });
  const setup = (item: FakeResult, count = 0, insert: FakeResult = {}) =>
    fakeSupabase({
      content_items: item,
      analytics_snapshots: (query) => (query.op === "select" ? { count } : insert),
    });

  it("inserts a manual snapshot with the post's platform", async () => {
    const { client, queries } = setup(post());
    expect(await addResults(client, USER_ID, ITEM_ID, { ...results, avg_percent_viewed: "50" }, NOW)).toEqual({ ok: true });
    const insert = queries.find((q) => q.op === "insert")!;
    expect(insert.payload).toEqual({
      user_id: USER_ID,
      content_item_id: ITEM_ID,
      platform: "youtube",
      source: "manual",
      views: 1200,
      likes: 80,
      comments: null,
      shares: null,
      saves: null,
      follower_delta: null,
      avg_view_duration_seconds: null,
      retention_rate: 0.5,
    });
  });

  it("refuses unpublished, future, missing and full posts without inserting", async () => {
    for (const [item, count, code] of [
      [post({ status: "scheduled" }), 0, "not_published"],
      [post({ published_at: daysAgo(-1) }), 0, "not_yet_published"],
      [{ data: null }, 0, "not_found"],
      [post(), MAX_CHECKINS, "checkin_limit"],
    ] as const) {
      const { client, queries } = setup(item, count);
      expect(await addResults(client, USER_ID, ITEM_ID, results, NOW)).toMatchObject({ ok: false, code });
      expect(queries.some((q) => q.op === "insert")).toBe(false);
    }
  });

  it("reports an empty form as empty_results and bad fields as invalid_input", async () => {
    const empty = setup(post());
    expect(await addResults(empty.client, USER_ID, ITEM_ID, {}, NOW)).toMatchObject({
      code: "empty_results",
      message: ANALYTICS_ERRORS.empty_results,
    });
    const bad = setup(post());
    expect(await addResults(bad.client, USER_ID, ITEM_ID, { avg_view_duration_seconds: "50" }, NOW)).toMatchObject({
      code: "invalid_input",
      fieldErrors: { avg_view_duration_seconds: expect.any(String) },
    });
  });

  it("fails closed when counting fails", async () => {
    const { client } = fakeSupabase({
      content_items: post(),
      analytics_snapshots: { error: pgError() },
    });
    expect(await addResults(client, USER_ID, ITEM_ID, results, NOW)).toMatchObject({ code: "db_error" });
  });
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

let n = 0;
const checkIn = (captured: string, views: number | null) => ({
  id: `s-${++n}`,
  captured_at: captured,
  views,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  follower_delta: null,
  avg_view_duration_seconds: null,
  retention_rate: null,
});

const postRow = (id: string, publishedDaysAgo: number, snapshots: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  title: `Post ${id}`,
  platform: "youtube",
  format: "short",
  published_at: daysAgo(publishedDaysAgo),
  idea_id: null,
  pillar: null,
  analytics_snapshots: snapshots,
  ...extra,
});

// Newest first, as the query orders them.
const rows = [
  postRow("new", 1, []),
  postRow("early", 9, [checkIn(daysAgo(8), 50)]),
  postRow("a", 20, [checkIn(daysAgo(5), 2000)]),
  postRow("b", 30, [checkIn(daysAgo(5), 1000)]),
  postRow("c", 40, [checkIn(daysAgo(5), 800)]),
  postRow("d", 50, [checkIn(daysAgo(5), 1200)]),
];

describe("getAnalyticsOverview", () => {
  it("reads published posts with their latest check-in, and builds the list, needs-results and summaries", async () => {
    const { client, queries } = fakeSupabase({ content_items: { data: rows } });
    const result = await getAnalyticsOverview(client, USER_ID, NOW);
    if (!result.ok) throw new Error("expected ok");
    scopedTo(queries[0], ["eq", "user_id", USER_ID], ["eq", "status", "published"], ["limit", 1, { referencedTable: "analytics_snapshots" }]);

    const { overview } = result;
    expect(overview.posts.map((p) => p.id)).toEqual(["new", "early", "a", "b", "c", "d"]);
    // a: 2000 against b, c, d → median 1000.
    expect(overview.posts.find((p) => p.id === "a")!.comparison.headline).toEqual({ metric: "views", label: "above" });
    expect(overview.posts.find((p) => p.id === "early")!.comparison.headline).toBeNull();
    expect(overview.needsResults.map((p) => p.id)).toEqual(["early", "new"]);
    expect(overview.platforms).toEqual([
      { platform: "youtube", posts: 6, settled: 4, usualViews: 1100, usualEngagementRate: null },
    ]);
    expect(overview.truncated).toBe(false);
    // One chart per platform: posts with views, oldest first.
    expect(overview.charts).toHaveLength(1);
    expect(overview.charts[0].points.map((p) => [p.id, p.views, p.settled])).toEqual([
      ["d", 1200, true],
      ["c", 800, true],
      ["b", 1000, true],
      ["a", 2000, true],
      ["early", 50, false],
    ]);
  });

  it("skips rows that don't validate and fails on read errors", async () => {
    const skipped = fakeSupabase({ content_items: { data: [...rows, { id: 1 }] } });
    const ok = await getAnalyticsOverview(skipped.client, USER_ID, NOW);
    expect(ok.ok && ok.overview.posts).toHaveLength(6);

    const failed = fakeSupabase({ content_items: { error: pgError() } });
    expect(await getAnalyticsOverview(failed.client, USER_ID, NOW)).toEqual({ ok: false });
  });
});

describe("getPost", () => {
  const detail = {
    ...postRow("a", 20, [checkIn(daysAgo(19), 300), checkIn(daysAgo(5), 2000)]),
    id: ITEM_ID,
    idea_id: "idea-1",
    published_url: "https://youtube.com/shorts/1",
    hook_used: "Hook",
    duration_seconds: 40,
  };
  const client = (row: FakeResult) =>
    fakeSupabase({
      content_items: (query) => (query.filters.some((f) => f[0] === "eq" && f[1] === "id")
        ? row
        : // The summaries hold this post under its own id; "a" stands in for it.
          { data: rows.filter((r) => r.id !== "a") }),
    });

  it("returns the post, its check-ins oldest first with day numbers, and its comparison", async () => {
    const { client: c, queries } = client({ data: detail });
    const result = await getPost(c, USER_ID, ITEM_ID, TZ, NOW);
    if (!result.ok) throw new Error("expected ok");
    scopedTo(queries[0], ["eq", "id", ITEM_ID], ["eq", "user_id", USER_ID], ["eq", "status", "published"]);
    expect(result.post.checkIns.map((c) => [c.views, c.day])).toEqual([
      [300, 1],
      [2000, 15],
    ]);
    expect(result.post).toMatchObject({ from_studio: true, video: true, live: true, date: "2026-09-26" });
    expect(result.post.comparison.metrics.find((m) => m.metric === "views")).toMatchObject({ median: 1000, label: "above" });
  });

  it("is not_found for bad ids and missing, unpublished or other creators' posts", async () => {
    expect(await getPost(client({ data: null }).client, USER_ID, ITEM_ID, TZ, NOW)).toEqual({ ok: false, code: "not_found" });
    expect(await getPost(client({ data: detail }).client, USER_ID, "x", TZ, NOW)).toEqual({ ok: false, code: "not_found" });
  });
});

describe("getPerformanceSummary", () => {
  it("returns the latest settled post and what needs results", async () => {
    const { client } = fakeSupabase({ content_items: { data: rows } });
    const result = await getPerformanceSummary(client, USER_ID, NOW);
    if (!result.ok) throw new Error("expected ok");
    expect(result.summary.totalPosts).toBe(6);
    expect(result.summary.latestSettled?.id).toBe("a");
    expect(result.summary.needsResultsCount).toBe(2);
    expect(result.summary.firstNeedsResults?.id).toBe("early");
    expect(result.summary.spark).toMatchObject({ platform: "youtube", usualViews: 1100 });
    expect(result.summary.spark?.points.map((p) => p.id)).toEqual(["d", "c", "b", "a", "early"]);
  });

  it("handles a creator with no posts", async () => {
    const { client } = fakeSupabase({ content_items: { data: [] } });
    expect(await getPerformanceSummary(client, USER_ID, NOW)).toEqual({
      ok: true,
      summary: { totalPosts: 0, latestSettled: null, needsResultsCount: 0, firstNeedsResults: null, spark: null },
    });
  });
});
