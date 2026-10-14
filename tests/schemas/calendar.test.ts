import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  MAX_SLOTS_PER_REQUEST,
  scheduleInputFor,
  timezoneInput,
  weeklyPlanModelSchemaFor,
  weeklyPlanOutputFor,
} from "@/lib/schemas/calendar";

const TODAY = "2026-10-14";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const slot = (n: number, date = "2026-10-15", time = "09:00") => ({ idea_id: uuid(n), date, time });

const messages = (result: z.ZodSafeParseResult<unknown>) => (result.success ? [] : result.error.issues.map((i) => i.message));

describe("scheduleInputFor", () => {
  const schema = scheduleInputFor(TODAY);

  it("accepts 1 to 20 slots from today to 180 days ahead", () => {
    expect(schema.safeParse([slot(1, TODAY)]).success).toBe(true);
    expect(schema.safeParse([slot(1, "2027-04-12")]).success).toBe(true);
    expect(schema.safeParse(Array.from({ length: MAX_SLOTS_PER_REQUEST }, (_, i) => slot(i))).success).toBe(true);
  });

  it.each([
    ["no slots", []],
    ["too many slots", Array.from({ length: MAX_SLOTS_PER_REQUEST + 1 }, (_, i) => slot(i))],
    ["a non-uuid idea", [{ idea_id: "idea_1", date: "2026-10-15", time: "09:00" }]],
    ["a bad time", [slot(1, "2026-10-15", "9am")]],
    ["an impossible date", [slot(1, "2026-02-30")]],
    ["not an array", slot(1)],
  ])("rejects %s", (_label, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });

  it("names past, too-far and duplicate problems", () => {
    expect(messages(schema.safeParse([slot(1, "2026-10-13")]))).toContain("date_past");
    expect(messages(schema.safeParse([slot(1, "2027-04-13")]))).toContain("date_too_far");
    expect(messages(schema.safeParse([slot(1), slot(1, "2026-10-16")]))).toContain("duplicate_idea");
  });
});

describe("timezoneInput", () => {
  it("accepts IANA names and rejects anything else", () => {
    expect(timezoneInput.safeParse(" Africa/Lagos ").data).toBe("Africa/Lagos");
    expect(timezoneInput.safeParse("Nowhere/City").success).toBe(false);
    expect(timezoneInput.safeParse(5).success).toBe(false);
  });
});

/** JSON-schema keys that are not required: OpenAI strict mode allows none. */
function optionalPaths(node: Record<string, unknown>, path: string[] = []): string[] {
  const found: string[] = [];
  const properties = node.properties as Record<string, Record<string, unknown>> | undefined;
  if (properties) {
    const required = new Set((node.required as string[] | undefined) ?? []);
    for (const [key, child] of Object.entries(properties)) {
      if (!required.has(key)) found.push([...path, key].join("."));
      found.push(...optionalPaths(child, [...path, key]));
    }
  }
  if (node.items) found.push(...optionalPaths(node.items as Record<string, unknown>, [...path, "[]"]));
  for (const option of (node.anyOf as Record<string, unknown>[] | undefined) ?? []) found.push(...optionalPaths(option, path));
  return found;
}

describe("weeklyPlanModelSchemaFor", () => {
  const schema = weeklyPlanModelSchemaFor(["I1", "I2"], ["2026-10-14", "2026-10-15"]);

  it("has no optional keys (strict mode)", () => {
    expect(optionalPaths(z.toJSONSchema(schema) as Record<string, unknown>)).toEqual([]);
  });

  it("only allows this request's refs and open dates", () => {
    const plan = (idea_ref: string, date: string) => ({ slots: [{ idea_ref, date, reason: "r" }], note: null });
    expect(schema.safeParse(plan("I1", "2026-10-14")).success).toBe(true);
    expect(schema.safeParse(plan("I3", "2026-10-14")).success).toBe(false);
    expect(schema.safeParse(plan("I1", "2026-10-13")).success).toBe(false);
  });
});

describe("weeklyPlanOutputFor", () => {
  const dates = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
  const schema = (remainingCapacity = 3, scheduledPerDay: Record<string, number> = {}) =>
    weeklyPlanOutputFor({ refs: ["I1", "I2", "I3", "I4"], dates, remainingCapacity, today: TODAY, scheduledPerDay });
  const s = (idea_ref: string, date: string, reason = "Fits your quick-workout pillar.") => ({ idea_ref, date, reason });

  it("accepts a plan within capacity", () => {
    const result = schema().safeParse({ slots: [s("I1", "2026-10-14"), s("I2", "2026-10-16")], note: "" });
    expect(result.success).toBe(true);
    expect(result.data?.note).toBeNull();
  });

  it.each([
    ["a repeated idea", [s("I1", "2026-10-14"), s("I1", "2026-10-15")]],
    ["an unknown ref", [s("I9", "2026-10-14")]],
    ["a past day", [s("I1", "2026-10-13")]],
    ["a date outside the week", [s("I1", "2026-10-20")]],
    ["more slots than capacity", [s("I1", "2026-10-14"), s("I2", "2026-10-15"), s("I3", "2026-10-16"), s("I4", "2026-10-17")]],
    ["three on one day", [s("I1", "2026-10-15"), s("I2", "2026-10-15"), s("I3", "2026-10-15")]],
    ["an empty reason", [s("I1", "2026-10-14", "  ")]],
    ["a long reason", [s("I1", "2026-10-14", "x".repeat(201))]],
  ])("rejects %s", (_label, slots) => {
    expect(schema().safeParse({ slots, note: null }).success).toBe(false);
  });

  it("counts already-scheduled items towards the per-day limit", () => {
    const plan = { slots: [s("I1", "2026-10-15")], note: null };
    expect(schema(3, { "2026-10-15": 1 }).safeParse(plan).success).toBe(true);
    expect(schema(3, { "2026-10-15": 2 }).safeParse(plan).success).toBe(false);
  });

  it("allows zero slots only with a note", () => {
    expect(schema().safeParse({ slots: [], note: null }).success).toBe(false);
    expect(schema().safeParse({ slots: [], note: "  " }).success).toBe(false);
    expect(schema().safeParse({ slots: [], note: "None of your saved ideas fit this week's theme." }).success).toBe(true);
    expect(schema().safeParse({ slots: [], note: "x".repeat(301) }).success).toBe(false);
  });
});
