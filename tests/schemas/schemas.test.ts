import { describe, expect, it } from "vitest";
import {
  DB_ENUM_COLUMNS,
  jsonObject,
  parseContentPackage,
  parseIdeaEvidence,
  parseInsightEvidence,
} from "@/lib/schemas";

describe("enums", () => {
  it.each(Object.entries(DB_ENUM_COLUMNS))("%s accepts its values and rejects others", (_, schema) => {
    for (const value of schema.options) expect(schema.safeParse(value).success).toBe(true);
    expect(schema.safeParse("not-a-value").success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
  });
});

describe("parseIdeaEvidence", () => {
  it("accepts evidence with its source", () => {
    const result = parseIdeaEvidence([
      {
        kind: "audience_comment",
        summary: "Several viewers asked how to start with no budget",
        source: "YouTube comments",
        source_url: "https://www.youtube.com/watch?v=abc",
        observed_at: "2026-10-01T12:00:00Z",
      },
      { kind: "creator_history", summary: "Beginner how-tos beat your baseline" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("accepts no evidence", () => {
    expect(parseIdeaEvidence([]).ok).toBe(true);
  });

  it("rejects unknown kinds, blank summaries and bad urls", () => {
    const result = parseIdeaEvidence([
      { kind: "virality_score", summary: "x" },
      { kind: "trend", summary: "   " },
      { kind: "trend", summary: "x", source_url: "not a url" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(3);
      expect(result.issues[0]).toMatch(/^0\.kind:/);
    }
  });

  it("rejects a non-array without throwing", () => {
    expect(parseIdeaEvidence({ kind: "trend" }).ok).toBe(false);
    expect(parseIdeaEvidence(undefined).ok).toBe(false);
  });
});

describe("parseContentPackage", () => {
  const full = {
    hooks: [{ text: "You're watering your plants wrong", style: "contrarian" }],
    script: { sections: [{ heading: "Intro", body: "Most people…", duration_seconds: 8 }] },
    shot_list: [{ description: "Close-up of dry soil", shot_type: "macro", duration_seconds: 2.5 }],
    caption: { text: "Save this for later", hashtags: ["#plants"], platform: "instagram" },
    cta: { text: "Follow for part 2" },
    titles: ["The watering mistake everyone makes"],
    thumbnail_concept: { description: "Wilted plant next to a watering can", text_overlay: "STOP" },
    repurposing: [{ platform: "tiktok", format: "short", notes: "Cut to the hook" }],
  };

  it("accepts a full package", () => {
    const result = parseContentPackage(full);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(full);
  });

  it("accepts a single section, so sections can be generated independently", () => {
    expect(parseContentPackage({ hooks: full.hooks }).ok).toBe(true);
    expect(parseContentPackage({}).ok).toBe(true);
  });

  it("strips unknown sections instead of failing", () => {
    const result = parseContentPackage({ cta: full.cta, music_suggestion: "lofi" });
    expect(result).toEqual({ ok: true, data: { cta: full.cta } });
  });

  it("rejects malformed sections", () => {
    expect(parseContentPackage({ hooks: [{ text: "" }] }).ok).toBe(false);
    expect(parseContentPackage({ script: { sections: [] } }).ok).toBe(false);
    expect(parseContentPackage({ titles: "one title" }).ok).toBe(false);
    expect(parseContentPackage({ shot_list: [{ description: "x", duration_seconds: -1 }] }).ok).toBe(
      false,
    );
  });

  it("rejects non-objects without throwing", () => {
    expect(parseContentPackage("hooks: ...").ok).toBe(false);
    expect(parseContentPackage(null).ok).toBe(false);
  });

  it("does not echo input values in issues", () => {
    const secret = "my private draft text";
    const result = parseContentPackage({ titles: [secret.repeat(20)] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).not.toContain(secret);
  });
});

describe("parseInsightEvidence", () => {
  it("accepts observations with baselines", () => {
    expect(
      parseInsightEvidence([
        {
          observation: "Question hooks retained better",
          content_item_id: "6f1c3b2a-1d2e-4f5a-8b9c-0d1e2f3a4b5c",
          metric: "retention_rate",
          value: 0.52,
          baseline: 0.38,
        },
      ]).ok,
    ).toBe(true);
  });

  it("rejects a malformed content item id", () => {
    expect(parseInsightEvidence([{ observation: "x", content_item_id: "123" }]).ok).toBe(false);
  });
});

describe("jsonObject", () => {
  it("accepts objects and rejects arrays and scalars", () => {
    expect(jsonObject.safeParse({ a: 1, b: { c: [1] } }).success).toBe(true);
    expect(jsonObject.safeParse([1]).success).toBe(false);
    expect(jsonObject.safeParse("x").success).toBe(false);
  });
});
