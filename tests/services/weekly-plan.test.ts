import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AI_ERRORS, type AiErrorCode } from "@/lib/ai/errors";
import type { AiResult } from "@/lib/ai/run-structured";
import type { WeeklyPlanModelOutput, WeeklyPlanOutput } from "@/lib/schemas/calendar";
import {
  generateWeeklyPlan,
  PLAN_IDEAS_LIMIT,
  WEEKLY_PLAN_ERRORS,
  type WeeklyPlanDeps,
} from "@/lib/services/weekly-plan";
import { STRATEGY_JSON } from "../db/helpers";
import { fakeSupabase, pgError, type FakeResult, type RecordedQuery } from "./fake-supabase";

const USER_ID = "user_weekly_plan";
const TZ = "Africa/Lagos";
// Wed 2026-10-14 10:00 in Lagos.
const NOW = Date.parse("2026-10-14T09:00:00Z");
const WEEK = "2026-10-12";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ideaRow = (n: number) => ({
  id: uuid(n),
  topic: `Saved idea ${n}`,
  hook: `Hook ${n}`,
  format: "short",
  platform: "youtube",
  difficulty: n % 2 ? "easy" : "hard",
  pillar: { name: n % 2 ? "Quick workouts" : "Fuel" },
});
const itemRow = (date: string) => ({
  id: uuid(900),
  idea_id: uuid(901),
  title: "Already planned",
  platform: "tiktok",
  format: "short",
  status: "scheduled",
  scheduled_for: `${date}T08:00:00+00:00`,
  pillar: { name: "Fuel" },
  idea: { hook: null },
});

const profileRow = { timezone: TZ, posting_capacity_per_week: 3, platforms: ["youtube", "tiktok"], experience_level: "beginner" };
const strategyRow = {
  format_strategy: JSON.parse(STRATEGY_JSON.format_strategy),
  thirty_day_plan: JSON.parse(STRATEGY_JSON.thirty_day_plan),
  // Saved in the week of Mon 2026-10-05, so 2026-10-12 is week 2 of the plan.
  updated_at: "2026-10-06T10:00:00Z",
};

interface Options {
  profile?: unknown;
  strategy?: unknown;
  items?: readonly unknown[];
  ideas?: readonly unknown[];
  pendingCount?: number;
  profileError?: FakeResult["error"];
}

function setup(options: Options = {}) {
  return fakeSupabase({
    creator_profiles: { data: options.profile === undefined ? profileRow : options.profile, error: options.profileError ?? null },
    creator_strategies: { data: options.strategy === undefined ? strategyRow : options.strategy },
    content_items: { data: options.items ?? [] },
    content_ideas: { data: options.ideas ?? [ideaRow(1), ideaRow(2), ideaRow(3)] },
    ai_generations: { count: options.pendingCount ?? 0 },
  });
}

const plan = (slots: WeeklyPlanModelOutput["slots"], note: string | null = null): WeeklyPlanModelOutput => ({ slots, note });
const defaultPlan = plan([
  { idea_ref: "I1", date: "2026-10-15", reason: "An easy start after your planned Fuel post." },
  { idea_ref: "I2", date: "2026-10-14", reason: "Covers your Fuel pillar early in the week." },
]);

/** Returns `output` through the request's model schema and validator, as `runStructured` does. */
const succeed = (output: WeeklyPlanModelOutput = defaultPlan): WeeklyPlanDeps["run"] =>
  vi.fn(async (request): Promise<AiResult<WeeklyPlanOutput>> => {
    const strict = (request.schema as z.ZodType).safeParse(output);
    const validated = strict.success ? request.validate!(output) : ({ ok: false } as const);
    if (!validated.ok) return { ok: false, code: "invalid_output", ...AI_ERRORS.invalid_output };
    return {
      ok: true,
      data: validated.data,
      generationId: "gen_1",
      usage: { model: "m", tier: "quality", inputTokens: 1, outputTokens: 1, latencyMs: 1, costMicros: 1 },
    };
  });

const failWith = (code: AiErrorCode): WeeklyPlanDeps["run"] =>
  vi.fn(async () => ({ ok: false as const, code, ...AI_ERRORS[code] }));

const writes = (queries: RecordedQuery[]) => queries.filter((q) => q.op !== "select");

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorLog.mockRestore();
});

describe("generateWeeklyPlan", () => {
  it("returns a proposal mapped to real ideas, sorted by day, and stores nothing", async () => {
    const { client, queries, rpcCalls } = setup();
    const run = succeed();
    const result = await generateWeeklyPlan(client, USER_ID, { weekStart: WEEK }, { run, now: () => NOW });

    expect(result).toEqual({
      ok: true,
      note: null,
      slots: [
        {
          idea_id: uuid(2),
          date: "2026-10-14",
          time: "09:00",
          reason: "Covers your Fuel pillar early in the week.",
          idea: { topic: "Saved idea 2", pillar_name: "Fuel", platform: "youtube", format: "short", difficulty: "hard" },
        },
        expect.objectContaining({ idea_id: uuid(1), date: "2026-10-15", time: "09:00" }),
      ],
    });
    expect(writes(queries)).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it("builds input from cadence, theme, the week's days and saved ideas, with refs and no ids", async () => {
    const { client, queries } = setup({ items: [itemRow("2026-10-15")] });
    const run = succeed();
    await generateWeeklyPlan(client, USER_ID, { weekStart: WEEK }, { run, now: () => NOW });

    const request = vi.mocked(run).mock.calls[0][0];
    expect(request).toMatchObject({ userId: USER_ID, kind: "weekly_plan" });
    const { input } = request;
    expect(input.postingCapacityPerWeek).toBe(3);
    expect(input.remainingSlots).toBe(2);
    expect(input.platforms).toEqual(["youtube", "tiktok"]);
    expect(input.cadence).toEqual([{ platform: "youtube", formats: ["shorts"], cadence: "2/wk" }]);
    expect(input.weekTheme).toEqual({ week: 2, theme: "t", focus: "f" });
    expect(input.days.map((d) => [d.date, d.past, d.scheduled])).toEqual([
      ["2026-10-12", true, 0],
      ["2026-10-13", true, 0],
      ["2026-10-14", false, 0],
      ["2026-10-15", false, 1],
      ["2026-10-16", false, 0],
      ["2026-10-17", false, 0],
      ["2026-10-18", false, 0],
    ]);
    expect(input.scheduled).toEqual([{ title: "Already planned", pillar: "Fuel", platform: "tiktok", date: "2026-10-15" }]);
    expect(input.ideas.map((i) => i.ref)).toEqual(["I1", "I2", "I3"]);
    expect(input.ideas[0]).toEqual({
      ref: "I1",
      topic: "Saved idea 1",
      pillar: "Quick workouts",
      platform: "youtube",
      format: "short",
      difficulty: "easy",
      hook: "Hook 1",
    });

    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain(USER_ID);
    expect(serialized).not.toContain(uuid(1));
    expect(serialized).not.toContain(uuid(900));

    // The model may only pick open (today or later) dates.
    const strict = request.schema as z.ZodType;
    expect(strict.safeParse(plan([{ idea_ref: "I1", date: "2026-10-13", reason: "r" }])).success).toBe(false);
    expect(strict.safeParse(plan([{ idea_ref: "I1", date: "2026-10-14", reason: "r" }])).success).toBe(true);

    const ideas = queries.find((q) => q.table === "content_ideas")!;
    expect(ideas.filters).toEqual(
      expect.arrayContaining([
        ["eq", "status", "saved"],
        ["limit", PLAN_IDEAS_LIMIT],
      ]),
    );
  });

  it("omits the theme when the week is past the 30-day plan", async () => {
    const { client } = setup({ strategy: { ...strategyRow, updated_at: "2026-08-01T00:00:00Z" } });
    const run = succeed();
    await generateWeeklyPlan(client, USER_ID, { weekStart: WEEK }, { run, now: () => NOW });
    expect(vi.mocked(run).mock.calls[0][0].input.weekTheme).toBeNull();
  });

  it("rejects a plan over the remaining capacity as invalid_output", async () => {
    const { client } = setup({ items: [itemRow("2026-10-16"), itemRow("2026-10-17")] });
    const result = await generateWeeklyPlan(client, USER_ID, { weekStart: WEEK }, { run: succeed(), now: () => NOW });
    expect(result).toMatchObject({ ok: false, code: "invalid_output", retryable: true });
  });

  it("rejects a third item on a day that already has two", async () => {
    const { client } = setup({
      profile: { ...profileRow, posting_capacity_per_week: 5 },
      items: [itemRow("2026-10-15"), itemRow("2026-10-15")],
    });
    const result = await generateWeeklyPlan(
      client,
      USER_ID,
      { weekStart: WEEK },
      { run: succeed(plan([{ idea_ref: "I1", date: "2026-10-15", reason: "r" }])), now: () => NOW },
    );
    expect(result).toMatchObject({ ok: false, code: "invalid_output" });
  });

  it("passes an explanatory note through with fewer slots", async () => {
    const { client } = setup();
    const output = plan([{ idea_ref: "I3", date: "2026-10-16", reason: "r" }], "Only one idea fits this week.");
    await expect(
      generateWeeklyPlan(client, USER_ID, { weekStart: WEEK }, { run: succeed(output), now: () => NOW }),
    ).resolves.toMatchObject({ ok: true, note: "Only one idea fits this week.", slots: [expect.objectContaining({ idea_id: uuid(3) })] });
  });

  it.each([
    ["no profile", { profile: null }, "missing_context"],
    ["no timezone", { profile: { ...profileRow, timezone: null } }, "missing_timezone"],
    ["no strategy", { strategy: null }, "missing_context"],
    ["no posting capacity", { profile: { ...profileRow, posting_capacity_per_week: null } }, "missing_context"],
    ["no saved ideas", { ideas: [] }, "no_saved_ideas"],
    ["a full week", { profile: { ...profileRow, posting_capacity_per_week: 1 }, items: [itemRow("2026-10-15")] }, "week_full"],
    ["a pending generation", { pendingCount: 1 }, "in_progress"],
  ] as const)("refuses with %s, without calling the AI", async (_label, options, code) => {
    const { client } = setup(options);
    const run = succeed();
    await expect(generateWeeklyPlan(client, USER_ID, { weekStart: WEEK }, { run, now: () => NOW })).resolves.toEqual({
      ok: false,
      code,
      ...WEEKLY_PLAN_ERRORS[code],
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("checks for a pending weekly_plan in the last 2 minutes", async () => {
    const { client, queries } = setup({ pendingCount: 1 });
    await generateWeeklyPlan(client, USER_ID, { weekStart: WEEK }, { run: succeed(), now: () => NOW });
    expect(queries.find((q) => q.table === "ai_generations")!.filters).toEqual(
      expect.arrayContaining([
        ["eq", "user_id", USER_ID],
        ["eq", "kind", "weekly_plan"],
        ["eq", "status", "pending"],
        ["gte", "created_at", "2026-10-14T08:58:00.000Z"],
      ]),
    );
  });

  it.each([
    ["not a Monday", "2026-10-14"],
    ["a past week", "2026-10-05"],
    ["too far ahead", "2027-05-03"],
    ["not a date", "next week"],
  ])("refuses %s as invalid_week", async (_label, weekStart) => {
    const { client } = setup();
    const run = succeed();
    await expect(generateWeeklyPlan(client, USER_ID, { weekStart }, { run, now: () => NOW })).resolves.toMatchObject({
      ok: false,
      code: "invalid_week",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it.each(Object.keys(AI_ERRORS) as AiErrorCode[])("maps AI failure %s to a message and stores nothing", async (code) => {
    const { client, queries } = setup();
    const result = await generateWeeklyPlan(client, USER_ID, { weekStart: WEEK }, { run: failWith(code), now: () => NOW });
    expect(result).toEqual({ ok: false, code, ...WEEKLY_PLAN_ERRORS[code] });
    expect(writes(queries)).toEqual([]);
  });

  it("fails closed on a read error and logs no ids", async () => {
    const { client } = setup({ profileError: pgError("XX000", `boom for ${USER_ID}`) });
    const run = succeed();
    await expect(generateWeeklyPlan(client, USER_ID, { weekStart: WEEK }, { run, now: () => NOW })).resolves.toMatchObject({
      ok: false,
      code: "persistence_error",
    });
    expect(run).not.toHaveBeenCalled();
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain(USER_ID);
  });
});
