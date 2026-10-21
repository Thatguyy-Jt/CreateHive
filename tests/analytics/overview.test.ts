import { describe, expect, it } from "vitest";
import type { CheckInValues } from "@/lib/analytics/baseline";
import { CHART_POST_LIMIT } from "@/lib/analytics/chart-data";
import {
  kpiDelta,
  NO_FORMAT,
  pickPlatform,
  platformOverview,
  TOP_POSTS_LIMIT,
  type OverviewPost,
} from "@/lib/analytics/overview";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-01-01T12:00:00Z");

const values = (extra: Partial<Omit<CheckInValues, "captured_at">>) => ({
  views: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  follower_delta: null,
  retention_rate: null,
  ...extra,
});

/** Post `i` is published on day `i`; settled (results from day i + 10) unless `early`. */
const post = (
  i: number,
  results: Partial<Omit<CheckInValues, "captured_at">> | null,
  extra: Partial<OverviewPost> = {},
  early = false,
): OverviewPost => ({
  id: `p${i}`,
  title: `Post ${i}`,
  format: null,
  platform: "youtube",
  published_at: new Date(START + i * DAY).toISOString(),
  video: false,
  latest: results ? { captured_at: new Date(START + (i + (early ? 1 : 10)) * DAY).toISOString(), ...values(results) } : null,
  ...extra,
});

const kpi = (overview: ReturnType<typeof platformOverview>, metric: string) =>
  overview.kpis.find((k) => k.metric === metric)!;

describe("kpiDelta", () => {
  it("is a ratio for views, engagement and % viewed, and a difference for follower change", () => {
    expect(kpiDelta("views", 1500, 1000)).toBeCloseTo(0.5);
    expect(kpiDelta("engagement_rate", 0.03, 0.04)).toBeCloseTo(-0.25);
    expect(kpiDelta("follower_delta", 12, 20)).toBe(-8);
    expect(kpiDelta("views", 10, 0)).toBeNull();
    expect(kpiDelta("follower_delta", 5, 0)).toBe(5);
  });
});

describe("platformOverview KPIs", () => {
  it("needs 3 settled values for a usual, and leaves the delta null without it", () => {
    const overview = platformOverview([post(1, { views: 100 }), post(2, { views: 300 })], "youtube");
    expect(kpi(overview, "views")).toMatchObject({ usual: null, sample: 2, delta: null });
    expect(kpi(overview, "views").latest).toEqual({ id: "p2", title: "Post 2", value: 300 });
  });

  it("uses the median of settled posts and compares the latest settled post with it", () => {
    const posts = [
      post(1, { views: 1000 }),
      post(2, { views: 800 }),
      post(3, { views: 1200 }),
      post(4, { views: 1500 }),
      post(5, { views: 9999 }, {}, true), // early: not in the usual, not "latest"
    ];
    const views = kpi(platformOverview(posts, "youtube"), "views");
    expect(views.usual).toBe(1100);
    expect(views.sample).toBe(4);
    expect(views.latest?.id).toBe("p4");
    expect(views.delta).toBeCloseTo(1500 / 1100 - 1);
  });

  it("gives a signed difference for follower change", () => {
    const posts = [1, 2, 3].map((i) => post(i, { follower_delta: i * 10 }));
    const followers = kpi(platformOverview(posts, "youtube"), "follower_delta");
    expect(followers.usual).toBe(20);
    expect(followers.delta).toBe(10);
  });

  it("only counts posts on the platform", () => {
    const posts = [post(1, { views: 1 }), post(2, { views: 2 }, { platform: "tiktok" })];
    const overview = platformOverview(posts, "youtube");
    expect(overview.posts).toBe(1);
    expect(kpi(overview, "views").sample).toBe(1);
  });
});

describe("platformOverview series", () => {
  it("keeps posts with the metric, oldest first, flagging early ones", () => {
    const posts = [post(3, { views: 30 }), post(1, { views: 10 }), post(2, null), post(4, { views: 40 }, {}, true)];
    const series = platformOverview(posts, "youtube").series;
    expect(series.views.map((p) => [p.id, p.value, p.settled])).toEqual([
      ["p1", 10, true],
      ["p3", 30, true],
      ["p4", 40, false],
    ]);
    expect(series.retention_rate).toEqual([]);
  });

  it("caps each series at the newest CHART_POST_LIMIT posts", () => {
    const posts = Array.from({ length: CHART_POST_LIMIT + 3 }, (_, i) => post(i + 1, { views: i }));
    const views = platformOverview(posts, "youtube").series.views;
    expect(views).toHaveLength(CHART_POST_LIMIT);
    expect(views[0].id).toBe("p4");
  });

  it("labels points as the post list does", () => {
    const posts = [post(1, { views: 1000 }), post(2, { views: 1000 }), post(3, { views: 1000 }), post(4, { views: 3000 })];
    const views = platformOverview(posts, "youtube").series.views;
    expect(views.find((p) => p.id === "p4")?.label).toBe("above");
  });
});

describe("platformOverview top posts, formats and mix", () => {
  const posts = [
    post(1, { views: 1000 }, { format: "Short" }),
    post(2, { views: 1000 }, { format: " short " }),
    post(3, { views: 1000 }, { format: "Long video" }),
    post(4, { views: 3000 }, { format: "short" }),
    post(5, { views: 400 }),
    post(6, { views: 5000 }, { format: "Short" }, true), // early: excluded
  ];
  const overview = platformOverview(posts, "youtube");

  it("ranks settled posts by views, up to the limit, with views against their own baseline", () => {
    // Equal views: newest first.
    expect(overview.topPosts.map((p) => p.id)).toEqual(["p4", "p3", "p2", "p1", "p5"]);
    expect(overview.topPosts.length).toBeLessThanOrEqual(TOP_POSTS_LIMIT);
    // p4 against p1, p2, p3, p5 → median 1000.
    expect(overview.topPosts[0].vsUsual).toBeCloseTo(2);
  });

  it("groups formats case- and space-insensitively under the most common spelling, with a No format group", () => {
    expect(overview.formats).toEqual([
      { format: "short", posts: 3, medianViews: 1000 }, // most common spelling
      { format: "Long video", posts: 1, medianViews: 1000 },
      { format: NO_FORMAT, posts: 1, medianViews: 400 },
    ]);
  });

  it("counts only settled, labelled posts in the mix", () => {
    const { above, around, below } = overview.mix;
    expect(above + around + below).toBe(5);
    expect(overview.mix).toEqual({ above: 1, around: 3, below: 1 });
  });
});

describe("pickPlatform", () => {
  const available = ["tiktok", "youtube", null] as const;

  it("accepts a platform the creator has posts on", () => {
    expect(pickPlatform("youtube", available)).toBe("youtube");
    expect(pickPlatform("none", available)).toBeNull();
    expect(pickPlatform(["youtube", "tiktok"], available)).toBe("youtube");
  });

  it("falls back to the first platform for anything else", () => {
    expect(pickPlatform(undefined, available)).toBe("tiktok");
    expect(pickPlatform("nonsense", available)).toBe("tiktok");
    expect(pickPlatform("instagram", available)).toBe("tiktok");
    expect(pickPlatform("none", ["youtube"])).toBe("youtube");
  });

  it("returns undefined with no platforms", () => {
    expect(pickPlatform("youtube", [])).toBeUndefined();
  });
});
