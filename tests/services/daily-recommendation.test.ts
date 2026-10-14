import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredOpportunity } from "@/lib/schemas/opportunities";
import {
  CANDIDATE_LIMIT,
  getDailyRecommendation,
  MAX_REASONS,
  rankIdeas,
  type DailyRecommendationResult,
  type Recommendation,
} from "@/lib/services/daily-recommendation";
import { fakeSupabase, pgError, type FakeResult, type RecordedQuery } from "./fake-supabase";

const USER_ID = "user_daily";
const TZ = "Africa/Lagos"; // UTC+1, no DST
// Wed 2026-10-14 10:00 in Lagos.
const NOW = Date.parse("2026-10-14T09:00:00Z");
const TODAY = "2026-10-14";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T00:00:00+00:00`;

function ideaRow(n: number, overrides: Record<string, unknown> = {}) {
  return {
    id: uuid(n),
    topic: `Idea ${n}`,
    audience_need: null,
    angle: null,
    hook: `Hook ${n}`,
    format: "short",
    platform: "youtube",
    rationale: null,
    cta: null,
    difficulty: null,
    audience_fit: null,
    evidence_strength: null,
    evidence: [],
    status: "saved",
    created_at: day(n),
    pillar: { name: "Fuel" },
    ...overrides,
  };
}

function itemRow(n: number, scheduledFor: string, pillar = "Fuel") {
  return {
    id: uuid(100 + n),
    idea_id: uuid(200 + n),
    title: `Item ${n}`,
    platform: "tiktok",
    format: "short",
    status: "scheduled",
    scheduled_for: scheduledFor,
    pillar: { name: pillar },
    idea: { hook: `Item hook ${n}` },
  };
}

interface Options {
  onboarding?: string;
  strategies?: number;
  pillars?: number;
  timezone?: string | null;
  capacity?: number | null;
  experience?: string | null;
  items?: unknown[];
  ideas?: unknown[];
  ideasError?: boolean;
  itemsError?: boolean;
}

function setup(options: Options = {}) {
  const profile = (query: RecordedQuery): FakeResult =>
    query.columns?.includes("onboarding_status")
      ? {
          data: {
            onboarding_status: options.onboarding ?? "completed",
            timezone: options.timezone === undefined ? TZ : options.timezone,
            posting_capacity_per_week: options.capacity === undefined ? 3 : options.capacity,
          },
        }
      : { data: { experience_level: options.experience === undefined ? "beginner" : options.experience } };
  return fakeSupabase({
    creator_profiles: profile,
    creator_strategies: { count: options.strategies ?? 1 },
    content_pillars: { count: options.pillars ?? 3 },
    content_items: options.itemsError ? { error: pgError() } : { data: options.items ?? [] },
    content_ideas: options.ideasError ? { error: pgError() } : { data: options.ideas ?? [] },
  });
}

async function recommend(options: Options = {}): Promise<Extract<DailyRecommendationResult, { ok: true }>> {
  const { client } = setup(options);
  const result = await getDailyRecommendation(client, USER_ID, NOW);
  if (!result.ok) throw new Error("expected ok");
  return result;
}

const kindOf = (rec: Recommendation) => rec.kind;

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

describe("getDailyRecommendation: setup rules", () => {
  it("asks to finish setup first, even with nothing else in place", async () => {
    const result = await recommend({ onboarding: "in_progress", strategies: 0, timezone: null });
    expect(result).toEqual({ ok: true, today: null, recommendation: { kind: "finish_setup" }, nextIdea: null });
  });

  it("asks to build the strategy when it or its active pillars are missing", async () => {
    expect(kindOf((await recommend({ strategies: 0, timezone: null })).recommendation)).toBe("build_strategy");
    expect(kindOf((await recommend({ pillars: 0 })).recommendation)).toBe("build_strategy");
  });

  it("asks to confirm the timezone when none is saved, before anything on the calendar", async () => {
    const result = await recommend({ timezone: null, ideas: [ideaRow(1)] });
    expect(result).toEqual({ ok: true, today: null, recommendation: { kind: "confirm_timezone" }, nextIdea: null });
  });
});

describe("getDailyRecommendation: make_today", () => {
  it("wins over everything else and picks the next upcoming item", async () => {
    const result = await recommend({
      items: [
        itemRow(1, "2026-10-14T07:00:00+00:00"), // 08:00, passed
        itemRow(2, "2026-10-14T15:00:00+00:00"), // 16:00, upcoming
        itemRow(3, "2026-10-14T18:00:00+00:00"),
        itemRow(4, "2026-10-15T08:00:00+00:00"), // tomorrow
      ],
      ideas: [ideaRow(1), ideaRow(2, { status: "new" })],
    });
    expect(result.today).toBe(TODAY);
    expect(result.recommendation).toMatchObject({ kind: "make_today", item: { id: uuid(102), time: "16:00" }, moreToday: 2 });
    // The primary isn't about an idea, so the best saved idea comes second.
    expect(result.nextIdea?.id).toBe(uuid(1));
  });

  it("falls back to the last item when every item today has passed", async () => {
    const result = await recommend({
      items: [itemRow(1, "2026-10-14T06:00:00+00:00"), itemRow(2, "2026-10-14T07:00:00+00:00")],
    });
    expect(result.recommendation).toMatchObject({ kind: "make_today", item: { id: uuid(102), passed: true }, moreToday: 1 });
    expect(result.nextIdea).toBeNull();
  });

  it("follows the creator's timezone for today", async () => {
    // 23:30 UTC on Oct 14 is 00:30 on Oct 15 in Lagos.
    const late = [itemRow(1, "2026-10-14T23:30:00+00:00")];
    expect(kindOf((await recommend({ items: late })).recommendation)).toBe("generate_ideas");
    expect(kindOf((await recommend({ items: late, timezone: "UTC" })).recommendation)).toBe("make_today");
  });
});

describe("getDailyRecommendation: ideas", () => {
  it("suggests scheduling the top saved idea when the week has room", async () => {
    const result = await recommend({
      items: [itemRow(1, "2026-10-15T08:00:00+00:00")],
      ideas: [ideaRow(1), ideaRow(2, { status: "new" })],
    });
    expect(result.recommendation).toMatchObject({ kind: "schedule_saved", idea: { id: uuid(1) }, room: 2 });
    expect(result.nextIdea).toBeNull();
  });

  it("treats a missing capacity as room", async () => {
    const items = [1, 2, 3, 4, 5].map((n) => itemRow(n, `2026-10-1${5 + (n % 3)}T08:00:00+00:00`));
    const result = await recommend({ capacity: null, items, ideas: [ideaRow(1)] });
    expect(result.recommendation).toMatchObject({ kind: "schedule_saved", room: null });
  });

  it("asks to review new ideas when the week is full, before planning next week", async () => {
    const items = [1, 2, 3].map((n) => itemRow(n, `2026-10-1${4 + n}T08:00:00+00:00`));
    const result = await recommend({
      items,
      ideas: [ideaRow(1), ideaRow(2, { status: "new" }), ideaRow(3, { status: "new" })],
    });
    expect(result.recommendation).toMatchObject({ kind: "review_new", idea: { id: uuid(3) }, count: 2 });
    expect(result.nextIdea).toBeNull();
  });

  it("asks to review new ideas when there are no saved ones, even with room", async () => {
    const result = await recommend({ ideas: [ideaRow(2, { status: "new" })] });
    expect(result.recommendation).toMatchObject({ kind: "review_new", count: 1 });
  });

  it("suggests planning next week when the week is full and only saved ideas wait", async () => {
    const items = [1, 2, 3].map((n) => itemRow(n, `2026-10-1${4 + n}T08:00:00+00:00`));
    const result = await recommend({ items, ideas: [ideaRow(1), ideaRow(2)] });
    expect(result.recommendation).toEqual({ kind: "plan_next_week", nextWeek: "2026-10-19", scheduled: 3, savedCount: 2 });
    expect(result.nextIdea?.id).toBe(uuid(2));
  });

  it("suggests finding ideas when there are none", async () => {
    const result = await recommend();
    expect(result).toEqual({ ok: true, today: TODAY, recommendation: { kind: "generate_ideas" }, nextIdea: null });
  });

  it("uses this week's scheduled pillars when ranking", async () => {
    const result = await recommend({
      items: [itemRow(1, "2026-10-15T08:00:00+00:00", "Fuel")],
      ideas: [ideaRow(2, { pillar: { name: "Fuel" } }), ideaRow(1, { pillar: { name: "Mindset" } })],
    });
    expect(result.recommendation).toMatchObject({
      kind: "schedule_saved",
      idea: { id: uuid(1), reasons: ["Your “Mindset” pillar has nothing planned this week"] },
    });
  });

  it("skips ideas that no longer validate and logs it", async () => {
    const result = await recommend({ ideas: [ideaRow(2, { platform: "myspace" }), ideaRow(1)] });
    expect(result.recommendation).toMatchObject({ kind: "schedule_saved", idea: { id: uuid(1) } });
    expect(warnLog.mock.calls.flat().join(" ")).toContain("daily_recommendation_skipped");
  });
});

describe("getDailyRecommendation: reads", () => {
  it("only reads, scoped to the creator, and never writes or calls RPCs", async () => {
    const { client, queries, rpcCalls } = setup({ items: [itemRow(1, "2026-10-15T08:00:00+00:00")], ideas: [ideaRow(1)] });
    await getDailyRecommendation(client, USER_ID, NOW);
    expect(rpcCalls).toEqual([]);
    expect(queries.every((q) => q.op === "select")).toBe(true);
    expect(queries.every((q) => q.filters.some((f) => f[0] === "eq" && f[1] === "user_id" && f[2] === USER_ID))).toBe(true);
    const ideas = queries.filter((q) => q.table === "content_ideas");
    expect(ideas).toHaveLength(1);
    expect(ideas[0].filters).toEqual([
      ["eq", "user_id", USER_ID],
      ["in", "status", ["saved", "new"]],
      ["order", "created_at", { ascending: false }],
      ["limit", CANDIDATE_LIMIT],
    ]);
  });

  it("returns ok: false on a read error", async () => {
    for (const options of [{ ideasError: true }, { itemsError: true }]) {
      const { client } = setup(options);
      await expect(getDailyRecommendation(client, USER_ID, NOW)).resolves.toEqual({ ok: false });
    }
    const broken = fakeSupabase({ creator_profiles: new Error("network") });
    await expect(getDailyRecommendation(broken.client, USER_ID, NOW)).resolves.toEqual({ ok: false });
  });
});

describe("rankIdeas", () => {
  const stored = (n: number, overrides: Partial<StoredOpportunity> = {}): StoredOpportunity => {
    const { pillar, ...rest } = ideaRow(n);
    return { ...(rest as unknown as StoredOpportunity), pillar_name: pillar.name, scheduled_for: null, ...overrides };
  };
  const ids = (ideas: { id: string }[]) => ideas.map((idea) => idea.id);
  const beginner = { experience: "beginner" as const, plannedPillars: [] };

  it("puts a pillar with nothing planned this week first", () => {
    const ranked = rankIdeas([stored(2, { evidence_strength: "high" }), stored(1, { pillar_name: "Mindset" })], {
      experience: "beginner",
      plannedPillars: ["fuel"],
    });
    expect(ids(ranked)).toEqual([uuid(1), uuid(2)]);
  });

  it("then evidence strength, then audience fit, then difficulty", () => {
    expect(ids(rankIdeas([stored(2, { evidence_strength: "low" }), stored(1, { evidence_strength: "high" })], beginner))).toEqual([
      uuid(1),
      uuid(2),
    ]);
    expect(ids(rankIdeas([stored(2), stored(1, { audience_fit: "medium" })], beginner))).toEqual([uuid(1), uuid(2)]);
    expect(
      ids(rankIdeas([stored(3, { difficulty: "hard" }), stored(2, { difficulty: "medium" }), stored(1, { difficulty: "easy" })], beginner)),
    ).toEqual([uuid(1), uuid(2), uuid(3)]);
  });

  it("weighs difficulty by experience", () => {
    const ideas = [stored(3, { difficulty: "hard" }), stored(2, { difficulty: "easy" }), stored(1, { difficulty: "medium" })];
    // Growing: easy and medium tie, so the newer one wins; hard last.
    expect(ids(rankIdeas(ideas, { experience: "growing", plannedPillars: [] }))).toEqual([uuid(2), uuid(1), uuid(3)]);
    // Established: no preference, newest first.
    expect(ids(rankIdeas(ideas, { experience: "established", plannedPillars: [] }))).toEqual([uuid(3), uuid(2), uuid(1)]);
  });

  it("breaks ties by newest first", () => {
    expect(ids(rankIdeas([stored(1), stored(3), stored(2)], beginner))).toEqual([uuid(3), uuid(2), uuid(1)]);
  });

  it("lists the reasons that applied, in order, at most three, with no score", () => {
    const [top] = rankIdeas(
      [
        stored(1, {
          pillar_name: "Mindset",
          evidence_strength: "high",
          audience_fit: "high",
          difficulty: "easy",
          evidence: [
            { kind: "research_signal", summary: "A", source: "YouTube" },
            { kind: "trend", summary: "B", source: "Trends" },
          ],
        }),
      ],
      { experience: "beginner", plannedPillars: ["Fuel"] },
    );
    expect(top.reasons).toEqual([
      "Your “Mindset” pillar has nothing planned this week",
      "High evidence: 2 signals",
      "High audience fit (AI judgment)",
    ]);
    expect(top.reasons.length).toBeLessThanOrEqual(MAX_REASONS);
    expect(Object.keys(top)).not.toContain("score");
  });

  it("gives no reason for low levels or a difficulty that doesn't fit", () => {
    const [top] = rankIdeas([stored(1, { evidence_strength: "low", audience_fit: "low", difficulty: "hard" })], {
      experience: "beginner",
      plannedPillars: ["Fuel"],
    });
    expect(top.reasons).toEqual([]);
    const [easy] = rankIdeas([stored(1, { difficulty: "easy", evidence_strength: "medium" })], beginner);
    expect(easy.reasons).toEqual(["Your “Fuel” pillar has nothing planned this week", "Medium evidence", "Easy to make"]);
  });
});
