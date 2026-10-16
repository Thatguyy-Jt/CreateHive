import { describe, expect, it } from "vitest";
import type { BaselinePost, CheckInValues } from "@/lib/analytics/baseline";
import { CHART_POST_LIMIT, chartPointsFor, niceTicks, signedDomain } from "@/lib/analytics/chart-data";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-01-01T12:00:00Z");

const latest = (views: number | null, capturedDay: number): CheckInValues => ({
  captured_at: new Date(START + capturedDay * DAY).toISOString(),
  views,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  follower_delta: null,
  retention_rate: null,
});

/** Post `i` is published on day `i`; settled unless `early`. */
const post = (i: number, views: number | null, extra: Partial<BaselinePost> = {}, early = false) => ({
  id: `p${i}`,
  title: `Post ${i}`,
  platform: "youtube" as const,
  published_at: new Date(START + i * DAY).toISOString(),
  video: false,
  latest: latest(views, early ? i + 1 : i + 10),
  ...extra,
});

describe("chartPointsFor", () => {
  it("keeps the platform's posts with views, oldest first, labelled like the list", () => {
    const posts = [
      post(5, 2000),
      post(4, 1000),
      post(3, null),
      post(2, 800),
      post(1, 1200),
      post(6, 50, { platform: "tiktok" }),
      post(7, 999, {}, true),
    ];
    const points = chartPointsFor(posts, "youtube");
    expect(points.map((p) => p.id)).toEqual(["p1", "p2", "p4", "p5", "p7"]);
    expect(points.find((p) => p.id === "p5")).toMatchObject({ views: 2000, settled: true, label: "above" });
    expect(points.find((p) => p.id === "p7")).toMatchObject({ settled: false, label: null });
  });

  it(`keeps only the newest ${CHART_POST_LIMIT}`, () => {
    const posts = Array.from({ length: 30 }, (_, i) => post(i, 100 + i));
    const points = chartPointsFor(posts, "youtube");
    expect(points).toHaveLength(CHART_POST_LIMIT);
    expect(points[0].id).toBe("p10");
    expect(points.at(-1)!.id).toBe("p29");
  });
});

describe("niceTicks", () => {
  it("uses clean steps from 0 that cover the max", () => {
    expect(niceTicks(2000)).toEqual([0, 500, 1000, 1500, 2000]);
    expect(niceTicks(2100)).toEqual([0, 1000, 2000, 3000]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0.045)).toEqual([0, 0.02, 0.04, 0.06]);
  });

  it("gives a scale for a flat chart", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe("signedDomain", () => {
  it("always contains 0 and pads both sides", () => {
    expect(signedDomain([10, 4])).toEqual([0, 11.5]);
    expect(signedDomain([-4, 2])).toEqual([-4.6, 2.3]);
    expect(signedDomain([0])).toEqual([0, 1]);
  });
});
