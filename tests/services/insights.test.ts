import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_ERRORS } from "@/lib/ai/errors";
import type { AiResult } from "@/lib/ai/run-structured";
import { toStoredDiagnosis } from "@/lib/schemas/diagnosis";
import { INSIGHT_ERRORS, type InsightsOutput } from "@/lib/schemas/insights";
import {
  getInsightsOverview,
  POSTS_LIMIT,
  setInsightStatus,
  UPDATE_LIMIT,
  updateCreatorInsights,
  type InsightsDeps,
} from "@/lib/services/insights";
import { validDiagnosis } from "../schemas/diagnosis-fixture";
import { fakeSupabase, pgError, type FakeResult, type RecordedQuery } from "./fake-supabase";

const USER_ID = "user_insights";
const GENERATION_ID = "11111111-1111-4111-8111-111111111111";
const INSIGHT_ID = "6f1c1f9e-4d0a-4b8e-9a37-0d1f7e2b9c11";
const TZ = "Africa/Lagos"; // UTC+1
const NOW = Date.parse("2026-10-16T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();
const postId = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

let n = 0;
const checkIn = (captured: string, views: number) => ({
  id: `snap-${++n}`,
  captured_at: captured,
  views,
  likes: 10,
  comments: null,
  shares: null,
  saves: null,
  follower_delta: null,
  avg_view_duration_seconds: null,
  retention_rate: null,
});

/** `settled` YouTube posts with week-old results (newest first), then one early post. */
function postRows(settled: number) {
  return [
    {
      id: "early-1",
      title: "Early post",
      platform: "youtube",
      format: "short",
      published_at: daysAgo(2),
      idea_id: null,
      pillar: null,
      analytics_snapshots: [checkIn(daysAgo(1), 50)],
    },
    ...Array.from({ length: settled }, (_, i) => ({
      id: postId(i),
      title: `Post ${i}`,
      platform: "youtube",
      format: i % 2 ? "tutorial" : "short",
      published_at: daysAgo(20 + i),
      idea_id: i === 0 ? "idea-1" : null,
      pillar: { name: "Quick workouts" },
      analytics_snapshots: [checkIn(daysAgo(10 + i), 1000 + i * 100)],
    })),
  ];
}

interface Options {
  settled?: number;
  profile?: unknown;
  succeeded?: number;
  pending?: number;
  lastUpdate?: { id: string; created_at: string } | null;
  insights?: unknown[];
  insightsError?: FakeResult["error"];
  updated?: unknown[];
  rpc?: FakeResult;
}

const profileRow = {
  niche: "Home fitness",
  audience_description: "Busy parents",
  goals: [],
  platforms: ["youtube"],
  posting_capacity_per_week: 3,
  experience_level: "beginner",
};

const has = (query: RecordedQuery, ...filter: unknown[]) =>
  query.filters.some((f) => JSON.stringify(f) === JSON.stringify(filter));

function setup(options: Options = {}) {
  const rows = postRows(options.settled ?? 7);
  return fakeSupabase(
    {
      content_items: (query): FakeResult => {
        if (query.columns?.startsWith("id, hook_used")) {
          return { data: rows.map((row) => ({ id: row.id, hook_used: `Hook of ${row.title}`, duration_seconds: 40 })) };
        }
        return { data: rows };
      },
      creator_profiles: { data: options.profile === undefined ? profileRow : options.profile },
      content_pillars: { data: [{ name: "Quick workouts", description: null }] },
      creator_strategies: { data: null },
      ai_generations: (query): FakeResult => {
        if (query.columns === "id, created_at") return { data: options.lastUpdate ?? null };
        if (has(query, "eq", "status", "pending")) return { count: options.pending ?? 0 };
        return { count: options.succeeded ?? 0 };
      },
      content_diagnoses: {
        data: [
          { content_item_id: postId(0), diagnosis: toStoredDiagnosis(validDiagnosis, false) },
          { content_item_id: postId(0), diagnosis: toStoredDiagnosis({ ...validDiagnosis, headline: "Older" }, false) },
          { content_item_id: "not-sent", diagnosis: toStoredDiagnosis(validDiagnosis, false) },
          { content_item_id: postId(1), diagnosis: { schema_version: 99 } },
        ],
      },
      creator_insights: (query): FakeResult => {
        if (query.op === "update") return { data: options.updated ?? [{ id: INSIGHT_ID }] };
        return {
          data: options.insights ?? [
            { insight_type: "hook", summary: "Questions work", confidence: "low", sample_size: 2, status: "active" },
            { insight_type: "other", summary: "Post on Mondays", confidence: "low", sample_size: 2, status: "dismissed" },
          ],
          error: options.insightsError ?? null,
        };
      },
    },
    () => options.rpc ?? { data: 1 },
  );
}

const modelOutput = (overrides: Partial<InsightsOutput> = {}): InsightsOutput => ({
  insights: [
    {
      insight_type: "format",
      summary: "Your tutorials get more views than your shorts.",
      next_step: "Make your next post a tutorial.",
      metric: "views",
      supporting_posts: ["P2", "P4", "P6"],
      confidence: "high",
    },
    {
      insight_type: "hook",
      summary: "One post with a question hook did well.",
      next_step: "Try another question hook.",
      metric: "views",
      supporting_posts: ["P1"],
      confidence: "medium",
    },
  ],
  notes: ["Most posts are on YouTube."],
  ...overrides,
});

const succeed = (output: InsightsOutput = modelOutput()) =>
  vi.fn<InsightsDeps["run"]>(
    async (): Promise<AiResult<InsightsOutput>> => ({
      ok: true,
      data: output,
      generationId: GENERATION_ID,
      usage: { model: "m", tier: "quality", inputTokens: 1, outputTokens: 1, latencyMs: 1, costMicros: 1 },
    }),
  );

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

describe("updateCreatorInsights", () => {
  it("sends settled posts by ref with their comparisons, diagnoses and insights, then replaces the set", async () => {
    const { client, queries, rpcCalls } = setup();
    const run = succeed();
    const result = await updateCreatorInsights(client, USER_ID, TZ, { run, now: () => NOW });
    expect(result).toEqual({ ok: true, count: 1, notes: ["Most posts are on YouTube."] });

    const request = run.mock.calls[0][0];
    expect(request).toMatchObject({ userId: USER_ID, kind: "creator_insights" });
    const { input } = request;
    expect(input.posts.map((p) => p.ref)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
    expect(input.posts[0]).toMatchObject({
      title: "Post 0",
      platform: "youtube",
      pillar: "Quick workouts",
      hook_used: "Hook of Post 0",
      duration_seconds: 40,
      from_studio: true,
    });
    expect(input.posts[0].posted).toMatch(/^\w+day, around \d\d:00$/);
    expect(input.posts[0].metrics[0]).toMatchObject({ name: "Views", value: "1,000" });
    expect(input.posts[0].metrics[0].usual).not.toBeNull();
    expect(input.posts.map((p) => p.title)).not.toContain("Early post");
    // Only the latest readable diagnosis of a post that was sent.
    expect(input.diagnoses).toEqual([expect.objectContaining({ ref: "P1", headline: validDiagnosis.headline })]);
    expect(input.currentInsights).toEqual([
      { insight_type: "hook", summary: "Questions work", confidence: "low", sample_size: 2 },
    ]);
    expect(input.dismissed).toEqual(["Post on Mondays"]);
    expect(input.context).toContain("Niche: Home fitness");
    expect(JSON.stringify(input)).not.toMatch(/00000000-0000|https?:|user_insights/);
    // The context reads profile, pillars and strategy only.
    expect(queries.some((q) => q.table === "brand_profiles")).toBe(false);

    expect(rpcCalls).toHaveLength(1);
    const { name, args } = rpcCalls[0] as { name: string; args: { p_generation_id: string; p_insights: unknown[] } };
    expect(name).toBe("replace_creator_insights");
    expect(args.p_generation_id).toBe(GENERATION_ID);
    // The single-post insight is dropped; three posts cap confidence at medium.
    expect(args.p_insights).toEqual([
      {
        insight_type: "format",
        summary: "Your tutorials get more views than your shorts.",
        next_step: "Make your next post a tutorial.",
        confidence: "medium",
        sample_size: 3,
        evidence: [postId(1), postId(3), postId(5)].map((id) => expect.objectContaining({ content_item_id: id, metric: "views" })),
      },
    ]);
  });

  it("sends at most 30 settled posts", async () => {
    const { client } = setup({ settled: 35 });
    const run = succeed(modelOutput({ insights: [] }));
    await updateCreatorInsights(client, USER_ID, null, { run, now: () => NOW });
    const { posts } = run.mock.calls[0][0].input;
    expect(posts).toHaveLength(POSTS_LIMIT);
    expect(posts[0].posted).toBeNull();
  });

  it("replaces the set even when no insight survives", async () => {
    const { client, rpcCalls } = setup();
    const result = await updateCreatorInsights(client, USER_ID, TZ, { run: succeed(modelOutput({ insights: [] })), now: () => NOW });
    expect(result).toEqual({ ok: true, count: 0, notes: ["Most posts are on YouTube."] });
    expect(rpcCalls).toEqual([{ name: "replace_creator_insights", args: { p_generation_id: GENERATION_ID, p_insights: [] } }]);
  });

  it.each([
    ["not_enough_data", { settled: 4 }],
    ["missing_context", { profile: null }],
    ["update_limit", { succeeded: UPDATE_LIMIT }],
    ["in_progress", { pending: 1 }],
    ["persistence_error", { insightsError: pgError() }],
  ] as const)("returns %s without calling AI or writing", async (code, options) => {
    const { client, rpcCalls } = setup(options);
    const run = succeed();
    await expect(updateCreatorInsights(client, USER_ID, TZ, { run, now: () => NOW })).resolves.toEqual({
      ok: false,
      code,
      ...INSIGHT_ERRORS[code],
    });
    expect(run).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([]);
  });

  it("counts only successful updates in the last 24 hours", async () => {
    const { client, queries } = setup();
    await updateCreatorInsights(client, USER_ID, TZ, { run: succeed(), now: () => NOW });
    const cap = queries.find((q) => q.table === "ai_generations" && has(q, "eq", "status", "succeeded"));
    expect(cap?.filters).toContainEqual(["eq", "kind", "creator_insights"]);
    expect(cap?.filters).toContainEqual(["gte", "created_at", daysAgo(1)]);
  });

  it("passes AI failures through and writes nothing", async () => {
    const { client, rpcCalls } = setup();
    const run = vi.fn<InsightsDeps["run"]>(async () => ({ ok: false as const, code: "rate_limited" as const, ...AI_ERRORS.rate_limited }));
    await expect(updateCreatorInsights(client, USER_ID, TZ, { run, now: () => NOW })).resolves.toMatchObject({
      ok: false,
      code: "rate_limited",
      retryable: true,
    });
    expect(rpcCalls).toEqual([]);
  });

  it("returns persistence_error when the replace fails, logging only the code", async () => {
    const { client } = setup({ rpc: { error: pgError("22023", `invalid_insights for ${USER_ID}`) } });
    await expect(updateCreatorInsights(client, USER_ID, TZ, { run: succeed(), now: () => NOW })).resolves.toMatchObject({
      ok: false,
      code: "persistence_error",
    });
    const logged = errorLog.mock.calls.flat().join(" ");
    expect(logged).toContain("creator_insights_failed");
    expect(logged).not.toContain(USER_ID);
  });

  it("never throws", async () => {
    const { client } = fakeSupabase({ creator_profiles: new TypeError("fetch failed"), content_pillars: { data: [] }, creator_strategies: { data: null } });
    await expect(updateCreatorInsights(client, USER_ID, TZ, { run: succeed() })).resolves.toMatchObject({
      ok: false,
      code: "persistence_error",
    });
  });
});

describe("getInsightsOverview", () => {
  const stored = (id: string, confidence: string, sample: number) => ({
    id,
    insight_type: "hook",
    summary: `Insight ${id}`,
    next_step: "Do it",
    evidence: [],
    confidence,
    sample_size: sample,
    ai_generation_id: GENERATION_ID,
    created_at: daysAgo(3),
  });

  it("orders active insights and reports readiness, updates left and new results", async () => {
    const { client, queries } = setup({
      insights: [stored("a", "low", 2), stored("b", "high", 5), { bad: true }, stored("c", "medium", 3)],
      lastUpdate: { id: GENERATION_ID, created_at: daysAgo(12) },
      succeeded: 1,
    });
    const result = await getInsightsOverview(client, USER_ID, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { overview } = result;
    expect(overview.insights.map((i) => i.id)).toEqual(["b", "c", "a"]);
    expect(overview).toMatchObject({
      settled: 7,
      needed: 5,
      lastUpdatedAt: daysAgo(12),
      latestGenerationId: GENERATION_ID,
      newResults: true,
      updatesUsed: 1,
      updatesLimit: UPDATE_LIMIT,
    });
    expect(overview.livePostIds).toContain(postId(0));
    expect(queries.find((q) => q.table === "creator_insights")?.filters).toContainEqual(["eq", "status", "active"]);
  });

  it("reports no new results when nothing settled came in after the last update", async () => {
    const { client } = setup({ insights: [], lastUpdate: { id: GENERATION_ID, created_at: daysAgo(0.5) } });
    const result = await getInsightsOverview(client, USER_ID, NOW);
    expect(result.ok && result.overview.newResults).toBe(false);
  });

  it("returns ok:false on a read error", async () => {
    const { client } = setup({ insightsError: pgError() });
    await expect(getInsightsOverview(client, USER_ID, NOW)).resolves.toEqual({ ok: false });
  });
});

describe("setInsightStatus", () => {
  it("dismisses only an active insight of this creator", async () => {
    const { client, queries } = setup();
    await expect(setInsightStatus(client, USER_ID, INSIGHT_ID, "dismissed")).resolves.toEqual({ ok: true });
    const update = queries.find((q) => q.op === "update");
    expect(update?.payload).toEqual({ status: "dismissed" });
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        ["eq", "id", INSIGHT_ID],
        ["eq", "user_id", USER_ID],
        ["eq", "status", "active"],
      ]),
    );
  });

  it("restores only a dismissed insight from the latest update", async () => {
    const { client, queries } = setup({ lastUpdate: { id: GENERATION_ID, created_at: daysAgo(1) } });
    await expect(setInsightStatus(client, USER_ID, INSIGHT_ID, "active")).resolves.toEqual({ ok: true });
    const update = queries.find((q) => q.op === "update");
    expect(update?.filters).toEqual(
      expect.arrayContaining([
        ["eq", "status", "dismissed"],
        ["eq", "ai_generation_id", GENERATION_ID],
      ]),
    );
  });

  it("returns not_found when nothing matched, there's no update yet, or the id is invalid", async () => {
    await expect(setInsightStatus(setup({ updated: [] }).client, USER_ID, INSIGHT_ID, "dismissed")).resolves.toMatchObject({
      code: "not_found",
    });
    await expect(setInsightStatus(setup({ lastUpdate: null }).client, USER_ID, INSIGHT_ID, "active")).resolves.toMatchObject({
      code: "not_found",
    });
    const { client, queries } = setup();
    await expect(setInsightStatus(client, USER_ID, "nope", "dismissed")).resolves.toMatchObject({ code: "not_found" });
    expect(queries).toEqual([]);
  });
});
