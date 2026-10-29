import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "@/lib/research/youtube";
import {
  CREATOR_ENTERED_CAVEAT,
  FOLLOWERS_UNKNOWN_CAVEAT,
  type Breakdown,
  type BreakdownFormValues,
} from "@/lib/schemas/breakdown";
import {
  analyzeReferenceVideo,
  getBreakdownStatus,
  saveBreakdownAsIdea,
  SOURCE_TTL_MS,
  type BreakdownDeps,
} from "@/lib/services/video-breakdown";
import { fakeSupabase, pgError, type FakeResult, type RecordedQuery } from "./fake-supabase";

const USER = "user_breakdown";
const NOW = Date.parse("2026-10-29T12:00:00Z");
const ENV = { YOUTUBE_API_KEY: "AIza-test", YOUTUBE_DAILY_UNIT_BUDGET: "3000" };
const YT = "https://youtu.be/dQw4w9WgXcQ";
const TIKTOK = "https://www.tiktok.com/@someone/video/7234567890123456789";

const PRO_ROW = {
  plan: "pro",
  status: "active",
  provider: "paystack",
  current_period_end: "2099-01-01T00:00:00Z",
  cancel_at_period_end: false,
};

const blank: BreakdownFormValues = {
  url: "",
  views: "",
  likes: "",
  comments: "",
  shares: "",
  saves: "",
  followers: "",
  duration: "",
  posted_on: "",
  caption: "",
  transcript: "",
  top_comments: "",
  note: "",
  target_platform: "",
};

const modelOutput: Breakdown = {
  summary: "A short filming tip that shows the result first.",
  why_it_worked: [
    { element: "hook", observation: "Shows the final shot first.", evidence: "The description opens with the result.", confidence: "high" },
    { element: "length", observation: "Short enough to rewatch.", evidence: "Length 95 seconds.", confidence: "medium" },
  ],
  audience_reaction: null,
  your_version: {
    topic: "Film a home workout on your phone",
    angle: "Finished clip first, then the setup",
    hooks: ["Filmed in my kitchen", "No camera, just this", "Three settings I change"],
    format: "Short video",
    platform: "tiktok",
    pillar_name: "Quick workouts",
    outline: ["Result", "Setup", "One tip"],
    title: "Phone-only workout filming",
    cta: "Ask which setting to cover next",
    why_it_fits: "Your audience trains at home.",
  },
  what_not_to_copy: ["Their jokes"],
  caveats: [],
};

interface Options {
  subscription?: Record<string, unknown> | null;
  pillars?: readonly unknown[];
  recent?: FakeResult;
  monthlyCount?: number;
  pending?: number;
  budgetRows?: readonly { quantity: number }[];
  insert?: FakeResult;
}

function setup(options: Options = {}) {
  const user = fakeSupabase({
    subscriptions: { data: options.subscription === undefined ? PRO_ROW : options.subscription },
    creator_profiles: {
      data: {
        niche: "Home fitness",
        audience_description: "Busy parents",
        goals: ["grow_audience"],
        platforms: ["tiktok", "youtube"],
        posting_capacity_per_week: 3,
        experience_level: "beginner",
      },
    },
    brand_profiles: { data: null },
    creator_strategies: { data: null },
    creator_insights: { data: [] },
    content_pillars: (q: RecordedQuery) =>
      q.columns === "id"
        ? { data: { id: "pillar_1" } }
        : { data: options.pillars ?? [{ name: "Quick workouts", description: null }] },
    ai_generations: { count: options.pending ?? 0 },
    video_breakdowns: (q: RecordedQuery) => {
      if (q.op === "insert") return options.insert ?? { data: { id: "bd_new" } };
      return options.recent ?? { data: null };
    },
  });
  const admin = fakeSupabase({
    subscriptions: { data: options.subscription === undefined ? PRO_ROW : options.subscription },
    ai_generations: { data: [], count: options.monthlyCount ?? 0 },
    usage_events: (q: RecordedQuery) => {
      if (q.op === "insert") return {};
      return { data: options.budgetRows ?? [] };
    },
  });
  return { user, admin };
}

const respond = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

function youtubeFetch(videos: unknown = undefined) {
  return vi.fn<FetchLike>(async (url) => {
    if (url.includes("/videos?")) {
      return respond(
        200,
        videos ?? {
          items: [
            {
              id: "dQw4w9WgXcQ",
              snippet: {
                title: "How I film on a phone",
                description: "Here's the result first.",
                tags: ["phone"],
                channelId: "UC1",
                channelTitle: "Phone Films",
                publishedAt: "2026-10-19T12:00:00Z",
              },
              contentDetails: { duration: "PT1M35S" },
              statistics: { viewCount: "48000", likeCount: "2000", commentCount: "100" },
            },
          ],
        },
      );
    }
    if (url.includes("/channels?")) return respond(200, { items: [{ statistics: { subscriberCount: "12000" } }] });
    return respond(200, { items: [{ snippet: { topLevelComment: { snippet: { textOriginal: "Which app?" } } } }] });
  });
}

/** Runs the app validation the real service would, then answers like `runStructured`. */
function fakeRun(output: unknown = modelOutput) {
  return vi.fn<BreakdownDeps["run"]>(async (request) => {
    const validated = request.validate!(output as never);
    if (!validated.ok) return { ok: false, code: "invalid_output", message: "x", retryable: true };
    return {
      ok: true,
      data: validated.data,
      generationId: "gen_1",
      usage: { model: "m", tier: "quality", inputTokens: 1, outputTokens: 1, latencyMs: 1, costMicros: 1 },
    };
  });
}

let logs: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  logs = (["error", "warn", "info"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
});
afterEach(() => logs.forEach((spy) => spy.mockRestore()));

const deps = (run = fakeRun(), fetch: FetchLike = youtubeFetch()): BreakdownDeps => ({ run, fetch, env: ENV, now: () => NOW });
const inserted = (q: RecordedQuery[]) =>
  q.find((query) => query.table === "video_breakdowns" && query.op === "insert")?.payload as Record<string, unknown> | undefined;

describe("analyzeReferenceVideo", () => {
  it("refuses Free creators before any YouTube call or AI", async () => {
    const { user, admin } = setup({ subscription: null });
    const fetch = youtubeFetch();
    const run = fakeRun();
    const result = await analyzeReferenceVideo(user.client, admin.client, USER, { ...blank, url: YT }, {}, deps(run, fetch));
    expect(result).toMatchObject({ ok: false, code: "upgrade_required" });
    expect(fetch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("breaks down a YouTube video: 3 metered units, one AI call, YouTube data that expires", async () => {
    const { user, admin } = setup();
    const fetch = youtubeFetch();
    const run = fakeRun();
    const result = await analyzeReferenceVideo(user.client, admin.client, USER, { ...blank, url: YT, top_comments: "" }, {}, deps(run, fetch));

    expect(result).toEqual({ ok: true, breakdownId: "bd_new", reused: false });
    expect(fetch).toHaveBeenCalledTimes(3);
    const usage = admin.queries.find((q) => q.table === "usage_events" && q.op === "insert");
    expect(usage?.payload).toMatchObject({
      user_id: USER,
      event_type: "youtube_api",
      quantity: 3,
      metadata: { kind: "video_breakdown", outcome: "ok" },
    });

    const request = run.mock.calls[0][0];
    expect(request).toMatchObject({ userId: USER, kind: "video_breakdown" });
    expect(request.input).toMatchObject({ fetched: true, target_platform: "YouTube", comments: ["Which app?"] });
    expect(request.input.facts).toContainEqual({ label: "Views", value: "48,000" });

    const row = inserted(user.queries)!;
    expect(row).toMatchObject({
      user_id: USER,
      platform: "youtube",
      source_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      external_id: "dQw4w9WgXcQ",
      ai_generation_id: "gen_1",
      prompt_version: "v1",
      source_expires_at: new Date(NOW + SOURCE_TTL_MS).toISOString(),
      facts: { source: "youtube_api", views: null },
      source_data: { title: "How I film on a phone", facts: { views: 48_000, followers: 12_000, age_days: 10 } },
      creator_input: { comments: [], target_platform: "youtube" },
    });
    expect((row.breakdown as { schema_version: number }).schema_version).toBe(1);
  });

  it("reopens a breakdown of the same video from the last 24 hours, spending nothing", async () => {
    const { user, admin } = setup({ recent: { data: { id: "bd_old" } } });
    const fetch = youtubeFetch();
    const run = fakeRun();
    expect(await analyzeReferenceVideo(user.client, admin.client, USER, { ...blank, url: YT }, {}, deps(run, fetch))).toEqual({
      ok: true,
      breakdownId: "bd_old",
      reused: true,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    const reuse = user.queries.find((q) => q.table === "video_breakdowns" && q.op === "select");
    expect(reuse?.filters).toContainEqual(["eq", "external_id", "dQw4w9WgXcQ"]);
  });

  it("skips reuse when forced", async () => {
    const { user, admin } = setup({ recent: { data: { id: "bd_old" } } });
    const result = await analyzeReferenceVideo(user.client, admin.client, USER, { ...blank, url: YT }, { force: true }, deps());
    expect(result).toEqual({ ok: true, breakdownId: "bd_new", reused: false });
  });

  it.each([
    ["the monthly allowance is used", { monthlyCount: 15 }, "plan_limit"],
    ["a breakdown is running", { pending: 1 }, "in_progress"],
    ["the shared YouTube budget is spent", { budgetRows: [{ quantity: 2_999 }] }, "budget_exhausted"],
    ["there are no pillars", { pillars: [] }, "missing_context"],
  ] as const)("stops before YouTube when %s", async (_, options, code) => {
    const { user, admin } = setup(options);
    const fetch = youtubeFetch();
    const result = await analyzeReferenceVideo(user.client, admin.client, USER, { ...blank, url: YT }, {}, deps(fakeRun(), fetch));
    expect(result).toMatchObject({ ok: false, code });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("meters a lookup of an unavailable video and stores nothing", async () => {
    const { user, admin } = setup();
    const run = fakeRun();
    const result = await analyzeReferenceVideo(user.client, admin.client, USER, { ...blank, url: YT }, {}, deps(run, youtubeFetch({ items: [] })));
    expect(result).toMatchObject({ ok: false, code: "video_unavailable" });
    expect(admin.queries.find((q) => q.op === "insert")?.payload).toMatchObject({ quantity: 1, metadata: { outcome: "video_unavailable" } });
    expect(run).not.toHaveBeenCalled();
    expect(inserted(user.queries)).toBeUndefined();
  });

  it("stores nothing when the AI fails or repeats the reference title", async () => {
    const { user, admin } = setup();
    const copied = { ...modelOutput, your_version: { ...modelOutput.your_version, title: "How I film on a phone" } };
    const result = await analyzeReferenceVideo(user.client, admin.client, USER, { ...blank, url: YT }, {}, deps(fakeRun(copied)));
    expect(result).toMatchObject({ ok: false, code: "invalid_output" });
    expect(inserted(user.queries)).toBeUndefined();
  });

  it("breaks down a TikTok from the creator's numbers, with the honesty caveats", async () => {
    const { user, admin } = setup();
    const fetch = youtubeFetch();
    const run = fakeRun();
    const values = { ...blank, url: TIKTOK, views: "1.2M", likes: "80K", caption: "3 filming tips\n#fyp", top_comments: "So useful" };
    const result = await analyzeReferenceVideo(user.client, admin.client, USER, values, {}, deps(run, fetch));

    expect(result).toMatchObject({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(run.mock.calls[0][0].input).toMatchObject({
      fetched: false,
      rounded: true,
      comments: ["So useful"],
      target_platform: "TikTok",
      video: { title: "3 filming tips", description: "3 filming tips\n#fyp" },
    });
    const row = inserted(user.queries)!;
    expect(row).toMatchObject({
      platform: "tiktok",
      source_data: null,
      source_expires_at: null,
      facts: { source: "creator_entered", views: 1_200_000, rounded: true },
      creator_input: { comments: [] },
    });
    const caveats = (row.breakdown as { caveats: string[] }).caveats;
    expect(caveats).toContain(CREATOR_ENTERED_CAVEAT);
    expect(caveats).toContain(FOLLOWERS_UNKNOWN_CAVEAT);
  });

  it("returns field errors without touching the database", async () => {
    const { user, admin } = setup();
    const result = await analyzeReferenceVideo(user.client, admin.client, USER, { ...blank, url: TIKTOK }, {}, deps());
    expect(result).toMatchObject({ ok: false, code: "invalid_input", fieldErrors: { views: expect.any(String) } });
    expect(user.queries).toHaveLength(0);
    expect(admin.queries).toHaveLength(0);
  });

  it("refuses a target platform the creator doesn't use", async () => {
    const { user, admin } = setup();
    const result = await analyzeReferenceVideo(user.client, admin.client, USER, { ...blank, url: YT, target_platform: "linkedin" }, {}, deps());
    expect(result).toMatchObject({ ok: false, code: "invalid_input", fieldErrors: { target_platform: expect.any(String) } });
  });

  it("reports a failed insert", async () => {
    const { user, admin } = setup({ insert: { error: pgError() } });
    expect(await analyzeReferenceVideo(user.client, admin.client, USER, { ...blank, url: YT }, {}, deps())).toMatchObject({
      ok: false,
      code: "persistence_error",
    });
  });
});

describe("getBreakdownStatus", () => {
  it("shows the locked state on Free and the allowance on Pro", async () => {
    expect(await getBreakdownStatus(setup({ subscription: null }).user.client, USER, { env: ENV, now: () => NOW })).toEqual({
      state: "plan_required",
    });
    const pro = fakeSupabase({
      subscriptions: { data: PRO_ROW },
      creator_profiles: { data: { platforms: ["tiktok"], niche: "x" } },
      content_pillars: { data: [{ name: "A", description: null }] },
      ai_generations: { count: 4 },
    });
    expect(await getBreakdownStatus(pro.client, USER, { env: ENV, now: () => NOW })).toEqual({
      state: "available",
      used: 4,
      limit: 15,
      platforms: ["tiktok"],
      youtubeConfigured: true,
    });
  });
});

describe("saveBreakdownAsIdea", () => {
  const BREAKDOWN_ID = "11111111-1111-4111-8111-111111111111";
  const row = {
    id: BREAKDOWN_ID,
    created_at: "2026-10-29T12:00:00Z",
    platform: "tiktok",
    source_url: TIKTOK,
    source_data: null,
    source_fetched_at: null,
    creator_input: {},
    facts: {
      source: "creator_entered",
      views: 1000,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      followers: null,
      duration_seconds: null,
      published_at: null,
      age_days: null,
      views_per_day: null,
      engagement_rate: null,
      views_to_followers: null,
      rounded: false,
      title: "3 filming tips",
      author: null,
    },
    ai_generation_id: "gen_1",
    breakdown: { schema_version: 1, confidence_capped: false, ...modelOutput },
  };

  function ideaClient(existing: unknown) {
    return fakeSupabase({
      video_breakdowns: { data: row },
      content_pillars: { data: { id: "pillar_1" } },
      content_ideas: (q: RecordedQuery) => (q.op === "insert" ? { data: { id: "idea_new" } } : { data: existing }),
    });
  }

  it("saves the version as an idea with competitor evidence linking to the source", async () => {
    const { client, queries } = ideaClient(null);
    expect(await saveBreakdownAsIdea(client, USER, BREAKDOWN_ID)).toEqual({ ok: true, ideaId: "idea_new" });
    const insert = queries.find((q) => q.table === "content_ideas" && q.op === "insert");
    expect(insert?.payload).toMatchObject({
      user_id: USER,
      topic: "Film a home workout on your phone",
      hook: "Filmed in my kitchen",
      platform: "tiktok",
      pillar_id: "pillar_1",
      status: "saved",
      source: "ai",
      ai_generation_id: "gen_1",
      evidence: [{ kind: "competitor", source: "TikTok", source_url: TIKTOK, summary: expect.stringContaining("“3 filming tips”") }],
    });
  });

  it("is idempotent", async () => {
    const { client, queries } = ideaClient({ id: "idea_old" });
    expect(await saveBreakdownAsIdea(client, USER, BREAKDOWN_ID)).toEqual({ ok: true, ideaId: "idea_old" });
    expect(queries.some((q) => q.op === "insert")).toBe(false);
  });

  it("returns not_found for a bad id", async () => {
    const { client } = ideaClient(null);
    expect(await saveBreakdownAsIdea(client, USER, "nope")).toMatchObject({ ok: false, code: "not_found" });
  });
});
