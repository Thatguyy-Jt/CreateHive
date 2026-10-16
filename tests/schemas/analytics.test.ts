import { describe, expect, it } from "vitest";
import {
  formatDuration,
  isHttpsUrl,
  parseDuration,
  pastPostInputFor,
  postDateRange,
  publishInputFor,
  resultsInputFor,
  storedCheckIn,
} from "@/lib/schemas/analytics";

const TODAY = "2026-10-16";
const details = { date: "2026-10-15", time: "09:30", published_url: "", hook_used: "", duration_seconds: "" };
const emptyResults = {
  views: "",
  likes: "",
  comments: "",
  shares: "",
  saves: "",
  follower_delta: "",
  avg_view_duration_seconds: "",
  avg_percent_viewed: "",
};

const issuePaths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join(".")) ?? [];

describe("duration helpers", () => {
  it("parses seconds, m:ss and h:mm:ss", () => {
    expect(parseDuration("95")).toBe(95);
    expect(parseDuration("1:35")).toBe(95);
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration(" ")).toBeNull();
    expect(parseDuration("1:75")).toBeNaN();
    expect(parseDuration("abc")).toBeNaN();
  });

  it("formats back", () => {
    expect(formatDuration(95)).toBe("1:35");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(5)).toBe("0:05");
  });
});

describe("isHttpsUrl", () => {
  it("accepts https only", () => {
    expect(isHttpsUrl("https://youtube.com/watch?v=1")).toBe(true);
    expect(isHttpsUrl("http://youtube.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("youtube.com")).toBe(false);
  });
});

describe("publishInputFor", () => {
  it("normalises empty optional fields to null", () => {
    const parsed = publishInputFor({ today: TODAY, video: true }).parse(details);
    expect(parsed).toEqual({ date: "2026-10-15", time: "09:30", published_url: null, hook_used: null, duration_seconds: null });
  });

  it("treats optional fields a form leaves out as empty", () => {
    expect(publishInputFor({ today: TODAY, video: false }).parse({ date: "2026-10-15", time: "09:30" })).toEqual({
      date: "2026-10-15",
      time: "09:30",
      published_url: null,
      hook_used: null,
      duration_seconds: null,
    });
    expect(resultsInputFor({ video: false, durationSeconds: null }).parse({ views: "5" })).toMatchObject({ views: 5, likes: null });
  });

  it("keeps the length for video and drops it otherwise", () => {
    const input = { ...details, duration_seconds: "0:45", hook_used: "  Stop doing this  " };
    expect(publishInputFor({ today: TODAY, video: true }).parse(input)).toMatchObject({ duration_seconds: 45, hook_used: "Stop doing this" });
    expect(publishInputFor({ today: TODAY, video: false }).parse(input).duration_seconds).toBeNull();
  });

  it("rejects future dates, dates over 2 years old, bad links, long hooks and bad lengths", () => {
    const schema = publishInputFor({ today: TODAY, video: true });
    expect(issuePaths(schema.safeParse({ ...details, date: "2026-10-17" }))).toEqual(["date"]);
    expect(issuePaths(schema.safeParse({ ...details, date: postDateRange(TODAY).min }))).toEqual([]);
    expect(issuePaths(schema.safeParse({ ...details, date: "2024-10-15" }))).toEqual(["date"]);
    expect(issuePaths(schema.safeParse({ ...details, published_url: "http://x.com" }))).toEqual(["published_url"]);
    expect(issuePaths(schema.safeParse({ ...details, hook_used: "x".repeat(301) }))).toEqual(["hook_used"]);
    expect(issuePaths(schema.safeParse({ ...details, duration_seconds: "90000" }))).toEqual(["duration_seconds"]);
    expect(issuePaths(schema.safeParse({ ...details, duration_seconds: "soon" }))).toEqual(["duration_seconds"]);
  });
});

describe("pastPostInputFor", () => {
  const schema = pastPostInputFor({ today: TODAY });
  const past = { ...details, title: "My first short", platform: "tiktok", format: "", duration_seconds: "30" };

  it("validates title and platform, and decides video from them", () => {
    expect(schema.parse(past)).toMatchObject({ title: "My first short", platform: "tiktok", format: null, duration_seconds: 30 });
    expect(schema.parse({ ...past, platform: "linkedin", format: "carousel" }).duration_seconds).toBeNull();
  });

  it("rejects a short title or an unknown platform", () => {
    expect(issuePaths(schema.safeParse({ ...past, title: "x" }))).toEqual(["title"]);
    expect(issuePaths(schema.safeParse({ ...past, platform: "myspace" }))).toEqual(["platform"]);
  });
});

describe("resultsInputFor", () => {
  const video = resultsInputFor({ video: true, durationSeconds: 60 });

  it("parses counts with separators, signed follower change and % viewed as 0–1", () => {
    expect(
      video.parse({
        ...emptyResults,
        views: "1,200",
        likes: "80",
        follower_delta: "-3",
        avg_view_duration_seconds: "0:30",
        avg_percent_viewed: "45.5%",
      }),
    ).toEqual({
      views: 1200,
      likes: 80,
      comments: null,
      shares: null,
      saves: null,
      follower_delta: -3,
      avg_view_duration_seconds: 30,
      retention_rate: 0.455,
    });
  });

  it("needs at least one number", () => {
    const result = video.safeParse(emptyResults);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: [], message: "Enter at least one number." });
  });

  it("rejects negatives, decimals in counts, over 100% and a view duration longer than the post", () => {
    expect(issuePaths(video.safeParse({ ...emptyResults, views: "-5" }))).toEqual(["views"]);
    expect(issuePaths(video.safeParse({ ...emptyResults, likes: "1.5" }))).toEqual(["likes"]);
    expect(issuePaths(video.safeParse({ ...emptyResults, avg_percent_viewed: "120" }))).toEqual(["avg_percent_viewed"]);
    expect(issuePaths(video.safeParse({ ...emptyResults, avg_view_duration_seconds: "90" }))).toEqual([
      "avg_view_duration_seconds",
    ]);
  });

  it("drops video-only fields for other formats", () => {
    const written = resultsInputFor({ video: false, durationSeconds: null });
    expect(written.parse({ ...emptyResults, views: "10", avg_percent_viewed: "50" })).toMatchObject({
      views: 10,
      retention_rate: null,
      avg_view_duration_seconds: null,
    });
    // Only video-only values given: nothing is left, so it's empty.
    expect(written.safeParse({ ...emptyResults, avg_percent_viewed: "50" }).success).toBe(false);
  });
});

describe("storedCheckIn", () => {
  it("coerces numeric strings and rejects junk", () => {
    const row = {
      id: "s1",
      captured_at: "2026-10-16T00:00:00Z",
      views: "1200",
      likes: 3,
      comments: null,
      shares: null,
      saves: null,
      follower_delta: null,
      avg_view_duration_seconds: "12.50",
      retention_rate: "0.4550",
    };
    expect(storedCheckIn.parse(row)).toMatchObject({ views: 1200, avg_view_duration_seconds: 12.5, retention_rate: 0.455 });
    expect(storedCheckIn.safeParse({ ...row, views: "lots" }).success).toBe(false);
  });
});
