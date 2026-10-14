import { describe, expect, it } from "vitest";
import { elapsedPlanWeek, planWeekNumber } from "@/lib/calendar/plan-week";

// Saved Tue 2026-10-06 10:00 UTC: the plan starts on Mon 2026-10-05.
const SAVED = "2026-10-06T10:00:00Z";

describe("planWeekNumber", () => {
  it("counts weeks 1 to 4 from the Monday of the week the strategy was saved", () => {
    expect(planWeekNumber(SAVED, "2026-10-05", "UTC")).toBe(1);
    expect(planWeekNumber(SAVED, "2026-10-12", "UTC")).toBe(2);
    expect(planWeekNumber(SAVED, "2026-10-19", "UTC")).toBe(3);
    expect(planWeekNumber(SAVED, "2026-10-26", "UTC")).toBe(4);
  });

  it("returns null after week 4, while elapsedPlanWeek keeps counting", () => {
    expect(planWeekNumber(SAVED, "2026-11-02", "UTC")).toBeNull();
    expect(elapsedPlanWeek(SAVED, "2026-11-02", "UTC")).toBe(5);
  });

  it("uses the creator's zone near a week boundary", () => {
    // Sun 2026-10-11 23:30 UTC is already Mon 2026-10-12 in Lagos (UTC+1).
    const lateSunday = "2026-10-11T23:30:00Z";
    expect(planWeekNumber(lateSunday, "2026-10-12", "UTC")).toBe(2);
    expect(planWeekNumber(lateSunday, "2026-10-12", "Africa/Lagos")).toBe(1);
  });

  it("returns null for invalid input or a week before the strategy", () => {
    expect(planWeekNumber("not a date", "2026-10-12", "UTC")).toBeNull();
    expect(planWeekNumber(SAVED, "2026-13-01", "UTC")).toBeNull();
    expect(planWeekNumber(SAVED, "2026-10-12", "Nowhere/City")).toBeNull();
    expect(planWeekNumber(SAVED, "2026-09-28", "UTC")).toBeNull();
    expect(elapsedPlanWeek(SAVED, "2026-09-28", "UTC")).toBeNull();
  });
});
