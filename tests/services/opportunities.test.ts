import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_ERRORS, type AiErrorCode } from "@/lib/ai/errors";
import type { AiResult } from "@/lib/ai/run-structured";
import type { OpportunityModelOutput, OpportunityOutput } from "@/lib/schemas/opportunities";
import {
  BACKLOG_LIMIT,
  generateContentOpportunities,
  listOpportunities,
  OPPORTUNITY_ERRORS,
  updateOpportunityStatus,
  type OpportunityDeps,
} from "@/lib/services/opportunities";
import { FIXTURE_PILLARS, validBatch, validIdea } from "../schemas/opportunity-fixture";
import { fakeSupabase, pgError, type FakeResult, type RecordedQuery } from "./fake-supabase";

const USER_ID = "user_opportunities";
const NOW = Date.parse("2026-10-12T12:00:00Z");
const IDEA_ID = "6f1c1f9e-4d0a-4b8e-9a37-0d1f7e2b9c11";

const profileRow = {
  niche: "Home fitness",
  audience_description: "Busy parents",
  goals: ["grow_audience"],
  platforms: ["youtube", "tiktok"],
  posting_capacity_per_week: 3,
  experience_level: "beginner",
};
const brandRow = { tone: "warm", voice_traits: [], do_list: [], dont_list: ["No shaming"], sample_text: null };
const strategyRow = { positioning: "Helps busy parents train at home", growth_objective: "g", monetization_objective: "m", version: 1 };
const pillarRows = FIXTURE_PILLARS.map((name, index) => ({ id: `pillar_${index}`, name, description: `${name} desc` }));
const snapshot = {
  platform: "youtube",
  captured_at: "2026-10-01T00:00:00Z",
  views: 100,
  likes: 5,
  comments: 1,
  shares: 0,
  saves: 2,
  follower_delta: 3,
};

interface Options {
  profile?: unknown;
  strategy?: unknown;
  pillars?: unknown[];
  performance?: unknown[];
  backlog?: number;
  backlogError?: FakeResult["error"];
  pendingCount?: number;
  existing?: { topic: string; status: string }[];
  insert?: FakeResult;
  signals?: unknown[];
  signalsError?: FakeResult["error"];
}

function setup(options: Options = {}) {
  const ideas = (query: RecordedQuery): FakeResult => {
    if (query.op === "insert") return options.insert ?? {};
    if (query.columns === "topic, status") return { data: options.existing ?? [] };
    return { count: options.backlog ?? 0, error: options.backlogError ?? null };
  };
  return fakeSupabase({
    creator_profiles: { data: options.profile === undefined ? profileRow : options.profile },
    brand_profiles: { data: brandRow },
    content_pillars: { data: options.pillars ?? pillarRows },
    creator_strategies: { data: options.strategy === undefined ? strategyRow : options.strategy },
    content_items: { data: [] },
    analytics_snapshots: { data: options.performance ?? [] },
    creator_insights: { data: [] },
    content_ideas: ideas,
    ai_generations: { count: options.pendingCount ?? 0 },
    research_signals: { data: options.signals ?? [], error: options.signalsError ?? null },
  });
}

const manualSignal = (id: string, type: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  source: "manual",
  signal_type: type,
  title: null,
  source_url: null,
  payload: { text, label: null },
  fetched_at: "2026-10-10T00:00:00+00:00",
  expires_at: null,
  created_at: "2026-10-10T00:00:00+00:00",
  ...extra,
});
const videoSignal = (id: string) => ({
  id,
  source: "youtube",
  signal_type: "video",
  title: "10 Minute Workout for Busy Parents",
  source_url: `https://www.youtube.com/watch?v=${id}`,
  payload: {
    video_id: id,
    channel_title: "Example Fit",
    published_at: "2026-09-30T00:00:00Z",
    view_count: 48210,
    like_count: null,
    comment_count: null,
    query: "home fitness quick workouts",
  },
  fetched_at: "2026-10-11T00:00:00+00:00",
  expires_at: "2026-10-18T00:00:00+00:00",
  created_at: "2026-10-11T00:00:00+00:00",
});

/** Returns `batch` through the request's validator, as `runStructured` does. */
const succeed = (batch: OpportunityModelOutput = validBatch()): OpportunityDeps["run"] =>
  vi.fn(async (request): Promise<AiResult<OpportunityOutput>> => {
    const validated = request.validate!(batch);
    if (!validated.ok) return { ok: false, code: "invalid_output", ...AI_ERRORS.invalid_output };
    return {
      ok: true,
      data: validated.data,
      generationId: "gen_1",
      usage: { model: "m", tier: "quality", inputTokens: 1, outputTokens: 1, latencyMs: 1, costMicros: 1 },
    };
  });

const failWith = (code: AiErrorCode): OpportunityDeps["run"] =>
  vi.fn(async () => ({ ok: false as const, code, ...AI_ERRORS[code] }));

const insertOf = (queries: RecordedQuery[]) => queries.filter((q) => q.table === "content_ideas" && q.op === "insert");

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

describe("generateContentOpportunities", () => {
  it("generates from full creator context and stores the batch in one insert", async () => {
    const { client, queries } = setup({ existing: [{ topic: "Old idea", status: "saved" }] });
    const run = succeed();

    await expect(generateContentOpportunities(client, USER_ID, { run, now: () => NOW })).resolves.toEqual({
      ok: true,
      created: 5,
    });

    const request = vi.mocked(run).mock.calls[0][0];
    expect(request).toMatchObject({ userId: USER_ID, kind: "content_opportunities" });
    expect(request.input.platforms).toEqual(["youtube", "tiktok"]);
    expect(request.input.allowedEvidenceKinds).toEqual(["creator_input"]);
    expect(request.input.previousTopics).toEqual(["Old idea"]);
    expect(request.input.context).toContain("Positioning: Helps busy parents train at home");
    expect(request.input.context).toContain("Quick workouts");
    expect(request.input.context).not.toContain(USER_ID);

    const inserts = insertOf(queries);
    expect(inserts).toHaveLength(1);
    const rows = inserts[0].payload as Record<string, unknown>[];
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({
      user_id: USER_ID,
      pillar_id: "pillar_0",
      topic: "Idea number 0",
      audience_need: expect.any(String),
      angle: expect.any(String),
      hook: expect.any(String),
      format: "60-second tutorial",
      platform: "youtube",
      rationale: expect.any(String),
      cta: expect.any(String),
      difficulty: "easy",
      audience_fit: "high",
      evidence: [{ kind: "creator_input", summary: expect.any(String) }],
      evidence_strength: "low",
      trend_signal: null,
      content_gap: null,
      source: "ai",
      status: "new",
      ai_generation_id: "gen_1",
    });
    expect(rows.map((r) => r.pillar_id)).toEqual(["pillar_0", "pillar_1", "pillar_2", "pillar_0", "pillar_1"]);
  });

  it("maps pillar names case-insensitively", async () => {
    const batch = validBatch();
    batch.opportunities[0] = validIdea(0, { pillar_name: "QUICK workouts" });
    const { client, queries } = setup();
    await generateContentOpportunities(client, USER_ID, { run: succeed(batch) });
    expect((insertOf(queries)[0].payload as { pillar_id: string }[])[0].pillar_id).toBe("pillar_0");
  });

  it("allows creator_history evidence only when analytics exist, and rates it medium", async () => {
    const batch = validBatch();
    batch.opportunities[0] = validIdea(0, {
      evidence: [{ kind: "creator_history", summary: "Your quick-workout short had your most saves.", signal_ref: null }],
    });
    const { client, queries } = setup({ performance: [snapshot] });
    const run = succeed(batch);

    await expect(generateContentOpportunities(client, USER_ID, { run })).resolves.toMatchObject({ ok: true });
    expect(vi.mocked(run).mock.calls[0][0].input.allowedEvidenceKinds).toEqual(["creator_input", "creator_history"]);
    const rows = insertOf(queries)[0].payload as { evidence_strength: string }[];
    expect(rows.map((r) => r.evidence_strength)).toEqual(["medium", "low", "low", "low", "low"]);
  });

  it("rejects creator_history evidence without analytics and stores nothing", async () => {
    const batch = validBatch();
    batch.opportunities[0] = validIdea(0, { evidence: [{ kind: "creator_history", summary: "Made up.", signal_ref: null }] });
    const { client, queries } = setup();
    await expect(generateContentOpportunities(client, USER_ID, { run: succeed(batch) })).resolves.toMatchObject({
      ok: false,
      code: "invalid_output",
    });
    expect(insertOf(queries)).toEqual([]);
  });

  it("drops ideas that repeat an existing topic and stores the rest", async () => {
    const { client, queries } = setup({
      existing: [
        { topic: "idea   NUMBER 1", status: "new" },
        { topic: "Idea number 3", status: "dismissed" },
      ],
    });
    const run = succeed();
    await expect(generateContentOpportunities(client, USER_ID, { run })).resolves.toEqual({ ok: true, created: 3 });
    const rows = insertOf(queries)[0].payload as { topic: string }[];
    expect(rows.map((r) => r.topic)).toEqual(["Idea number 0", "Idea number 2", "Idea number 4"]);

    const input = vi.mocked(run).mock.calls[0][0].input;
    expect(input.previousTopics).toEqual(["idea   NUMBER 1"]);
    expect(input.dismissedTopics).toEqual(["Idea number 3"]);
  });

  it("returns invalid_output and stores nothing when every idea is a duplicate", async () => {
    const existing = validBatch().opportunities.map((idea) => ({ topic: idea.topic, status: "saved" }));
    const { client, queries } = setup({ existing });
    await expect(generateContentOpportunities(client, USER_ID, { run: succeed() })).resolves.toMatchObject({
      ok: false,
      code: "invalid_output",
      retryable: true,
    });
    expect(insertOf(queries)).toEqual([]);
  });

  it.each([
    ["no profile", { profile: null }],
    ["no strategy", { strategy: null }],
    ["no active pillars", { pillars: [] }],
    ["no supported platform", { profile: { ...profileRow, platforms: ["myspace"] } }],
  ])("returns missing_context with %s, without calling the AI", async (_label, options) => {
    const { client } = setup(options);
    const run = succeed();
    await expect(generateContentOpportunities(client, USER_ID, { run })).resolves.toMatchObject({
      ok: false,
      code: "missing_context",
      retryable: false,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it(`refuses with ${BACKLOG_LIMIT} untriaged ideas, without calling the AI`, async () => {
    const { client, queries } = setup({ backlog: BACKLOG_LIMIT });
    const run = succeed();
    await expect(generateContentOpportunities(client, USER_ID, { run })).resolves.toMatchObject({
      ok: false,
      code: "backlog_full",
      message: OPPORTUNITY_ERRORS.backlog_full.message,
    });
    expect(run).not.toHaveBeenCalled();
    const check = queries.find((q) => q.table === "content_ideas" && q.op === "select")!;
    expect(check.filters).toEqual(expect.arrayContaining([["eq", "user_id", USER_ID], ["eq", "status", "new"]]));
  });

  it("allows generation just under the backlog cap", async () => {
    const { client } = setup({ backlog: BACKLOG_LIMIT - 1 });
    await expect(generateContentOpportunities(client, USER_ID, { run: succeed() })).resolves.toMatchObject({ ok: true });
  });

  it("refuses a second generation while one is pending in the last 2 minutes", async () => {
    const { client, queries } = setup({ pendingCount: 1 });
    const run = succeed();
    await expect(generateContentOpportunities(client, USER_ID, { run, now: () => NOW })).resolves.toMatchObject({
      ok: false,
      code: "in_progress",
    });
    expect(run).not.toHaveBeenCalled();
    expect(queries.find((q) => q.table === "ai_generations")!.filters).toEqual(
      expect.arrayContaining([
        ["eq", "user_id", USER_ID],
        ["eq", "kind", "content_opportunities"],
        ["eq", "status", "pending"],
        ["gte", "created_at", "2026-10-12T11:58:00.000Z"],
      ]),
    );
  });

  it("fails closed when the backlog check errors", async () => {
    const { client } = setup({ backlogError: pgError() });
    const run = succeed();
    await expect(generateContentOpportunities(client, USER_ID, { run })).resolves.toMatchObject({
      ok: false,
      code: "persistence_error",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it.each(Object.keys(AI_ERRORS) as AiErrorCode[])("maps AI failure %s to a message and stores nothing", async (code) => {
    const { client, queries } = setup();
    const result = await generateContentOpportunities(client, USER_ID, { run: failWith(code) });
    expect(result).toEqual({ ok: false, code, ...OPPORTUNITY_ERRORS[code] });
    expect(insertOf(queries)).toEqual([]);
  });

  it("surfaces an insert failure as a retryable persistence_error", async () => {
    const { client } = setup({ insert: { error: pgError("23503") } });
    await expect(generateContentOpportunities(client, USER_ID, { run: succeed() })).resolves.toMatchObject({
      ok: false,
      code: "persistence_error",
      retryable: true,
    });
    expect(errorLog.mock.calls.flat().join(" ")).toContain("opportunity_save_failed");
  });

  it("logs no creator text or ids", async () => {
    const { client } = setup({ insert: { error: pgError("XX000", `failed for ${USER_ID}`) } });
    await generateContentOpportunities(client, USER_ID, { run: succeed() });
    const logged = errorLog.mock.calls.flat().join(" ");
    expect(logged).not.toContain(USER_ID);
    expect(logged).not.toContain("Idea number");
  });
});

describe("listOpportunities", () => {
  const row = {
    id: IDEA_ID,
    topic: "Idea",
    audience_need: "need",
    angle: "angle",
    hook: "hook",
    format: "short",
    platform: "youtube",
    rationale: "why",
    cta: "cta",
    difficulty: "easy",
    audience_fit: "high",
    evidence_strength: "low",
    evidence: [{ kind: "creator_input", summary: "From you." }],
    status: "new",
    created_at: "2026-10-12T00:00:00Z",
    pillar: { name: "Quick workouts" },
  };

  function listSetup(rows: unknown[], counts: Record<string, number> = { new: 1, saved: 2, dismissed: 3 }) {
    return fakeSupabase({
      content_ideas: (query) => {
        if (query.options) {
          const status = query.filters.find(([method, column]) => method === "eq" && column === "status")![2] as string;
          return { count: counts[status] };
        }
        return { data: rows };
      },
      creator_strategies: { count: 1 },
      content_pillars: { count: 3 },
    });
  }

  it("returns the view's rows with pillar names, counts and strategy state", async () => {
    const { client, queries } = listSetup([row]);
    const result = await listOpportunities(client, USER_ID, "saved");
    expect(result).toEqual({
      ok: true,
      hasStrategy: true,
      counts: { new: 1, saved: 2, dismissed: 3 },
      items: [{ ...Object.fromEntries(Object.entries(row).filter(([k]) => k !== "pillar")), pillar_name: "Quick workouts" }],
    });
    const list = queries.find((q) => q.table === "content_ideas" && !q.options)!;
    expect(list.filters).toEqual(
      expect.arrayContaining([
        ["eq", "user_id", USER_ID],
        ["eq", "status", "saved"],
        ["order", "created_at", { ascending: false }],
        ["limit", 50],
      ]),
    );
  });

  it("skips rows whose evidence no longer validates, without failing the page", async () => {
    const bad = { ...row, id: "other", evidence: [{ kind: "made_up", summary: "x" }] };
    const { client } = listSetup([bad, row]);
    const result = await listOpportunities(client, USER_ID, "new");
    expect(result.ok && result.items.map((item) => item.id)).toEqual([IDEA_ID]);
    expect(warnLog.mock.calls.flat().join(" ")).toContain("opportunity_read_skipped");
  });

  it("reports no strategy when there are no active pillars", async () => {
    const { client } = fakeSupabase({
      content_ideas: (query) => (query.options ? { count: 0 } : { data: [] }),
      creator_strategies: { count: 1 },
      content_pillars: { count: 0 },
    });
    await expect(listOpportunities(client, USER_ID, "new")).resolves.toMatchObject({ ok: true, hasStrategy: false });
  });

  it("returns ok: false on a read error", async () => {
    const { client } = fakeSupabase({
      content_ideas: { error: pgError() },
      creator_strategies: { count: 1 },
      content_pillars: { count: 1 },
    });
    await expect(listOpportunities(client, USER_ID, "new")).resolves.toEqual({ ok: false });
  });
});

describe("updateOpportunityStatus", () => {
  function statusSetup(current: unknown, update: FakeResult = {}) {
    return fakeSupabase({
      content_ideas: (query) => (query.op === "update" ? update : { data: current }),
    });
  }

  it("moves an idea along an allowed transition, scoped to the creator", async () => {
    const { client, queries } = statusSetup({ status: "new" });
    await expect(updateOpportunityStatus(client, USER_ID, IDEA_ID, "saved")).resolves.toEqual({ ok: true });
    const update = queries.find((q) => q.op === "update")!;
    expect(update.payload).toEqual({ status: "saved" });
    expect(update.filters).toEqual([
      ["eq", "id", IDEA_ID],
      ["eq", "user_id", USER_ID],
    ]);
  });

  it("returns not_found for a missing (or another creator's) idea", async () => {
    const { client, queries } = statusSetup(null);
    await expect(updateOpportunityStatus(client, USER_ID, IDEA_ID, "saved")).resolves.toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(queries.some((q) => q.op === "update")).toBe(false);
  });

  it.each([
    ["dismissed", "saved"],
    ["new", "planned"],
    ["planned", "new"],
    ["unknown_status", "new"],
  ] as const)("rejects %s -> %s without writing", async (from, to) => {
    const { client, queries } = statusSetup({ status: from });
    await expect(updateOpportunityStatus(client, USER_ID, IDEA_ID, to)).resolves.toMatchObject({
      ok: false,
      code: "invalid_transition",
    });
    expect(queries.some((q) => q.op === "update")).toBe(false);
  });

  it("returns db_error when the update fails", async () => {
    const { client } = statusSetup({ status: "saved" }, { error: pgError() });
    await expect(updateOpportunityStatus(client, USER_ID, IDEA_ID, "dismissed")).resolves.toMatchObject({
      ok: false,
      code: "db_error",
    });
  });
});

describe("generateContentOpportunities with research signals", () => {
  // Newest first, as the list query orders them: video (S1), comment (S2), note (S3).
  const signals = [
    videoSignal("vid12345678"),
    manualSignal("sig_comment", "audience_comment", "I only have 10 minutes after bedtime", {
      source_url: "https://example.com/comment",
    }),
    manualSignal("sig_note", "creator_note", "My bedtime videos get the most replies"),
  ];
  type Evidence = NonNullable<NonNullable<Parameters<typeof validIdea>[1]>["evidence"]>;
  const batchCiting = (...evidence: Evidence) => {
    const batch = validBatch();
    batch.opportunities[0] = validIdea(0, { evidence });
    return batch;
  };

  it("sends signals as refs and expands the allowed evidence kinds", async () => {
    const { client, queries } = setup({ signals });
    const run = succeed();
    await generateContentOpportunities(client, USER_ID, { run, now: () => NOW });

    const input = vi.mocked(run).mock.calls[0][0].input;
    expect(input.allowedEvidenceKinds).toEqual(["creator_input", "research_signal", "audience_comment"]);
    expect(input.signals.map((s) => [s.ref, s.type, s.kind])).toEqual([
      ["S1", "video", "research_signal"],
      ["S2", "audience_comment", "audience_comment"],
      ["S3", "creator_note", "creator_input"],
    ]);
    expect(JSON.stringify(input.signals)).not.toContain("https://");
    expect(JSON.stringify(input.signals)).not.toContain("sig_comment");

    const read = queries.find((q) => q.table === "research_signals")!;
    expect(read.filters).toEqual(
      expect.arrayContaining([
        ["eq", "user_id", USER_ID],
        ["or", "expires_at.is.null,expires_at.gt.2026-10-12T12:00:00.000Z"],
      ]),
    );
  });

  it("resolves citations server-side: source, link and date come from the signal row", async () => {
    const batch = batchCiting(
      { kind: "audience_comment", summary: "A comment you pasted says they only have 10 minutes.", signal_ref: "S2" },
      { kind: "research_signal", summary: "A recent YouTube video titled … has 48,210 views.", signal_ref: "S1" },
    );
    const { client, queries } = setup({ signals });
    await expect(generateContentOpportunities(client, USER_ID, { run: succeed(batch) })).resolves.toMatchObject({ ok: true });

    const rows = insertOf(queries)[0].payload as { evidence: unknown[]; evidence_strength: string }[];
    expect(rows[0].evidence).toEqual([
      {
        kind: "audience_comment",
        summary: "A comment you pasted says they only have 10 minutes.",
        source: "Audience comment",
        source_url: "https://example.com/comment",
        observed_at: "2026-10-10T00:00:00+00:00",
      },
      {
        kind: "research_signal",
        summary: "A recent YouTube video titled … has 48,210 views.",
        source: "YouTube: 10 Minute Workout for Busy Parents",
        source_url: "https://www.youtube.com/watch?v=vid12345678",
        observed_at: "2026-10-11T00:00:00+00:00",
      },
    ]);
    expect(rows[0]).not.toHaveProperty("evidence.0.signal_ref");
    // Two distinct signals from two different source/type combinations.
    expect(rows[0].evidence_strength).toBe("high");
    expect(rows.slice(1).map((r) => r.evidence_strength)).toEqual(["low", "low", "low", "low"]);
  });

  it.each([
    ["one signal", [{ kind: "audience_comment", summary: "s", signal_ref: "S2" }], "medium"],
    ["the creator's own note only", [{ kind: "creator_input", summary: "s", signal_ref: "S3" }], "low"],
    [
      "a note plus one signal",
      [
        { kind: "creator_input", summary: "s", signal_ref: "S3" },
        { kind: "research_signal", summary: "s", signal_ref: "S1" },
      ],
      "medium",
    ],
  ] as const)("rates %s as %s", async (_label, evidence, expected) => {
    const { client, queries } = setup({ signals });
    await generateContentOpportunities(client, USER_ID, { run: succeed(batchCiting(...(evidence as unknown as Evidence))) });
    expect((insertOf(queries)[0].payload as { evidence_strength: string }[])[0].evidence_strength).toBe(expected);
  });

  it("never rates the same signal cited twice as high", async () => {
    const { client, queries } = setup({ signals: [...signals, videoSignal("vid_other")] });
    const batch = batchCiting(
      { kind: "research_signal", summary: "s", signal_ref: "S1" },
      { kind: "research_signal", summary: "s", signal_ref: "S1" },
    );
    await generateContentOpportunities(client, USER_ID, { run: succeed(batch) });
    expect((insertOf(queries)[0].payload as { evidence_strength: string }[])[0].evidence_strength).toBe("medium");
  });

  it("rejects a mismatched kind/ref and stores nothing", async () => {
    const batch = batchCiting({ kind: "research_signal", summary: "s", signal_ref: "S2" });
    const { client, queries } = setup({ signals });
    await expect(generateContentOpportunities(client, USER_ID, { run: succeed(batch) })).resolves.toMatchObject({
      ok: false,
      code: "invalid_output",
    });
    expect(insertOf(queries)).toEqual([]);
  });

  it("degrades to profile-only evidence when signals can't be loaded", async () => {
    const { client } = setup({ signals, signalsError: pgError() });
    const run = succeed();
    await expect(generateContentOpportunities(client, USER_ID, { run })).resolves.toMatchObject({ ok: true });
    const input = vi.mocked(run).mock.calls[0][0].input;
    expect(input.signals).toEqual([]);
    expect(input.allowedEvidenceKinds).toEqual(["creator_input"]);
  });

  it("skips signal rows whose payload no longer validates", async () => {
    const broken = manualSignal("sig_broken", "audience_comment", "x", { payload: { nope: true } });
    const { client } = setup({ signals: [broken, ...signals] });
    const run = succeed();
    await generateContentOpportunities(client, USER_ID, { run });
    expect(vi.mocked(run).mock.calls[0][0].input.signals).toHaveLength(3);
  });
});
