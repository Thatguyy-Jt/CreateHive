import { describe, expect, it } from "vitest";
import { ACTIVE_PROMPTS } from "@/lib/ai/prompts/registry";
import { csvCell, toCsv } from "@/lib/billing/csv";
import {
  allowanceFor,
  PLAN_ALLOWANCES,
  planHighlights,
  planIncludes,
  QUOTA_FEATURES,
} from "@/lib/billing/features";

describe("plan allowances", () => {
  const kinds = Object.keys(ACTIVE_PROMPTS).filter((kind) => kind !== "smoke_test");

  it("meters every creator-facing AI task, on both plans", () => {
    expect(QUOTA_FEATURES.map((f) => f.kind).sort()).toEqual([...kinds].sort());
    for (const plan of ["free", "pro"] as const) {
      expect(Object.keys(PLAN_ALLOWANCES[plan]).sort()).toEqual([...kinds].sort());
    }
  });

  /** Pro-only AI features: Free has 0 of these. */
  const PRO_ONLY = new Set(["video_breakdown"]);

  it("gives Pro more of everything than Free, and Free at least one of each core feature", () => {
    for (const feature of QUOTA_FEATURES) {
      if (PRO_ONLY.has(feature.kind)) expect(PLAN_ALLOWANCES.free[feature.kind]).toBe(0);
      else expect(PLAN_ALLOWANCES.free[feature.kind]).toBeGreaterThanOrEqual(1);
      expect(PLAN_ALLOWANCES.pro[feature.kind]).toBeGreaterThan(PLAN_ALLOWANCES.free[feature.kind]);
    }
  });

  it("matches the approved breakdown", () => {
    expect(PLAN_ALLOWANCES).toEqual({
      free: { creator_strategy: 2, content_opportunities: 4, content_package: 5, content_section: 15, content_diagnosis: 3, creator_insights: 2, weekly_plan: 2, video_breakdown: 0 },
      pro: { creator_strategy: 6, content_opportunities: 20, content_package: 30, content_section: 100, content_diagnosis: 30, creator_insights: 8, weekly_plan: 8, video_breakdown: 15 },
    });
  });

  it("keeps Video Breakdown in Pro only, and lists it on the Pro card", () => {
    expect(allowanceFor("free", "video_breakdown")).toBe(0);
    expect(allowanceFor("pro", "video_breakdown")).toBe(15);
    expect(planHighlights("pro")).toContain("15 video breakdowns a month");
    expect(planHighlights("free").join(" ")).not.toMatch(/breakdown/);
  });

  it("has no allowance for internal tasks", () => {
    expect(allowanceFor("free", "smoke_test")).toBeNull();
    expect(allowanceFor("pro", "content_package")).toBe(30);
  });

  it("keeps YouTube research in Pro only", () => {
    expect(planIncludes("free", "youtube_research")).toBe(false);
    expect(planIncludes("pro", "youtube_research")).toBe(true);
  });

  it("builds plan-card lines from the real numbers", () => {
    expect(planHighlights("free")[0]).toBe("5 content packages a month");
    expect(planHighlights("pro")).toContain("YouTube research");
  });
});

describe("CSV export cells", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(9000)).toBe("9000");
  });

  it.each(["=HYPERLINK(1)", "+1", "-1+1", "@SUM(A1)", "\tx"])("neutralises a formula: %s", (value) => {
    const cell = csvCell(value);
    expect(cell.replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("joins rows with CRLF and a trailing newline", () => {
    expect(toCsv(["a", "b"], [["1", null]])).toBe("a,b\r\n1,\r\n");
  });
});
