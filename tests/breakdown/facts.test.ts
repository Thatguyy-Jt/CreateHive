import { describe, expect, it } from "vitest";
import { computeFacts, factLines, followerRatioText, type FactsInput } from "@/lib/breakdown/facts";

const NOW = Date.parse("2026-10-29T12:00:00Z");

const base: FactsInput = {
  source: "creator_entered",
  views: 10_000,
  likes: 400,
  comments: 50,
  shares: 30,
  saves: 20,
  followers: 2_000,
  durationSeconds: 45,
  publishedAt: "2026-10-19T00:00:00Z",
  rounded: false,
  now: NOW,
};

describe("computeFacts", () => {
  it("computes age, views per day, engagement and views vs followers", () => {
    expect(computeFacts(base)).toMatchObject({
      age_days: 10,
      views_per_day: 1000,
      engagement_rate: 0.05,
      views_to_followers: 5,
    });
  });

  it("leaves rates out when their inputs are missing", () => {
    const facts = computeFacts({ ...base, views: null, followers: null });
    expect(facts).toMatchObject({ views_per_day: null, engagement_rate: null, views_to_followers: null });
  });

  it("never divides by zero views", () => {
    expect(computeFacts({ ...base, views: 0 }).engagement_rate).toBeNull();
  });

  it("ignores a future posting date", () => {
    const facts = computeFacts({ ...base, publishedAt: "2027-01-01T00:00:00Z" });
    expect(facts).toMatchObject({ age_days: null, published_at: null, views_per_day: null });
  });

  it("uses only the engagement numbers present", () => {
    const facts = computeFacts({ ...base, shares: null, saves: null });
    expect(facts.engagement_rate).toBeCloseTo(0.045);
  });

  it("counts day 0 as one day for views per day", () => {
    expect(computeFacts({ ...base, publishedAt: "2026-10-29T06:00:00Z" }).views_per_day).toBe(10_000);
  });
});

describe("display", () => {
  it("formats the follower ratio both ways", () => {
    expect(followerRatioText(3.24)).toBe("about 3.2× their follower count");
    expect(followerRatioText(0.45)).toBe("45% of their follower count");
  });

  it("lists only known facts", () => {
    const labels = factLines(computeFacts({ ...base, saves: null, followers: null })).map((line) => line.label);
    expect(labels).toContain("Views");
    expect(labels).not.toContain("Saves");
    expect(labels).not.toContain("Views vs followers");
  });
});
