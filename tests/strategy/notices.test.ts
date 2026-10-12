import { describe, expect, it } from "vitest";
import {
  parseStrategyNotice,
  STRATEGY_NOTICE_CODES,
  strategyNoticeCopy,
  strategyNoticeHref,
} from "@/lib/strategy-notices";

describe("parseStrategyNotice", () => {
  it.each(STRATEGY_NOTICE_CODES)("accepts %s", (code) => {
    expect(parseStrategyNotice({ notice: code })).toEqual({ code, version: null });
  });

  it("ignores missing and unknown notices", () => {
    expect(parseStrategyNotice({})).toBeNull();
    expect(parseStrategyNotice({ notice: "" })).toBeNull();
    expect(parseStrategyNotice({ notice: "hacked<script>" })).toBeNull();
    expect(parseStrategyNotice({ notice: "toString" })).toBeNull();
  });

  it("reads a positive integer version", () => {
    expect(parseStrategyNotice({ notice: "strategy_regenerated", v: "3" })).toEqual({
      code: "strategy_regenerated",
      version: 3,
    });
  });

  it.each(["0", "-1", "2.5", "abc", "03", "1e3", " 3", "9999999999"])("drops an invalid version %j", (v) => {
    expect(parseStrategyNotice({ notice: "strategy_regenerated", v })?.version).toBeNull();
  });

  it("uses the first value of array params", () => {
    expect(parseStrategyNotice({ notice: ["profile_saved", "strategy_created"], v: ["2", "5"] })).toEqual({
      code: "profile_saved",
      version: 2,
    });
  });
});

describe("strategyNoticeHref", () => {
  it("builds the strategy URL with the notice and an optional version", () => {
    expect(strategyNoticeHref("profile_saved")).toBe("/app/strategy?notice=profile_saved");
    expect(strategyNoticeHref("strategy_regenerated", 4)).toBe("/app/strategy?notice=strategy_regenerated&v=4");
    expect(strategyNoticeHref("strategy_created", 0)).toBe("/app/strategy?notice=strategy_created");
  });

  it("round-trips through the parser", () => {
    const url = new URL(strategyNoticeHref("strategy_regenerated", 7), "https://example.com");
    expect(
      parseStrategyNotice({ notice: url.searchParams.get("notice"), v: url.searchParams.get("v") }),
    ).toEqual({ code: "strategy_regenerated", version: 7 });
  });
});

describe("strategyNoticeCopy", () => {
  it("shows the version for a regenerated strategy, and nothing without one", () => {
    expect(strategyNoticeCopy({ code: "strategy_regenerated", version: 3 })).toMatchObject({
      title: "Your strategy has been regenerated",
      description: "Version 3",
    });
    expect(strategyNoticeCopy({ code: "strategy_regenerated", version: null }).description).toBeNull();
  });

  it("offers the regenerate shortcut, for longer, only after a profile save", () => {
    expect(strategyNoticeCopy({ code: "profile_saved", version: null })).toMatchObject({
      regenerateAction: true,
      durationMs: 10000,
    });
    expect(strategyNoticeCopy({ code: "strategy_created", version: 1 })).toMatchObject({
      title: "Your strategy is ready",
      regenerateAction: false,
      durationMs: 6000,
    });
  });
});
