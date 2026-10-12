import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  brandProfileInput,
  creatorProfileInput,
  storedStrategyColumns,
  strategyModelSchema,
  strategyOutputFor,
} from "@/lib/schemas/creator";
import { validStrategy } from "./strategy-fixture";

const profile = {
  niche: "  Home fitness for parents  ",
  audience_description: "Busy parents who want to get fit without a gym.",
  goals: ["grow_audience"],
  platforms: ["youtube", "tiktok"],
  posting_capacity_per_week: "3",
  experience_level: "beginner",
};

const brand = {
  tone: "warm and practical",
  voice_traits: ["Warm", "Warm", " ", "Direct"],
  do_list: ["Use real examples", ""],
  dont_list: [],
  sample_text: "   ",
};

const errorPaths = (result: { success: boolean; error?: z.ZodError }) =>
  result.error?.issues.map((issue) => issue.path.join(".")) ?? [];

describe("creatorProfileInput", () => {
  it("accepts a valid profile, trims text and coerces the posting capacity", () => {
    const result = creatorProfileInput.parse(profile);
    expect(result.niche).toBe("Home fitness for parents");
    expect(result.posting_capacity_per_week).toBe(3);
  });

  it.each([
    ["niche", { niche: "a" }],
    ["audience_description", { audience_description: "short" }],
    ["goals", { goals: [] }],
    ["goals", { goals: ["grow_audience", "monetize", "build_authority", "stay_consistent"] }],
    ["goals", { goals: ["become_famous"] }],
    ["platforms", { platforms: [] }],
    ["platforms", { platforms: ["myspace"] }],
    ["platforms", { platforms: ["youtube", "youtube"] }],
    ["posting_capacity_per_week", { posting_capacity_per_week: "0" }],
    ["posting_capacity_per_week", { posting_capacity_per_week: "31" }],
    ["posting_capacity_per_week", { posting_capacity_per_week: "2.5" }],
    ["experience_level", { experience_level: "" }],
  ])("rejects an invalid %s", (field, patch) => {
    const result = creatorProfileInput.safeParse({ ...profile, ...patch });
    expect(result.success).toBe(false);
    // The action keys field errors on the top-level field.
    expect(errorPaths(result)[0].split(".")[0]).toBe(field);
  });

  it("gives creator-facing messages", () => {
    const empty = creatorProfileInput.safeParse({ ...profile, platforms: [] });
    expect(empty.error?.issues[0].message).toBe("Pick at least one platform.");
    const unknown = creatorProfileInput.safeParse({ ...profile, platforms: ["myspace"] });
    expect(unknown.error?.issues[0].message).toBe("Choose from the listed platforms.");
  });
});

describe("brandProfileInput", () => {
  it("trims, drops blanks and de-duplicates list items; blank sample becomes null", () => {
    expect(brandProfileInput.parse(brand)).toEqual({
      tone: "warm and practical",
      voice_traits: ["Warm", "Direct"],
      do_list: ["Use real examples"],
      dont_list: [],
      sample_text: null,
    });
  });

  it("caps list sizes and item lengths", () => {
    expect(brandProfileInput.safeParse({ ...brand, voice_traits: Array.from({ length: 9 }, (_, i) => `t${i}`) }).success).toBe(false);
    expect(brandProfileInput.safeParse({ ...brand, do_list: ["x".repeat(161)] }).success).toBe(false);
    expect(brandProfileInput.safeParse({ ...brand, sample_text: "x".repeat(2001) }).success).toBe(false);
  });

  it("requires a tone", () => {
    expect(errorPaths(brandProfileInput.safeParse({ ...brand, tone: " " }))).toEqual(["tone"]);
  });
});

describe("strategyOutputFor", () => {
  const schema = strategyOutputFor(["youtube", "tiktok"]);

  it("accepts a valid strategy", () => {
    expect(schema.safeParse(validStrategy()).success).toBe(true);
  });

  it("normalises empty notes to null", () => {
    expect(schema.parse(validStrategy({ notes: "  " })).notes).toBeNull();
  });

  it.each([
    ["two pillars", { pillars: validStrategy().pillars.slice(0, 2) }],
    [
      "six pillars",
      { pillars: Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, description: "d" })) },
    ],
    [
      "duplicate pillar names (case-insensitive)",
      { pillars: [...validStrategy().pillars.slice(0, 2), { name: "quick WORKOUTS", description: "d" }] },
    ],
    ["three weeks", { thirty_day_plan: validStrategy().thirty_day_plan.slice(0, 3) }],
    [
      "weeks out of order",
      { thirty_day_plan: [...validStrategy().thirty_day_plan].reverse() },
    ],
    ["an empty positioning", { positioning: " " }],
    [
      "a platform the creator didn't pick",
      {
        format_strategy: [
          { platform: "linkedin" as const, formats: ["Posts"], cadence: "1/wk", rationale: "r" },
        ],
      },
    ],
  ])("rejects %s", (_label, patch) => {
    expect(schema.safeParse(validStrategy(patch)).success).toBe(false);
  });
});

describe("strategyModelSchema", () => {
  it("has no optional keys (OpenAI strict mode)", () => {
    type Node = { properties?: Record<string, Node>; required?: string[]; items?: Node; anyOf?: Node[] };
    const optional: string[] = [];
    const walk = (node: Node, path: string[]) => {
      const required = new Set(node.required ?? []);
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (!required.has(key)) optional.push([...path, key].join("."));
        walk(child, [...path, key]);
      }
      if (node.items) walk(node.items, [...path, "[]"]);
      for (const option of node.anyOf ?? []) walk(option, path);
    };
    walk(z.toJSONSchema(strategyModelSchema) as Node, []);
    expect(optional).toEqual([]);
  });

  it("parses the fixture", () => {
    expect(strategyModelSchema.safeParse(validStrategy()).success).toBe(true);
  });
});

describe("storedStrategyColumns", () => {
  it("re-validates stored JSON columns", () => {
    const { audience_profile, format_strategy, voice_profile, thirty_day_plan } = validStrategy();
    expect(storedStrategyColumns.safeParse({ audience_profile, format_strategy, voice_profile, thirty_day_plan }).success).toBe(true);
    expect(storedStrategyColumns.safeParse({ audience_profile: {}, format_strategy, voice_profile, thirty_day_plan }).success).toBe(false);
  });
});
