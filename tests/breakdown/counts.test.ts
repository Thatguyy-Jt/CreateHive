import { describe, expect, it } from "vitest";
import { MAX_COUNT, parseCount, parseDuration } from "@/lib/breakdown/counts";
import { COUNT_FIELDS, PLATFORM_GUIDES, VIEWS_REQUIRED } from "@/lib/breakdown/platform-guides";
import { PLATFORMS } from "@/lib/schemas/labels";

describe("parseCount", () => {
  it.each([
    ["1234", 1234, false],
    ["1,234", 1234, false],
    [" 12,345,678 ", 12_345_678, false],
    ["1.2K", 1200, true],
    ["3.4m", 3_400_000, true],
    ["1.1B", 1_100_000_000, true],
    ["12 K", 12_000, true],
    ["0", 0, false],
  ])("reads %s", (raw, value, rounded) => {
    expect(parseCount(raw)).toEqual({ ok: true, value, rounded });
  });

  it("treats blank as not shown", () => {
    expect(parseCount("  ")).toEqual({ ok: true, value: null, rounded: false });
  });

  it.each(["-5", "abc", "1.2.3", "1.2", "12,34", "1e6", "5000B", String(MAX_COUNT + 1)])("rejects %s", (raw) => {
    expect(parseCount(raw)).toEqual({ ok: false });
  });
});

describe("parseDuration", () => {
  it.each([
    ["95", 95],
    ["1:35", 95],
    ["0:45", 45],
    ["1:02:03", 3723],
  ])("reads %s", (raw, value) => {
    expect(parseDuration(raw)).toEqual({ ok: true, value });
  });

  it.each(["0", "1:75", "abc", "99999999", "1:2"])("rejects %s", (raw) => {
    expect(parseDuration(raw)).toEqual({ ok: false });
  });
});

describe("platform guides", () => {
  it("covers every platform we can't fetch, with a hint for every field", () => {
    for (const platform of PLATFORMS.filter((p) => p !== "youtube")) {
      const guide = PLATFORM_GUIDES[platform];
      expect(guide, platform).toBeDefined();
      expect(guide.intro.length, platform).toBeGreaterThan(10);
      for (const field of [...COUNT_FIELDS, "duration" as const]) expect(guide.fields[field].length, `${platform}.${field}`).toBeGreaterThan(10);
    }
  });

  it("requires views only where platforms show them publicly", () => {
    expect([...VIEWS_REQUIRED].sort()).toEqual(["instagram", "tiktok", "x"]);
  });
});
