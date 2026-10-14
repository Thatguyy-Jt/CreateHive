import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_ERRORS,
  getCalendarSetup,
  getTimezone,
  listWeek,
  rescheduleItem,
  saveTimezone,
  scheduleIdeas,
  unscheduleItem,
} from "@/lib/services/calendar";
import { fakeSupabase, pgError } from "./fake-supabase";

const USER_ID = "user_calendar";
const IDEA_ID = "6f1c1f9e-4d0a-4b8e-9a37-0d1f7e2b9c11";
const IDEA_2 = "7a2d2fae-5e1b-4c9f-8b48-1e2f8f3cad22";
const ITEM_ID = "8b3e30bf-6f2c-4daf-9c59-2f309f4dbe33";
const TZ = "Africa/Lagos"; // UTC+1, no DST
// Wed 2026-10-14 10:00 in Lagos.
const NOW = Date.parse("2026-10-14T09:00:00Z");

let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  errorLog.mockRestore();
  warnLog.mockRestore();
});

describe("getTimezone / saveTimezone", () => {
  it("reads the creator's timezone, scoped to them", async () => {
    const { client, queries } = fakeSupabase({ creator_profiles: { data: { timezone: TZ } } });
    await expect(getTimezone(client, USER_ID)).resolves.toEqual({ ok: true, timezone: TZ });
    expect(queries[0].filters).toEqual([["eq", "user_id", USER_ID]]);
  });

  it("treats a missing or no-longer-valid timezone as not set", async () => {
    for (const timezone of [null, "Nowhere/City"]) {
      const { client } = fakeSupabase({ creator_profiles: { data: { timezone } } });
      await expect(getTimezone(client, USER_ID)).resolves.toEqual({ ok: true, timezone: null });
    }
  });

  it("reports a missing profile and read errors", async () => {
    const missing = fakeSupabase({ creator_profiles: { data: null } });
    await expect(getTimezone(missing.client, USER_ID)).resolves.toMatchObject({ ok: false, code: "missing_profile" });
    const broken = fakeSupabase({ creator_profiles: { error: pgError() } });
    await expect(getTimezone(broken.client, USER_ID)).resolves.toMatchObject({ ok: false, code: "db_error" });
  });

  it("saves a valid timezone on the creator's own profile", async () => {
    const { client, queries } = fakeSupabase({ creator_profiles: { data: [{ user_id: USER_ID }] } });
    await expect(saveTimezone(client, USER_ID, " Asia/Tokyo ")).resolves.toEqual({ ok: true, timezone: "Asia/Tokyo" });
    expect(queries[0]).toMatchObject({ op: "update", payload: { timezone: "Asia/Tokyo" }, filters: [["eq", "user_id", USER_ID]] });
  });

  it("rejects an invalid timezone without writing", async () => {
    const { client, queries } = fakeSupabase({});
    await expect(saveTimezone(client, USER_ID, "Nowhere/City")).resolves.toEqual({
      ok: false,
      code: "invalid_timezone",
      message: CALENDAR_ERRORS.invalid_timezone,
    });
    expect(queries).toEqual([]);
  });

  it("reports missing_profile when no row was updated", async () => {
    const { client } = fakeSupabase({ creator_profiles: { data: [] } });
    await expect(saveTimezone(client, USER_ID, TZ)).resolves.toMatchObject({ ok: false, code: "missing_profile" });
  });
});

describe("getCalendarSetup", () => {
  it("reports onboarding, strategy, timezone and capacity", async () => {
    const { client } = fakeSupabase({
      creator_profiles: { data: { onboarding_status: "completed", timezone: TZ, posting_capacity_per_week: 3 } },
      creator_strategies: { count: 1 },
      content_pillars: { count: 3 },
    });
    await expect(getCalendarSetup(client, USER_ID)).resolves.toEqual({
      ok: true,
      setup: { onboarded: true, hasStrategy: true, timezone: TZ, postingCapacityPerWeek: 3 },
    });
  });

  it("handles a creator with no profile yet", async () => {
    const { client } = fakeSupabase({
      creator_profiles: { data: null },
      creator_strategies: { count: 0 },
      content_pillars: { count: 0 },
    });
    await expect(getCalendarSetup(client, USER_ID)).resolves.toEqual({
      ok: true,
      setup: { onboarded: false, hasStrategy: false, timezone: null, postingCapacityPerWeek: null },
    });
  });
});

describe("listWeek", () => {
  const itemRow = (overrides: Record<string, unknown> = {}) => ({
    id: ITEM_ID,
    idea_id: IDEA_ID,
    title: "10-minute squats",
    platform: "youtube",
    format: "short",
    status: "scheduled",
    scheduled_for: "2026-10-15T08:00:00+00:00",
    pillar: { name: "Quick workouts" },
    idea: { hook: "No gym? No problem." },
    ...overrides,
  });
  const ideaRow = { id: IDEA_2, topic: "Meal prep", hook: null, format: null, platform: "tiktok", difficulty: "easy", pillar: null };

  it("queries the week's UTC range in the creator's zone and returns local dates and times", async () => {
    const { client, queries } = fakeSupabase({
      content_items: { data: [itemRow(), itemRow({ id: "past", scheduled_for: "2026-10-12T08:00:00+00:00" })] },
      content_ideas: { data: [ideaRow] },
    });
    const result = await listWeek(client, USER_ID, "2026-10-12", TZ, NOW);
    expect(result).toEqual({
      ok: true,
      items: [
        {
          id: ITEM_ID,
          idea_id: IDEA_ID,
          title: "10-minute squats",
          platform: "youtube",
          format: "short",
          status: "scheduled",
          scheduled_for: "2026-10-15T08:00:00+00:00",
          pillar_name: "Quick workouts",
          hook: "No gym? No problem.",
          date: "2026-10-15",
          time: "09:00",
          passed: false,
        },
        expect.objectContaining({ id: "past", date: "2026-10-12", passed: true }),
      ],
      unscheduled: [
        { id: IDEA_2, topic: "Meal prep", hook: null, format: null, platform: "tiktok", difficulty: "easy", pillar_name: null },
      ],
    });

    const items = queries.find((q) => q.table === "content_items")!;
    expect(items.filters).toEqual([
      ["eq", "user_id", USER_ID],
      ["eq", "status", "scheduled"],
      ["gte", "scheduled_for", "2026-10-11T23:00:00.000Z"],
      ["lt", "scheduled_for", "2026-10-18T23:00:00.000Z"],
      ["order", "scheduled_for", { ascending: true }],
    ]);
    const ideas = queries.find((q) => q.table === "content_ideas")!;
    expect(ideas.filters).toEqual([
      ["eq", "user_id", USER_ID],
      ["eq", "status", "saved"],
      ["order", "created_at", { ascending: false }],
      ["limit", 50],
    ]);
  });

  it("skips rows that don't validate and logs it", async () => {
    const { client } = fakeSupabase({
      content_items: { data: [itemRow({ status: "made_up" }), itemRow()] },
      content_ideas: { data: [{ ...ideaRow, platform: "myspace" }] },
    });
    const result = await listWeek(client, USER_ID, "2026-10-12", TZ, NOW);
    expect(result.ok && result.items.map((i) => i.id)).toEqual([ITEM_ID]);
    expect(result.ok && result.unscheduled).toEqual([]);
    expect(warnLog.mock.calls.flat().join(" ")).toContain("calendar_read_skipped");
  });

  it("skips the saved-ideas query when the limit is 0", async () => {
    const { client, queries } = fakeSupabase({ content_items: { data: [itemRow()] } });
    const result = await listWeek(client, USER_ID, "2026-10-12", TZ, NOW, 0);
    expect(result.ok && result.items.map((i) => i.id)).toEqual([ITEM_ID]);
    expect(result.ok && result.unscheduled).toEqual([]);
    expect(queries.map((q) => q.table)).toEqual(["content_items"]);
  });

  it("returns ok: false on a read error or an invalid zone", async () => {
    const { client } = fakeSupabase({ content_items: { error: pgError() }, content_ideas: { data: [] } });
    await expect(listWeek(client, USER_ID, "2026-10-12", TZ, NOW)).resolves.toEqual({ ok: false });
    await expect(listWeek(client, USER_ID, "2026-10-12", "Nowhere/City", NOW)).resolves.toEqual({ ok: false });
  });
});

describe("scheduleIdeas", () => {
  const rpcOk = () => fakeSupabase({}, () => ({ data: 1 }));

  it("converts local date/time to UTC and calls the RPC with only idea ids and instants", async () => {
    const { client, rpcCalls } = rpcOk();
    await expect(
      scheduleIdeas(client, USER_ID, [{ idea_id: IDEA_ID, date: "2026-10-15", time: "09:00" }], TZ, NOW),
    ).resolves.toEqual({ ok: true, scheduled: 1 });
    expect(rpcCalls).toEqual([
      { name: "schedule_content_ideas", args: { p_slots: [{ idea_id: IDEA_ID, scheduled_for: "2026-10-15T08:00:00.000Z" }] } },
    ]);
    expect(JSON.stringify(rpcCalls)).not.toContain(USER_ID);
  });

  it.each([
    ["a past date", [{ idea_id: IDEA_ID, date: "2026-10-13", time: "09:00" }], "date_past"],
    ["earlier today, beyond the grace", [{ idea_id: IDEA_ID, date: "2026-10-14", time: "08:30" }], "date_past"],
    ["more than 180 days ahead", [{ idea_id: IDEA_ID, date: "2027-04-13", time: "09:00" }], "date_too_far"],
    [
      "the same idea twice",
      [
        { idea_id: IDEA_ID, date: "2026-10-15", time: "09:00" },
        { idea_id: IDEA_ID, date: "2026-10-16", time: "09:00" },
      ],
      "duplicate_idea",
    ],
    ["a bad id", [{ idea_id: "nope", date: "2026-10-15", time: "09:00" }], "invalid_input"],
    ["a bad time", [{ idea_id: IDEA_ID, date: "2026-10-15", time: "9am" }], "invalid_input"],
    ["no slots", [], "invalid_input"],
  ] as const)("refuses %s without calling the database", async (_label, slots, code) => {
    const { client, rpcCalls } = rpcOk();
    await expect(scheduleIdeas(client, USER_ID, slots, TZ, NOW)).resolves.toEqual({
      ok: false,
      code,
      message: CALENDAR_ERRORS[code],
    });
    expect(rpcCalls).toEqual([]);
  });

  it("allows a time earlier today within the 1-hour grace", async () => {
    const { client } = rpcOk();
    await expect(
      scheduleIdeas(client, USER_ID, [{ idea_id: IDEA_ID, date: "2026-10-14", time: "09:30" }], TZ, NOW),
    ).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["idea_not_found", "idea_not_found"],
    ["idea_not_saved", "idea_not_saved"],
    ["duplicate_idea", "duplicate_idea"],
    ["scheduled_for_out_of_range", "date_past"],
    ["something else", "db_error"],
  ] as const)("maps the database error %s to %s", async (message, code) => {
    const { client } = fakeSupabase({}, () => ({ error: { code: "P0001", message } }));
    await expect(
      scheduleIdeas(client, USER_ID, [{ idea_id: IDEA_ID, date: "2026-10-15", time: "09:00" }], TZ, NOW),
    ).resolves.toEqual({ ok: false, code, message: CALENDAR_ERRORS[code] });
  });

  it("never throws when the client does", async () => {
    const { client } = fakeSupabase({}, () => new Error(`network down for ${USER_ID}`));
    await expect(
      scheduleIdeas(client, USER_ID, [{ idea_id: IDEA_ID, date: "2026-10-15", time: "09:00" }], TZ, NOW),
    ).resolves.toMatchObject({ ok: false, code: "db_error" });
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain(USER_ID);
  });
});

describe("rescheduleItem", () => {
  it("updates only scheduled_for on the creator's scheduled item", async () => {
    const { client, queries } = fakeSupabase({ content_items: { data: [{ id: ITEM_ID }] } });
    await expect(rescheduleItem(client, USER_ID, ITEM_ID, "2026-10-16", "18:30", TZ, NOW)).resolves.toEqual({ ok: true });
    expect(queries[0]).toMatchObject({
      op: "update",
      payload: { scheduled_for: "2026-10-16T17:30:00.000Z" },
      filters: [
        ["eq", "id", ITEM_ID],
        ["eq", "user_id", USER_ID],
        ["eq", "status", "scheduled"],
      ],
    });
  });

  it("reports not_found when nothing matched (another creator's, or not scheduled)", async () => {
    const { client } = fakeSupabase({ content_items: { data: [] } });
    await expect(rescheduleItem(client, USER_ID, ITEM_ID, "2026-10-16", "09:00", TZ, NOW)).resolves.toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it.each([
    ["a past date", ITEM_ID, "2026-10-13", "date_past"],
    ["a far date", ITEM_ID, "2027-05-01", "date_too_far"],
    ["a bad id", "x", "2026-10-16", "not_found"],
    ["a bad date", ITEM_ID, "tomorrow", "invalid_input"],
  ] as const)("refuses %s without writing", async (_label, id, date, code) => {
    const { client, queries } = fakeSupabase({});
    await expect(rescheduleItem(client, USER_ID, id, date, "09:00", TZ, NOW)).resolves.toMatchObject({ ok: false, code });
    expect(queries).toEqual([]);
  });
});

describe("unscheduleItem", () => {
  it("calls the RPC with the item id only", async () => {
    const { client, rpcCalls } = fakeSupabase({}, () => ({}));
    await expect(unscheduleItem(client, USER_ID, ITEM_ID)).resolves.toEqual({ ok: true });
    expect(rpcCalls).toEqual([{ name: "unschedule_content_item", args: { p_item_id: ITEM_ID } }]);
  });

  it("maps item_not_found and rejects a bad id", async () => {
    const { client } = fakeSupabase({}, () => ({ error: { code: "P0002", message: "item_not_found" } }));
    await expect(unscheduleItem(client, USER_ID, ITEM_ID)).resolves.toMatchObject({ ok: false, code: "not_found" });
    const bad = fakeSupabase({});
    await expect(unscheduleItem(bad.client, USER_ID, "nope")).resolves.toMatchObject({ ok: false, code: "not_found" });
    expect(bad.rpcCalls).toEqual([]);
  });
});
