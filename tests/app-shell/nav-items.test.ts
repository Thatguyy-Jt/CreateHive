import { describe, expect, it } from "vitest";
import { isActiveHref, NAV_GROUPS, navItems } from "@/lib/app-shell/nav-items";

describe("navItems", () => {
  const live = navItems.filter((item) => item.status === "live");

  it("has unique hrefs and labels", () => {
    expect(new Set(live.map((item) => item.href)).size).toBe(live.length);
    expect(new Set(navItems.map((item) => item.label)).size).toBe(navItems.length);
  });

  it("gives every item an icon and a known group", () => {
    for (const item of navItems) {
      expect(item.icon).toBeTruthy();
      expect(item.group === null || NAV_GROUPS.includes(item.group)).toBe(true);
    }
  });

  it("lists groups in order: Plan, Create, Measure, then pinned items", () => {
    const rank = (group: (typeof navItems)[number]["group"]) =>
      group === null ? NAV_GROUPS.length : NAV_GROUPS.indexOf(group);
    const ranks = navItems.map((item) => rank(item.group));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(navItems.at(-1)?.label).toBe("Settings");
  });
});

describe("isActiveHref", () => {
  it("matches the dashboard only exactly", () => {
    expect(isActiveHref("/app", "/app")).toBe(true);
    expect(isActiveHref("/app", "/app/studio")).toBe(false);
  });

  it("matches sub-routes of other items", () => {
    expect(isActiveHref("/app/studio", "/app/studio")).toBe(true);
    expect(isActiveHref("/app/studio", "/app/studio/abc")).toBe(true);
    expect(isActiveHref("/app/analytics", "/app/analytics/abc")).toBe(true);
  });

  it("does not match lookalike prefixes or a missing pathname", () => {
    expect(isActiveHref("/app/studio", "/app/studios")).toBe(false);
    expect(isActiveHref("/app/studio", null)).toBe(false);
  });
});
