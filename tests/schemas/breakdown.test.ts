import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  applyBreakdownHonesty,
  breakdownModelSchemaFor,
  breakdownOutputFor,
  CREATOR_ENTERED_CAVEAT,
  FOLLOWERS_UNKNOWN_CAVEAT,
  parseBreakdownForm,
  ROUNDED_CAVEAT,
  type Breakdown,
  type BreakdownFormValues,
} from "@/lib/schemas/breakdown";

const NOW = Date.parse("2026-10-29T12:00:00Z");

const blank: BreakdownFormValues = {
  url: "",
  views: "",
  likes: "",
  comments: "",
  shares: "",
  saves: "",
  followers: "",
  duration: "",
  posted_on: "",
  caption: "",
  transcript: "",
  top_comments: "",
  note: "",
  target_platform: "",
};

const validBreakdown: Breakdown = {
  summary: "A 45-second filming tip that opens with the result first.",
  why_it_worked: [
    { element: "hook", observation: "Shows the final shot first.", evidence: "Transcript opens with “this is my phone”.", confidence: "medium" },
    { element: "length", observation: "Short enough to rewatch.", evidence: "Length 0:45.", confidence: "high" },
  ],
  audience_reaction: { summary: "Viewers asked for settings.", themes: ["settings"] },
  your_version: {
    topic: "Film a 20-minute workout on your phone",
    angle: "Show the finished clip, then the setup",
    hooks: ["This was filmed in my kitchen", "No camera, just this", "Three settings I always change"],
    format: "Short video",
    platform: "tiktok",
    pillar_name: "Quick workouts",
    outline: ["Show the result", "Show the setup", "One tip", "Ask a question"],
    title: "Phone-only workout filming",
    cta: "Ask which setting to cover next",
    why_it_fits: "Your audience trains at home with little gear.",
  },
  what_not_to_copy: ["Their jokes and phrasing"],
  caveats: [],
};

const outputFor = (referenceTitle: string | null = "How I film on a phone") =>
  breakdownOutputFor({ platforms: ["tiktok", "youtube"], pillarNames: ["Quick workouts"], referenceTitle });

describe("parseBreakdownForm", () => {
  it("ignores number fields for YouTube links", () => {
    const result = parseBreakdownForm({ ...blank, url: "https://youtu.be/dQw4w9WgXcQ", views: "garbage" }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.input.counts.views).toBeNull();
  });

  it("requires views on TikTok and reads shorthand as rounded", () => {
    const tiktok = "https://www.tiktok.com/@a/video/7234567890123456789";
    expect(parseBreakdownForm({ ...blank, url: tiktok }, NOW)).toMatchObject({ ok: false, fieldErrors: { views: expect.any(String) } });

    const result = parseBreakdownForm({ ...blank, url: tiktok, views: "12.3K", likes: "400", duration: "0:45" }, NOW);
    expect(result).toMatchObject({
      ok: true,
      data: { link: { platform: "tiktok" }, input: { counts: { views: 12_300, likes: 400 }, rounded: true, duration_seconds: 45 } },
    });
  });

  it("lets LinkedIn posts through without views when another number is given", () => {
    const url = "https://www.linkedin.com/posts/jane_tip-activity-7190000000000000000-abcd";
    expect(parseBreakdownForm({ ...blank, url }, NOW)).toMatchObject({ ok: false, fieldErrors: { likes: expect.any(String) } });
    expect(parseBreakdownForm({ ...blank, url, likes: "120" }, NOW).ok).toBe(true);
  });

  it("explains bad links, numbers, dates and over-long text", () => {
    expect(parseBreakdownForm({ ...blank, url: "https://vm.tiktok.com/x/" }, NOW)).toMatchObject({
      ok: false,
      fieldErrors: { url: expect.stringContaining("short share link") },
    });
    const url = "https://www.instagram.com/reel/C1a2B3c4D5e/";
    const result = parseBreakdownForm(
      { ...blank, url, views: "lots", posted_on: "2027-01-01", note: "x".repeat(501), target_platform: "myspace" },
      NOW,
    );
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: {
        views: expect.any(String),
        posted_on: expect.any(String),
        note: expect.any(String),
        target_platform: expect.any(String),
      },
    });
  });

  it("splits pasted comments into at most 20 trimmed lines", () => {
    const top = Array.from({ length: 25 }, (_, i) => ` comment ${i} `).join("\n");
    const result = parseBreakdownForm({ ...blank, url: "https://youtu.be/dQw4w9WgXcQ", top_comments: `${top}\n\n` }, NOW);
    expect(result.ok && result.data.input.comments).toHaveLength(20);
    expect(result.ok && result.data.input.comments[0]).toBe("comment 0");
  });
});

describe("breakdown output", () => {
  it("accepts a valid breakdown", () => {
    expect(outputFor().safeParse(validBreakdown).success).toBe(true);
  });

  it("rejects another platform or pillar, repeated hooks and the reference title", () => {
    const bad = (patch: Partial<Breakdown["your_version"]>) =>
      outputFor().safeParse({ ...validBreakdown, your_version: { ...validBreakdown.your_version, ...patch } }).success;
    expect(bad({ platform: "linkedin" })).toBe(false);
    expect(bad({ pillar_name: "Something else" })).toBe(false);
    expect(bad({ hooks: ["Same", "same ", "Other"] })).toBe(false);
    expect(bad({ title: "  how I FILM on a phone " })).toBe(false);
    expect(bad({ hooks: ["How I film on a phone", "b", "c"] })).toBe(false);
  });

  it("needs 2–5 reasons and exactly 3 hooks", () => {
    expect(outputFor().safeParse({ ...validBreakdown, why_it_worked: validBreakdown.why_it_worked.slice(0, 1) }).success).toBe(false);
    expect(
      outputFor().safeParse({ ...validBreakdown, your_version: { ...validBreakdown.your_version, hooks: ["a", "b"] } }).success,
    ).toBe(false);
  });

  it("has a strict-mode model schema (no optional keys)", () => {
    const json = JSON.stringify(z.toJSONSchema(breakdownModelSchemaFor(["tiktok"], ["Quick workouts"])));
    expect(json).not.toContain('"optional"');
    const schema = z.toJSONSchema(breakdownModelSchemaFor(["tiktok"], ["Quick workouts"])) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
  });
});

describe("applyBreakdownHonesty", () => {
  it("caps hook and structure confidence without any words to read", () => {
    const { breakdown, capped } = applyBreakdownHonesty(validBreakdown, {
      hasText: false,
      followersKnown: true,
      creatorEntered: false,
      rounded: false,
    });
    expect(capped).toBe(true);
    expect(breakdown.why_it_worked.map((w) => w.confidence)).toEqual(["low", "high"]);
  });

  it("states the limits of the numbers, at most 3 caveats", () => {
    const { breakdown } = applyBreakdownHonesty(
      { ...validBreakdown, caveats: ["One", "Two", "Three"] },
      { hasText: true, followersKnown: false, creatorEntered: true, rounded: true },
    );
    expect(breakdown.caveats).toEqual([CREATOR_ENTERED_CAVEAT, ROUNDED_CAVEAT, FOLLOWERS_UNKNOWN_CAVEAT]);
  });

  it("changes nothing when the evidence is complete", () => {
    expect(
      applyBreakdownHonesty(validBreakdown, { hasText: true, followersKnown: true, creatorEntered: false, rounded: false }),
    ).toEqual({ breakdown: validBreakdown, capped: false });
  });
});
