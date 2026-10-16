import { describe, expect, it } from "vitest";
import {
  applyInsightRules,
  compareInsights,
  confidenceCeiling,
  evidenceFor,
  insightsModelSchema,
  parseInsightsOutput,
  parseStoredInsight,
  type InsightsOutput,
  type PostFacts,
  type StoredInsight,
} from "@/lib/schemas/insights";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const fact = (n: number, views: number | null = 2300): PostFacts => ({
  id: ID(n),
  title: `Post ${n}`,
  platform: "youtube",
  dateLabel: "Wed, Oct 14",
  metrics: {
    views: { value: views, median: 1100, label: views === null ? null : "above" },
    engagement_rate: { value: 0.05, median: null, label: null },
  },
});

const facts = new Map(Array.from({ length: 8 }, (_, i) => [`P${i + 1}`, fact(i + 1)]));

const insight = (overrides: Partial<InsightsOutput["insights"][number]> = {}): InsightsOutput["insights"][number] => ({
  insight_type: "hook",
  summary: "Question hooks get more views than your usual.",
  next_step: "Open your next short with a question.",
  metric: "views",
  supporting_posts: ["P1", "P2", "P3"],
  confidence: "high",
  ...overrides,
});

const output = (insights: InsightsOutput["insights"], notes: string[] = []): InsightsOutput => ({ insights, notes });

describe("insights schemas", () => {
  it("accepts strict model output and validates bounds", () => {
    const raw = { insights: [insight()], notes: ["Most posts are shorts."] };
    expect(insightsModelSchema.safeParse(raw).success).toBe(true);
    expect(parseInsightsOutput(raw).ok).toBe(true);
    expect(parseInsightsOutput({ insights: [insight({ summary: "x".repeat(201) })], notes: [] }).ok).toBe(false);
    expect(parseInsightsOutput({ insights: Array.from({ length: 7 }, () => insight()), notes: [] }).ok).toBe(false);
    expect(parseInsightsOutput({ insights: [insight({ supporting_posts: ["post-1"] })], notes: [] }).ok).toBe(false);
    expect(parseInsightsOutput({ insights: [], notes: ["a", "b", "c"] }).ok).toBe(false);
  });

  it("allows a single supporting post through validation, for the rules to drop", () => {
    expect(parseInsightsOutput({ insights: [insight({ supporting_posts: ["P1"] })], notes: [] }).ok).toBe(true);
  });
});

describe("confidenceCeiling", () => {
  it("caps by supporting posts and by total settled posts", () => {
    expect(confidenceCeiling(2, 20)).toBe("low");
    expect(confidenceCeiling(3, 20)).toBe("medium");
    expect(confidenceCeiling(4, 20)).toBe("medium");
    expect(confidenceCeiling(5, 20)).toBe("high");
    expect(confidenceCeiling(5, 7)).toBe("medium");
    expect(confidenceCeiling(2, 7)).toBe("low");
  });
});

describe("applyInsightRules", () => {
  it("drops unknown and duplicate refs, and insights left with fewer than two posts", () => {
    const { insights } = applyInsightRules(
      output([
        insight({ supporting_posts: ["P1", "P1", "P99"], summary: "Only one real post" }),
        insight({ supporting_posts: ["P1", "P2", "P2"], summary: "Two real posts" }),
      ]),
      { facts, settledTotal: 20 },
    );
    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({ summary: "Two real posts", sample_size: 2, confidence: "low" });
  });

  it("caps confidence by sample size and total, and reports it", () => {
    const five = ["P1", "P2", "P3", "P4", "P5"];
    expect(applyInsightRules(output([insight({ supporting_posts: five })]), { facts, settledTotal: 20 })).toMatchObject({
      insights: [{ confidence: "high", sample_size: 5 }],
      capped: false,
    });
    expect(applyInsightRules(output([insight({ supporting_posts: five })]), { facts, settledTotal: 7 })).toMatchObject({
      insights: [{ confidence: "medium" }],
      capped: true,
    });
    expect(
      applyInsightRules(output([insight({ confidence: "low" })]), { facts, settledTotal: 7 }).insights[0].confidence,
    ).toBe("low");
  });

  it("builds evidence from stored numbers, never from model text", () => {
    const { insights } = applyInsightRules(output([insight({ supporting_posts: ["P1", "P2"] })]), { facts, settledTotal: 20 });
    expect(insights[0].evidence).toEqual([
      {
        observation: "“Post 1” (YouTube, Wed, Oct 14): Views 2,300, above your usual",
        content_item_id: ID(1),
        metric: "views",
        value: 2300,
        baseline: 1100,
      },
      expect.objectContaining({ content_item_id: ID(2) }),
    ]);
  });

  it("removes insights with the same summary", () => {
    const { insights } = applyInsightRules(
      output([insight({ summary: "Question hooks work!" }), insight({ summary: "question   hooks work" })]),
      { facts, settledTotal: 20 },
    );
    expect(insights).toHaveLength(1);
  });

  it("returns nothing when no insight survives", () => {
    expect(applyInsightRules(output([]), { facts, settledTotal: 20 })).toEqual({ insights: [], capped: false });
  });
});

describe("evidenceFor", () => {
  it("describes missing and uncompared values plainly", () => {
    expect(evidenceFor(fact(1, null), "views")).toEqual({
      observation: "“Post 1” (YouTube, Wed, Oct 14): Views not entered",
      content_item_id: ID(1),
      metric: "views",
      baseline: 1100,
    });
    expect(evidenceFor(fact(1), "engagement_rate").observation).toBe(
      "“Post 1” (YouTube, Wed, Oct 14): Engagement rate 5%, not compared yet",
    );
    expect(evidenceFor({ ...fact(1), platform: null, dateLabel: null }, "follower_delta").observation).toBe(
      "“Post 1”: Follower change not entered",
    );
  });
});

describe("stored insights", () => {
  const row = {
    id: ID(1),
    insight_type: "format",
    summary: "Tutorials do better",
    next_step: null,
    evidence: [{ observation: "x", content_item_id: ID(2) }],
    confidence: "medium",
    sample_size: 3,
    ai_generation_id: null,
    created_at: "2026-10-14T00:00:00Z",
  };

  it("parses rows and keeps an insight whose evidence no longer validates", () => {
    expect(parseStoredInsight(row)?.evidence).toHaveLength(1);
    expect(parseStoredInsight({ ...row, evidence: "nope" })?.evidence).toEqual([]);
    expect(parseStoredInsight({ ...row, insight_type: "vibes" })).toBeNull();
  });

  it("orders high confidence first, then larger samples", () => {
    const make = (id: number, confidence: StoredInsight["confidence"], sample: number) =>
      parseStoredInsight({ ...row, id: ID(id), confidence, sample_size: sample })!;
    const sorted = [make(1, "low", 9), make(2, "high", 2), make(3, "medium", 3), make(4, "medium", 6), make(5, null, 9)].toSorted(
      compareInsights,
    );
    expect(sorted.map((i) => i.id)).toEqual([ID(2), ID(4), ID(3), ID(1), ID(5)]);
  });
});
