import { describe, expect, it } from "vitest";
import {
  ABOVE_RATIO,
  BELOW_RATIO,
  baselineFor,
  compare,
  engagementRate,
  headlineFor,
  isSettled,
  latestCheckIn,
  median,
  MIN_BASELINE_POSTS,
  needsResults,
  platformSummaries,
  type BaselinePost,
  type CheckInValues,
} from "@/lib/analytics/baseline";

const DAY = 24 * 60 * 60 * 1000;
const PUBLISHED = "2026-09-01T12:00:00.000Z";
const at = (days: number, from = PUBLISHED) => new Date(Date.parse(from) + days * DAY).toISOString();

const values = (overrides: Partial<CheckInValues> = {}): CheckInValues => ({
  captured_at: at(10),
  views: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  follower_delta: null,
  retention_rate: null,
  ...overrides,
});

let next = 0;
const post = (overrides: Partial<BaselinePost> & { latest?: CheckInValues | null } = {}): BaselinePost => ({
  id: `post-${++next}`,
  platform: "youtube",
  published_at: PUBLISHED,
  video: false,
  latest: values(),
  ...overrides,
});

const peersWithViews = (...views: number[]) => views.map((v) => post({ latest: values({ views: v }) }));

describe("latestCheckIn", () => {
  it("picks the one captured last, whatever the order", () => {
    const a = { captured_at: at(1) };
    const b = { captured_at: at(9) };
    const c = { captured_at: at(3) };
    expect(latestCheckIn([a, b, c])).toBe(b);
    expect(latestCheckIn([])).toBeNull();
  });
});

describe("isSettled", () => {
  it("needs a check-in captured at least 7 days after publishing", () => {
    expect(isSettled({ published_at: PUBLISHED, latest: values({ captured_at: at(7) }) })).toBe(true);
    expect(isSettled({ published_at: PUBLISHED, latest: values({ captured_at: at(6.99) }) })).toBe(false);
    expect(isSettled({ published_at: PUBLISHED, latest: null })).toBe(false);
  });
});

describe("engagementRate", () => {
  it("is (likes + comments + shares + saves) / views over the known parts", () => {
    expect(engagementRate(values({ views: 1000, likes: 30, comments: 5, shares: 3, saves: 2 }))).toBeCloseTo(0.04);
    expect(engagementRate(values({ views: 200, likes: 10 }))).toBeCloseTo(0.05);
  });

  it("is null without views, with zero views, or with none of the four", () => {
    expect(engagementRate(values({ likes: 10 }))).toBeNull();
    expect(engagementRate(values({ views: 0, likes: 10 }))).toBeNull();
    expect(engagementRate(values({ views: 100 }))).toBeNull();
  });
});

describe("median", () => {
  it("handles odd, even and empty lists without mutating them", () => {
    const list = [5, 1, 3];
    expect(median(list)).toBe(3);
    expect(list).toEqual([5, 1, 3]);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("compare", () => {
  it("uses the ratio thresholds", () => {
    expect(compare(ABOVE_RATIO * 100, 100, "views")).toBe("above");
    expect(compare(124, 100, "views")).toBe("around");
    expect(compare(81, 100, "views")).toBe("around");
    expect(compare(BELOW_RATIO * 100, 100, "views")).toBe("below");
  });

  it("treats a zero usual as above for any positive value", () => {
    expect(compare(1, 0, "views")).toBe("above");
    expect(compare(0, 0, "views")).toBe("around");
  });

  it("compares follower change by difference, with a margin of at least 1", () => {
    expect(compare(10, 8, "follower_delta")).toBe("above"); // margin 2
    expect(compare(9, 8, "follower_delta")).toBe("around");
    expect(compare(6, 8, "follower_delta")).toBe("below");
    expect(compare(1, 0, "follower_delta")).toBe("above"); // margin 1
    expect(compare(-1, 0, "follower_delta")).toBe("below");
    expect(compare(-30, -40, "follower_delta")).toBe("above"); // margin 10
  });
});

describe("baselineFor", () => {
  it("compares a settled post with the median of its other settled posts on the platform", () => {
    const self = post({ latest: values({ views: 2000 }) });
    const peers = peersWithViews(800, 1000, 1500);
    const result = baselineFor(self, [self, ...peers]);
    const views = result.metrics.find((m) => m.metric === "views")!;
    expect(views).toEqual({ metric: "views", value: 2000, median: 1000, sampleSize: 3, label: "above" });
    expect(result.settled).toBe(true);
    expect(result.peers).toBe(3);
    expect(result.headline).toEqual({ metric: "views", label: "above" });
  });

  it("excludes the post itself, other platforms and unsettled posts", () => {
    const self = post({ latest: values({ views: 100 }) });
    const tiktok = post({ platform: "tiktok", latest: values({ views: 1 }) });
    const early = post({ latest: values({ views: 1, captured_at: at(2) }) });
    const result = baselineFor(self, [self, tiktok, early, ...peersWithViews(100, 100)]);
    const views = result.metrics.find((m) => m.metric === "views")!;
    expect(views.sampleSize).toBe(2);
    expect(views.median).toBeNull();
    expect(views.label).toBeNull();
    expect(result.headline).toBeNull();
  });

  it(`needs ${MIN_BASELINE_POSTS} peers with that metric`, () => {
    const self = post({ latest: values({ views: 100, likes: 10 }) });
    const peers = [
      post({ latest: values({ views: 100, likes: 5 }) }),
      post({ latest: values({ views: 100, likes: 5 }) }),
      post({ latest: values({ views: 100 }) }),
    ];
    const result = baselineFor(self, [self, ...peers]);
    expect(result.metrics.find((m) => m.metric === "views")!.label).toBe("around");
    const engagement = result.metrics.find((m) => m.metric === "engagement_rate")!;
    expect(engagement.sampleSize).toBe(2);
    expect(engagement.label).toBeNull();
  });

  it("never labels an early post, but still reports its age and the baseline", () => {
    const self = post({ latest: values({ views: 5000, captured_at: at(2) }) });
    const result = baselineFor(self, [self, ...peersWithViews(100, 100, 100)]);
    expect(result.settled).toBe(false);
    expect(result.ageDays).toBe(2);
    expect(result.metrics.find((m) => m.metric === "views")).toMatchObject({ median: 100, label: null });
    expect(result.headline).toBeNull();
  });

  it("only compares average % viewed for video posts", () => {
    expect(baselineFor(post(), []).metrics.map((m) => m.metric)).not.toContain("retention_rate");
    expect(baselineFor(post({ video: true }), []).metrics.map((m) => m.metric)).toContain("retention_rate");
  });

  it("handles a post with no check-ins", () => {
    const result = baselineFor(post({ latest: null }), peersWithViews(1, 2, 3));
    expect(result).toMatchObject({ settled: false, ageDays: null, headline: null });
  });
});

describe("headlineFor", () => {
  it("falls back to engagement rate when views can't be labelled", () => {
    expect(
      headlineFor([
        { metric: "views", value: null, median: 10, sampleSize: 3, label: null },
        { metric: "engagement_rate", value: 0.1, median: 0.05, sampleSize: 3, label: "above" },
      ]),
    ).toEqual({ metric: "engagement_rate", label: "above" });
  });
});

describe("platformSummaries", () => {
  it("groups by platform, most posts first, with medians only from 3 settled values", () => {
    const summaries = platformSummaries([
      ...peersWithViews(100, 200, 300),
      post({ latest: values({ views: 999, captured_at: at(1) }) }),
      post({ platform: "tiktok", latest: values({ views: 50 }) }),
    ]);
    expect(summaries).toEqual([
      { platform: "youtube", posts: 4, settled: 3, usualViews: 200, usualEngagementRate: null },
      { platform: "tiktok", posts: 1, settled: 1, usualViews: null, usualEngagementRate: null },
    ]);
  });
});

describe("needsResults", () => {
  const now = Date.parse(at(10));

  it("lists posts with no results, and early-only ones a week after publishing, oldest first", () => {
    const none = post({ published_at: at(9), latest: null });
    const earlyOld = post({ published_at: at(0), latest: values({ captured_at: at(1) }) });
    const earlyNew = post({ published_at: at(8), latest: values({ captured_at: at(9) }) });
    const settled = post();
    const future = post({ published_at: at(11), latest: null });
    expect(needsResults([none, earlyNew, settled, earlyOld, future], now)).toEqual([earlyOld, none]);
  });
});
