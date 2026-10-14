import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  formatDay,
  formatTime,
  formatWeekRange,
  isDateKey,
  isTimeKey,
  isValidTimezone,
  localDateKey,
  localTimeKey,
  localToInstant,
  shiftWeek,
  timezoneOptions,
  todayIn,
  weekDays,
  weekRange,
  weekStart,
} from "@/lib/calendar/dates";
import { parseWeekParam } from "@/lib/schemas/calendar";

describe("timezone validation", () => {
  it.each(["Africa/Lagos", "America/New_York", "Europe/London", "Asia/Tokyo", "UTC"])("accepts %s", (tz) => {
    expect(isValidTimezone(tz)).toBe(true);
  });

  it.each(["", "Mars/Olympus", "+01:00", "EST5EDT; drop table", 42, null, undefined, "x".repeat(80)])(
    "rejects %s",
    (tz) => {
      expect(isValidTimezone(tz)).toBe(false);
    },
  );

  it("offers a sorted list that includes UTC", () => {
    const options = timezoneOptions();
    expect(options).toContain("UTC");
    expect(options).toContain("Africa/Lagos");
    expect([...options].sort()).toEqual(options);
  });
});

describe("date and time keys", () => {
  it.each(["2026-10-12", "2028-02-29"])("accepts %s", (key) => expect(isDateKey(key)).toBe(true));
  it.each(["2026-02-29", "2026-13-01", "2026-1-5", "20261012", "2026-10-12T00:00", "1999-01-01", "", 20261012])(
    "rejects %s",
    (key) => expect(isDateKey(key)).toBe(false),
  );
  it.each(["00:00", "09:00", "23:59"])("accepts time %s", (time) => expect(isTimeKey(time)).toBe(true));
  it.each(["24:00", "9:00", "09:60", "09:00:00", ""])("rejects time %s", (time) => expect(isTimeKey(time)).toBe(false));
});

describe("weeks", () => {
  it("starts on Monday", () => {
    expect(weekStart("2026-10-12")).toBe("2026-10-12"); // Monday
    expect(weekStart("2026-10-14")).toBe("2026-10-12");
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // Sunday
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    expect(weekStart("2027-01-01")).toBe("2026-12-28"); // across a year
  });

  it("lists seven days and shifts by weeks", () => {
    expect(weekDays("2026-10-12")).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
    expect(shiftWeek("2026-10-12", 1)).toBe("2026-10-19");
    expect(shiftWeek("2026-10-12", -2)).toBe("2026-09-28");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-12", "2026-10-19")).toBe(7);
    expect(daysBetween("2026-10-19", "2026-10-12")).toBe(-7);
  });

  it("returns null for invalid input", () => {
    expect(weekStart("nope")).toBeNull();
    expect(weekDays("2026-02-30")).toBeNull();
    expect(addDays("2026-10-12", 1.5)).toBeNull();
    expect(weekRange("2026-10-12", "Mars/Olympus")).toBeNull();
    expect(localToInstant("2026-10-12", "25:00", "UTC")).toBeNull();
    expect(localDateKey("not a date", "UTC")).toBeNull();
    expect(localDateKey(0, "Mars/Olympus")).toBeNull();
  });

  it.each([
    // Lagos is UTC+1 all year.
    ["Africa/Lagos", { from: "2026-10-11T23:00:00.000Z", to: "2026-10-18T23:00:00.000Z" }],
    // New York is UTC-4 in October.
    ["America/New_York", { from: "2026-10-12T04:00:00.000Z", to: "2026-10-19T04:00:00.000Z" }],
    // Tokyo is UTC+9.
    ["Asia/Tokyo", { from: "2026-10-11T15:00:00.000Z", to: "2026-10-18T15:00:00.000Z" }],
    ["UTC", { from: "2026-10-12T00:00:00.000Z", to: "2026-10-19T00:00:00.000Z" }],
  ])("gives the UTC range of a local week in %s", (tz, range) => {
    expect(weekRange("2026-10-12", tz)).toEqual(range);
  });

  it("is shorter across a DST change", () => {
    // Europe/London leaves summer time on Sunday 2026-10-25.
    expect(weekRange("2026-10-19", "Europe/London")).toEqual({
      from: "2026-10-18T23:00:00.000Z",
      to: "2026-10-26T00:00:00.000Z",
    });
  });
});

describe("local time ↔ instant", () => {
  it("knows the local date at an instant, on both sides of midnight", () => {
    const instant = "2026-10-12T23:30:00Z";
    expect(localDateKey(instant, "UTC")).toBe("2026-10-12");
    expect(localDateKey(instant, "Africa/Lagos")).toBe("2026-10-13");
    expect(localDateKey(instant, "America/Los_Angeles")).toBe("2026-10-12");
    expect(localTimeKey(instant, "Africa/Lagos")).toBe("00:30");
    expect(todayIn("Asia/Tokyo", Date.parse(instant))).toBe("2026-10-13");
  });

  it.each([
    ["Africa/Lagos", "2026-10-14", "09:00"],
    ["America/New_York", "2026-07-01", "18:45"],
    ["Europe/London", "2026-01-15", "00:00"],
    ["Asia/Kolkata", "2026-10-14", "23:59"],
    ["Pacific/Auckland", "2026-04-05", "12:00"],
  ])("round-trips %s %s %s", (tz, date, time) => {
    const instant = localToInstant(date, time, tz)!;
    expect(localDateKey(instant, tz)).toBe(date);
    expect(localTimeKey(instant, tz)).toBe(time);
  });

  it("converts with the right offset", () => {
    expect(localToInstant("2026-10-14", "09:00", "Africa/Lagos")).toBe("2026-10-14T08:00:00.000Z");
    expect(localToInstant("2026-10-14", "09:00", "America/New_York")).toBe("2026-10-14T13:00:00.000Z");
    expect(localToInstant("2026-12-14", "09:00", "America/New_York")).toBe("2026-12-14T14:00:00.000Z");
  });

  it("moves a skipped time forward (spring forward)", () => {
    // New York: 2026-03-08 02:00 → 03:00. 02:30 doesn't exist.
    const ny = localToInstant("2026-03-08", "02:30", "America/New_York")!;
    expect(ny).toBe("2026-03-08T07:30:00.000Z");
    expect(localTimeKey(ny, "America/New_York")).toBe("03:30");
    // London: 2026-03-29 01:00 → 02:00.
    const london = localToInstant("2026-03-29", "01:30", "Europe/London")!;
    expect(localTimeKey(london, "Europe/London")).toBe("02:30");
  });

  it("picks the earlier instant for a repeated time (fall back)", () => {
    // New York: 2026-11-01 02:00 → 01:00. 01:30 happens twice; the first is EDT.
    expect(localToInstant("2026-11-01", "01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
    // London: 2026-10-25 02:00 → 01:00. 01:30 BST is 00:30Z.
    expect(localToInstant("2026-10-25", "01:30", "Europe/London")).toBe("2026-10-25T00:30:00.000Z");
  });
});

describe("display", () => {
  it("formats days, weeks and times", () => {
    expect(formatDay("2026-10-14")).toBe("Wed, Oct 14");
    expect(formatWeekRange("2026-10-12")).toBe("Oct 12 to 18");
    expect(formatWeekRange("2026-09-28")).toBe("Sep 28 to Oct 4");
    expect(formatTime("09:00")).toBe("9:00 AM");
    expect(formatTime("00:15")).toBe("12:15 AM");
    expect(formatTime("12:00")).toBe("12:00 PM");
    expect(formatTime("23:05")).toBe("11:05 PM");
    expect(formatTime("9am")).toBeNull();
  });
});

describe("?week= parsing", () => {
  const today = "2026-10-14";
  it.each([
    ["2026-10-21", "2026-10-19"],
    ["2026-10-12", "2026-10-12"],
    [undefined, "2026-10-12"],
    [["2026-10-21"], "2026-10-12"],
    ["2026-10-21x", "2026-10-12"],
    ["2026-02-30", "2026-10-12"],
    ["../../etc", "2026-10-12"],
  ])("%s → %s", (raw, expected) => {
    expect(parseWeekParam(raw, today)).toBe(expected);
  });
});
