import { describe, expect, it, vi } from "vitest";
import { AI_ERRORS } from "@/lib/ai/errors";
import type { ContentDiagnosisV1Input } from "@/lib/ai/prompts/content_diagnosis/v1";
import type { AiResult } from "@/lib/ai/run-structured";
import { DIAGNOSIS_ERRORS, earlyCaveat, toStoredDiagnosis, type Diagnosis } from "@/lib/schemas/diagnosis";
import {
  analyzeContentPerformance,
  getLatestDiagnosis,
  POST_DIAGNOSIS_LIMIT,
  saveExperimentAsIdea,
  type DiagnosisDeps,
} from "@/lib/services/diagnosis";
import { validDiagnosis } from "../schemas/diagnosis-fixture";
import { validPackage } from "../schemas/studio-fixture";
import { fakeSupabase, pgError, type FakeResult, type RecordedQuery } from "./fake-supabase";

const USER_ID = "user_diagnosis";
const ITEM_ID = "8b3e30bf-6f2c-4daf-9c59-2f309f4dbe33";
const DIAGNOSIS_ID = "6f1c1f9e-4d0a-4b8e-9a37-0d1f7e2b9c11";
const GENERATION_ID = "11111111-1111-4111-8111-111111111111";
const TZ = "Africa/Lagos"; // UTC+1
const NOW = Date.parse("2026-10-16T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

let n = 0;
const checkIn = (captured: string, views: number) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
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

const latestCheckIn = checkIn(daysAgo(1), 2300);
const detailRow = {
  id: ITEM_ID,
  title: "Knee-safe squats",
  platform: "youtube",
  format: "short",
  published_at: daysAgo(10),
  published_url: "https://youtube.com/shorts/secret",
  hook_used: "Why do your knees hurt?",
  duration_seconds: 35,
  idea_id: "idea-1",
  pillar: { name: "Quick workouts" },
  analytics_snapshots: [checkIn(daysAgo(9), 300), latestCheckIn],
};

/** Other settled YouTube posts (newest first), plus one TikTok post that must be left out. */
const summaryRows = [
  ...Array.from({ length: 14 }, (_, i) => ({
    id: `other-${i}`,
    title: `Other ${i}`,
    platform: "youtube",
    format: "short",
    published_at: daysAgo(20 + i),
    idea_id: null,
    pillar: null,
    analytics_snapshots: [checkIn(daysAgo(5), 1000 + i * 10)],
  })),
  {
    id: "tiktok-1",
    title: "TikTok post",
    platform: "tiktok",
    format: "short",
    published_at: daysAgo(30),
    idea_id: null,
    pillar: null,
    analytics_snapshots: [checkIn(daysAgo(5), 99)],
  },
];

interface Options {
  detail?: unknown;
  profile?: unknown;
  recentDiagnoses?: number;
  pending?: number;
  insert?: FakeResult;
}

function setup(options: Options = {}) {
  const contentItems = (query: RecordedQuery): FakeResult => {
    const columns = query.columns ?? "";
    if (columns.includes("published_url")) return { data: options.detail === undefined ? detailRow : options.detail };
    if (columns.startsWith("idea:")) return { data: { idea: { topic: "Knee-safe squats", angle: "Fix it in 30s" } } };
    if (columns.startsWith("id, hook_used")) {
      return { data: summaryRows.map((row) => ({ id: row.id, hook_used: `Hook of ${row.id}`, duration_seconds: 40 })) };
    }
    return { data: summaryRows };
  };
  return fakeSupabase({
    content_items: contentItems,
    creator_profiles: {
      data:
        options.profile === undefined
          ? {
              niche: "Home fitness",
              audience_description: "Busy parents",
              goals: [],
              platforms: ["youtube"],
              posting_capacity_per_week: 3,
              experience_level: "beginner",
            }
          : options.profile,
    },
    brand_profiles: { data: null },
    content_pillars: { data: [] },
    creator_strategies: { data: null },
    content_versions: { data: { content: { schema_version: 1, package: validPackage() } } },
    ai_generations: { count: options.pending ?? 0 },
    content_diagnoses: (query) =>
      query.op === "select" ? { count: options.recentDiagnoses ?? 0 } : (options.insert ?? { data: { id: DIAGNOSIS_ID } }),
  });
}

function runReturning(result: AiResult<Diagnosis>) {
  return vi.fn<DiagnosisDeps["run"]>(async () => result);
}
const success = () =>
  runReturning({
    ok: true,
    data: validDiagnosis,
    generationId: GENERATION_ID,
    usage: { model: "m", tier: "quality", inputTokens: 1, outputTokens: 1, latencyMs: 1, costMicros: 1 },
  });

describe("analyzeContentPerformance", () => {
  it("builds the input from the post, its plan and other settled posts, then stores the diagnosis", async () => {
    const { client, queries } = setup();
    const run = success();
    const result = await analyzeContentPerformance(client, USER_ID, ITEM_ID, TZ, { run, now: () => NOW });
    expect(result).toEqual({ ok: true, diagnosisId: DIAGNOSIS_ID });

    const request = run.mock.calls[0][0];
    expect(request).toMatchObject({ userId: USER_ID, kind: "content_diagnosis" });
    const input = request.input as ContentDiagnosisV1Input;
    expect(input.post).toMatchObject({
      title: "Knee-safe squats",
      hook_used: "Why do your knees hurt?",
      idea_topic: "Knee-safe squats",
      planned_hook: validPackage().hooks[0].text,
      pillar: "Quick workouts",
    });
    expect(input.post.posted).toMatch(/^[A-Z][a-z]+day, around \d\d:00$/);
    expect(input.checkIns.map((c) => c.views)).toEqual([300, 2300]);
    expect(input.comparison).toMatchObject({ settled: true, peers: 14 });
    // Same platform only, at most 12, with hooks from the narrow read.
    expect(input.otherPosts).toHaveLength(12);
    expect(input.otherPosts[0]).toMatchObject({ title: "Other 0", hook_used: "Hook of other-0", duration_seconds: 40 });
    // No links reach the model.
    expect(JSON.stringify(input)).not.toContain("https://");

    const insert = queries.find((q) => q.table === "content_diagnoses" && q.op === "insert")!;
    expect(insert.payload).toEqual({
      user_id: USER_ID,
      content_item_id: ITEM_ID,
      snapshot_id: latestCheckIn.id,
      ai_generation_id: GENERATION_ID,
      prompt_version: "v1",
      // 14 peers and settled: no confidence capped.
      diagnosis: toStoredDiagnosis(validDiagnosis, false),
    });
  });

  it("applies the honesty rules to early results before storing", async () => {
    const early = { ...detailRow, published_at: daysAgo(2), analytics_snapshots: [checkIn(daysAgo(1), 50)] };
    const { client, queries } = setup({ detail: early });
    await analyzeContentPerformance(client, USER_ID, ITEM_ID, TZ, { run: success(), now: () => NOW });
    const stored = queries.find((q) => q.table === "content_diagnoses" && q.op === "insert")!.payload as {
      diagnosis: ReturnType<typeof toStoredDiagnosis>;
    };
    expect(stored.diagnosis.factors.map((f) => f.confidence)).toEqual(["low", "low"]);
    expect(stored.diagnosis.confidence_capped).toBe(true);
    expect(stored.diagnosis.caveats[0]).toBe(earlyCaveat(1));
  });

  it.each([
    ["an invalid id", { id: "nope" }, "not_found"],
    ["a missing or unpublished post", { detail: null }, "not_found"],
    ["a post without results", { detail: { ...detailRow, analytics_snapshots: [] } }, "no_results"],
    ["no creator profile", { profile: null }, "missing_context"],
    ["the per-post cap", { recentDiagnoses: POST_DIAGNOSIS_LIMIT }, "post_limit"],
    ["a pending diagnosis", { pending: 1 }, "in_progress"],
  ] as const)("stops before AI for %s", async (_, options, code) => {
    const { client, queries } = setup(options as Options);
    const run = success();
    const id = "id" in options ? options.id : ITEM_ID;
    const result = await analyzeContentPerformance(client, USER_ID, id, TZ, { run, now: () => NOW });
    expect(result).toMatchObject({ ok: false, code, message: DIAGNOSIS_ERRORS[code].message });
    expect(run).not.toHaveBeenCalled();
    expect(queries.some((q) => q.table === "content_diagnoses" && q.op === "insert")).toBe(false);
  });

  it("stores nothing when the AI fails, and passes its error on", async () => {
    const { client, queries } = setup();
    const run = runReturning({ ok: false, code: "invalid_output", ...AI_ERRORS.invalid_output });
    const result = await analyzeContentPerformance(client, USER_ID, ITEM_ID, TZ, { run, now: () => NOW });
    expect(result).toMatchObject({ ok: false, code: "invalid_output", retryable: true });
    expect(queries.some((q) => q.table === "content_diagnoses" && q.op === "insert")).toBe(false);
  });

  it("reports a failed insert as persistence_error", async () => {
    const { client } = setup({ insert: { error: pgError() } });
    const result = await analyzeContentPerformance(client, USER_ID, ITEM_ID, TZ, { run: success(), now: () => NOW });
    expect(result).toMatchObject({ ok: false, code: "persistence_error" });
  });
});

describe("getLatestDiagnosis", () => {
  const row = (snapshotId: string | null, diagnosis: unknown = toStoredDiagnosis(validDiagnosis, false)) => ({
    id: DIAGNOSIS_ID,
    created_at: daysAgo(1),
    snapshot_id: snapshotId,
    ai_generation_id: GENERATION_ID,
    diagnosis,
  });

  it("returns the newest diagnosis, whether it is current and whether it was saved", async () => {
    const { client, queries } = fakeSupabase({
      content_diagnoses: { data: row("snap-1") },
      content_ideas: { data: { id: "idea-9" } },
    });
    const result = await getLatestDiagnosis(client, USER_ID, ITEM_ID, "snap-1");
    expect(result).toMatchObject({ ok: true, latest: { id: DIAGNOSIS_ID, current: true, savedIdeaId: "idea-9" } });
    expect(queries[0].filters).toContainEqual(["eq", "user_id", USER_ID]);
    expect(queries[1].filters).toContainEqual(["eq", "ai_generation_id", GENERATION_ID]);
  });

  it("flags newer results and unreadable content", async () => {
    const { client } = fakeSupabase({
      content_diagnoses: { data: row("snap-1", { schema_version: 9 }) },
      content_ideas: { data: null },
    });
    const result = await getLatestDiagnosis(client, USER_ID, ITEM_ID, "snap-2");
    expect(result).toMatchObject({ ok: true, latest: { current: false, diagnosis: null, savedIdeaId: null } });
  });

  it("is null without diagnoses", async () => {
    const { client } = fakeSupabase({ content_diagnoses: { data: null } });
    expect(await getLatestDiagnosis(client, USER_ID, ITEM_ID, null)).toEqual({ ok: true, latest: null });
  });
});

describe("saveExperimentAsIdea", () => {
  const diagnosisRow = {
    id: DIAGNOSIS_ID,
    ai_generation_id: GENERATION_ID,
    diagnosis: toStoredDiagnosis(validDiagnosis, false),
    item: { title: "Knee-safe squats", platform: "youtube", format: "short", pillar_id: "pillar-1" },
  };

  it("inserts a saved idea with creator_history evidence", async () => {
    const { client, queries } = fakeSupabase({
      content_diagnoses: { data: diagnosisRow },
      content_ideas: (query) => (query.op === "select" ? { data: null } : { data: { id: "idea-new" } }),
    });
    expect(await saveExperimentAsIdea(client, USER_ID, DIAGNOSIS_ID)).toEqual({ ok: true, ideaId: "idea-new" });
    const insert = queries.find((q) => q.op === "insert")!;
    expect(insert.payload).toEqual({
      user_id: USER_ID,
      topic: validDiagnosis.next_experiment.idea.topic,
      angle: validDiagnosis.next_experiment.idea.angle,
      format: "short",
      platform: "youtube",
      pillar_id: "pillar-1",
      rationale: validDiagnosis.next_experiment.why,
      status: "saved",
      source: "ai",
      ai_generation_id: GENERATION_ID,
      evidence: [
        {
          kind: "creator_history",
          summary: `From the diagnosis of “Knee-safe squats”: ${validDiagnosis.next_experiment.change}`,
        },
      ],
    });
  });

  it("returns the existing idea instead of saving twice", async () => {
    const { client, queries } = fakeSupabase({
      content_diagnoses: { data: diagnosisRow },
      content_ideas: { data: { id: "idea-old" } },
    });
    expect(await saveExperimentAsIdea(client, USER_ID, DIAGNOSIS_ID)).toEqual({ ok: true, ideaId: "idea-old" });
    expect(queries.some((q) => q.op === "insert")).toBe(false);
  });

  it("is not_found for another creator's or a missing diagnosis", async () => {
    const { client } = fakeSupabase({ content_diagnoses: { data: null } });
    expect(await saveExperimentAsIdea(client, USER_ID, DIAGNOSIS_ID)).toMatchObject({ code: "not_found" });
    expect(await saveExperimentAsIdea(client, USER_ID, "x")).toMatchObject({ code: "not_found" });
  });
});
