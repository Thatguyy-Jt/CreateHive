import { describe, expect, it } from "vitest";
import { breadcrumbsFor } from "@/lib/app-shell/breadcrumbs";
import { navItems } from "@/lib/app-shell/nav-items";

describe("breadcrumbsFor", () => {
  it("shows only the current page on the dashboard", () => {
    expect(breadcrumbsFor("/app")).toEqual([{ label: "Dashboard" }]);
  });

  it("shows only the section, without a Dashboard root, for every nav route", () => {
    for (const item of navItems) {
      if (item.status !== "live" || item.href === "/app") continue;
      expect(breadcrumbsFor(item.href)).toEqual([{ label: item.label }]);
    }
  });

  it("links the section and adds the detail label on the two detail routes", () => {
    expect(breadcrumbsFor("/app/studio/abc")).toEqual([
      { label: "Studio", href: "/app/studio" },
      { label: "Content package" },
    ]);
    expect(breadcrumbsFor("/app/analytics/abc")).toEqual([
      { label: "Analytics", href: "/app/analytics" },
      { label: "Post results" },
    ]);
  });

  it("falls back to the section for unknown sub-routes", () => {
    expect(breadcrumbsFor("/app/settings/extra")).toEqual([{ label: "Settings" }]);
  });

  it("falls back to Dashboard for unknown or missing paths", () => {
    expect(breadcrumbsFor(null)).toEqual([{ label: "Dashboard" }]);
    expect(breadcrumbsFor("/app/unknown")).toEqual([{ label: "Dashboard" }]);
    expect(breadcrumbsFor("/onboarding")).toEqual([{ label: "Dashboard" }]);
  });
});
