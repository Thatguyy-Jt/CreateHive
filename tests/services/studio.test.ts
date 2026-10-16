import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_ERRORS, type AiErrorCode } from "@/lib/ai/errors";
import type { AiResult } from "@/lib/ai/run-structured";
import type { ContentPackageModelOutput, StudioPackage } from "@/lib/schemas/studio";
import { STUDIO_ERRORS } from "@/lib/schemas/studio";
import type { CreatorContext } from "@/lib/services/creator-context";
import { parseWith } from "@/lib/schemas/parse";
import { studioPackage } from "@/lib/schemas/studio";
import {
  CONTEXT_CHAR_LIMIT,
  discardStudioItem,
  generateContentPackage,
  getStudioItem,
  listStudioItems,
  listVersions,
  regenerableSections,
  regenerateSection,
  renderCappedContext,
  restoreVersion,
  savePackageSection,
  scheduleStudioItem,
  startStudioItem,
  type SectionDeps,
  type StudioDeps,
} from "@/lib/services/studio";
import { validPackage } from "../schemas/studio-fixture";
import { fakeSupabase, pgError, type FakeResult, type RecordedQuery } from "./fake-supabase";

const USER_ID = "user_studio";
const ITEM_ID = "8b3e30bf-6f2c-4daf-9c59-2f309f4dbe33";
const IDEA_ID = "6f1c1f9e-4d0a-4b8e-9a37-0d1f7e2b9c11";
const TZ = "Africa/Lagos"; // UTC+1, no DST
// Wed 2026-10-14 10:00 in Lagos.
const NOW = Date.parse("2026-10-14T09:00:00Z");

const profileRow = {
  niche: "Home fitness",
  audience_description: "Busy parents",
  goals: ["grow_audience"],
  platforms: ["youtube", "tiktok"],
  posting_capacity_per_week: 3,
  experience_level: "beginner",
};
const strategyRow = { positioning: "Helps busy parents train at home", growth_objective: "g", monetization_objective: "m", version: 1 };
const itemRow = {
  id: ITEM_ID,
  title: "10-minute squats",
  platform: "youtube",
  format: "10-minute tutorial",
  status: "draft",
  scheduled_for: null,
  pillar: { name: "Quick workouts" },
  idea: {
    topic: "10-minute squats",
    audience_need: "Busy parents with no gym",
    angle: "After bedtime",
    hook: "Kids asleep? Let's squat.",
    rationale: "Fits the quick workouts pillar",
    cta: "Save it for tonight",
    evidence: [
      {
        kind: "research_signal",
        summary: "A recent YouTube video titled X has 5,000 views.",
        source: "YouTube",
        source_url: "https://www.youtube.com/watch?v=abc",
        observed_at: "2026-10-10T00:00:00+00:00",
      },
    ],
  },
};

interface Options {
  item?: unknown;
  itemError?: FakeResult["error"];
  profile?: unknown;
  strategy?: unknown;
  recentContent?: unknown[];
  recentCount?: number;
  recentError?: FakeResult["error"];
  pendingCount?: number;
  latest?: unknown;
  latestError?: FakeResult["error"];
  insert?: FakeResult;
}

function setup(options: Options = {}) {
  return fakeSupabase({
    content_items: (query) =>
      query.columns?.startsWith("title, platform")
        ? { data: options.recentContent ?? [] }
        : { data: options.item === undefined ? itemRow : options.item, error: options.itemError ?? null },
    creator_profiles: { data: options.profile === undefined ? profileRow : options.profile },
    brand_profiles: { data: { tone: "warm", voice_traits: [], do_list: [], dont_list: ["No shaming"], sample_text: null } },
    content_pillars: { data: [{ name: "Quick workouts", description: null }] },
    creator_strategies: { data: options.strategy === undefined ? strategyRow : options.strategy },
    analytics_snapshots: { data: [] },
    creator_insights: { data: [] },
    content_versions: (query) => {
      if (query.op === "insert") return options.insert ?? {};
      if (query.options) return { count: options.recentCount ?? 0, error: options.recentError ?? null };
      return { data: options.latest ?? null, error: options.latestError ?? null };
    },
    ai_generations: { count: options.pendingCount ?? 0 },
  });
}

/** Returns `output` through the request's validator, as `runStructured` does. */
const succeed = (output: ContentPackageModelOutput = validPackage()) =>
  vi.fn<StudioDeps["run"]>(async (request): Promise<AiResult<StudioPackage>> => {
    const validated = request.validate!(output);
    if (!validated.ok) return { ok: false, code: "invalid_output", ...AI_ERRORS.invalid_output };
    return {
      ok: true,
      data: validated.data,
      generationId: "gen_1",
      usage: { model: "m", tier: "quality", inputTokens: 1, outputTokens: 1, latencyMs: 1, costMicros: 1 },
    };
  });

const failWith = (code: AiErrorCode) => vi.fn<StudioDeps["run"]>(async () => ({ ok: false as const, code, ...AI_ERRORS[code] }));

const inserts = (queries: RecordedQuery[]) => queries.filter((q) => q.table === "content_versions" && q.op === "insert");

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

describe("generateContentPackage", () => {
  it("generates from the item, idea and creator context, and stores version 1", async () => {
    const { client, queries } = setup();
    const run = succeed();
    await expect(generateContentPackage(client, USER_ID, ITEM_ID, { run, now: () => NOW })).resolves.toEqual({
      ok: true,
      versionNo: 1,
    });

    const request = run.mock.calls[0][0];
    expect(request).toMatchObject({ userId: USER_ID, kind: "content_package" });
    expect(request.input).toMatchObject({
      platform: "youtube",
      format: "10-minute tutorial",
      video: true,
      thumbnailRequired: true,
      platforms: ["youtube", "tiktok"],
      idea: {
        topic: "10-minute squats",
        angle: "After bedtime",
        pillar: "Quick workouts",
        evidence: ["From research: A recent YouTube video titled X has 5,000 views. (YouTube)"],
      },
    });
    expect(request.input.context).toContain("Niche: Home fitness");
    expect(request.input.context).toContain("No shaming");
    // Evidence links never reach the model.
    expect(JSON.stringify(request.input)).not.toContain("http");

    const item = queries.find((q) => q.table === "content_items" && q.columns?.startsWith("id,"))!;
    expect(item.filters).toEqual([
      ["eq", "id", ITEM_ID],
      ["eq", "user_id", USER_ID],
    ]);

    const [insert] = inserts(queries);
    expect(insert.payload).toEqual({
      user_id: USER_ID,
      content_item_id: ITEM_ID,
      version_no: 1,
      content: { schema_version: 1, package: expect.objectContaining({ cta: validPackage().cta }) },
      source: "ai",
      note: "Generated package",
      ai_generation_id: "gen_1",
    });
  });

  it("numbers the next version after the highest existing one", async () => {
    const { client, queries } = setup({ latest: { version_no: 3 } });
    await expect(generateContentPackage(client, USER_ID, ITEM_ID, { run: succeed(), now: () => NOW })).resolves.toEqual({
      ok: true,
      versionNo: 4,
    });
    expect(inserts(queries)[0].payload).toMatchObject({ version_no: 4 });
    const latest = queries.find((q) => q.table === "content_versions" && q.columns === "version_no")!;
    expect(latest.filters).toEqual(
      expect.arrayContaining([
        ["eq", "content_item_id", ITEM_ID],
        ["order", "version_no", { ascending: false }],
      ]),
    );
  });

  it("returns in_progress when a concurrent generation took the version number", async () => {
    const { client } = setup({ insert: { error: pgError("23505", "duplicate key") } });
    await expect(generateContentPackage(client, USER_ID, ITEM_ID, { run: succeed(), now: () => NOW })).resolves.toMatchObject({
      ok: false,
      code: "in_progress",
    });
  });

  it("returns persistence_error when the insert fails", async () => {
    const { client } = setup({ insert: { error: pgError() } });
    await expect(generateContentPackage(client, USER_ID, ITEM_ID, { run: succeed(), now: () => NOW })).resolves.toEqual({
      ok: false,
      code: "persistence_error",
      ...STUDIO_ERRORS.persistence_error,
    });
    expect(errorLog.mock.calls.flat().join(" ")).toContain("content_package_failed");
  });

  it("treats an invalid id as not found without reading anything", async () => {
    const { client, queries } = setup();
    const run = succeed();
    await expect(generateContentPackage(client, USER_ID, "not-a-uuid", { run })).resolves.toMatchObject({ code: "not_found" });
    expect(queries).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing (or another creator's) item", { item: null }, "not_found"],
    ["an item read error", { itemError: pgError() }, "persistence_error"],
    ["a published item", { item: { ...itemRow, status: "published" } }, "not_editable"],
    ["an archived item", { item: { ...itemRow, status: "archived" } }, "not_editable"],
    ["no profile", { profile: null }, "missing_context"],
    ["no strategy", { strategy: null }, "missing_context"],
    ["no known platforms", { profile: { ...profileRow, platforms: ["myspace"] } }, "missing_context"],
    ["5 AI versions in 24 hours", { recentCount: 5 }, "item_limit"],
    ["a failed item-limit check", { recentError: pgError() }, "persistence_error"],
    ["a pending generation", { pendingCount: 1 }, "in_progress"],
  ] as const)("refuses %s without calling AI or storing", async (_label, options, code) => {
    const { client, queries } = setup(options as Options);
    const run = succeed();
    await expect(generateContentPackage(client, USER_ID, ITEM_ID, { run, now: () => NOW })).resolves.toEqual({
      ok: false,
      code,
      ...STUDIO_ERRORS[code],
    });
    expect(run).not.toHaveBeenCalled();
    expect(inserts(queries)).toEqual([]);
  });

  it("counts only this item's whole-package versions in 24 hours, and pending Studio generations in 2 minutes", async () => {
    const { client, queries } = setup();
    await generateContentPackage(client, USER_ID, ITEM_ID, { run: succeed(), now: () => NOW });
    const cap = queries.find((q) => q.table === "content_versions" && q.options)!;
    expect(cap.filters).toEqual([
      ["eq", "user_id", USER_ID],
      ["eq", "content_item_id", ITEM_ID],
      ["eq", "source", "ai"],
      ["eq", "note", "Generated package"],
      ["gte", "created_at", "2026-10-13T09:00:00.000Z"],
    ]);
    const pending = queries.find((q) => q.table === "ai_generations")!;
    expect(pending.filters).toEqual([
      ["eq", "user_id", USER_ID],
      ["in", "kind", ["content_package", "content_section"]],
      ["eq", "status", "pending"],
      ["gte", "created_at", "2026-10-14T08:58:00.000Z"],
    ]);
  });

  it.each(["limit_reached", "disabled", "rate_limited", "provider_error"] as const)(
    "passes through %s from the AI service and stores nothing",
    async (code) => {
      const { client, queries } = setup();
      await expect(
        generateContentPackage(client, USER_ID, ITEM_ID, { run: failWith(code), now: () => NOW }),
      ).resolves.toEqual({ ok: false, code, ...STUDIO_ERRORS[code] });
      expect(inserts(queries)).toEqual([]);
    },
  );

  it("rejects output that breaks the format rules and stores nothing", async () => {
    const { client, queries } = setup();
    const result = await generateContentPackage(client, USER_ID, ITEM_ID, {
      run: succeed(validPackage({ thumbnail: null })),
      now: () => NOW,
    });
    expect(result).toMatchObject({ ok: false, code: "invalid_output", retryable: true });
    expect(inserts(queries)).toEqual([]);
  });

  it("caps the context it sends, dropping the oldest recent content first", async () => {
    const recentContent = Array.from({ length: 10 }, (_, i) => ({
      title: `Recent ${i} ${"x".repeat(900)}`,
      platform: "youtube",
      format: "short",
      status: "draft",
      published_at: null,
    }));
    const { client } = setup({ recentContent });
    const run = succeed();
    await generateContentPackage(client, USER_ID, ITEM_ID, { run, now: () => NOW });
    const context = run.mock.calls[0][0].input.context;
    expect(context.length).toBeLessThanOrEqual(CONTEXT_CHAR_LIMIT);
    expect(context).toContain("Recent 0 ");
    expect(context).not.toContain("Recent 9 ");
  });

  it("returns persistence_error if something throws", async () => {
    const { client } = fakeSupabase({ content_items: new Error("network") });
    await expect(generateContentPackage(client, USER_ID, ITEM_ID, { run: succeed() })).resolves.toMatchObject({
      code: "persistence_error",
    });
  });
});

describe("renderCappedContext", () => {
  const base: CreatorContext = {
    profile: { niche: "Fitness", audience_description: null, goals: [], platforms: ["youtube"], posting_capacity_per_week: 3, experience_level: null },
    missing: [],
  };

  it("leaves a context under the limit unchanged", () => {
    const context = { ...base, recentContent: [{ title: "One", platform: null, format: null, status: "draft", published_at: null }] };
    expect(renderCappedContext(context, 5_000)).toContain("One");
  });

  it("drops oldest recent content, then performance, keeping the profile", () => {
    const context: CreatorContext = {
      ...base,
      recentContent: [
        { title: "Newest", platform: null, format: null, status: "draft", published_at: null },
        { title: "Oldest".padEnd(400, "!"), platform: null, format: null, status: "draft", published_at: null },
      ],
      performance: Array.from({ length: 20 }, (_, i) => ({
        platform: "youtube",
        captured_at: `2026-10-${String(20 - i).padStart(2, "0")}T00:00:00Z`,
        views: i,
        likes: null,
        comments: null,
        shares: null,
        saves: null,
        follower_delta: null,
      })),
    };
    const rendered = renderCappedContext(context, 600);
    expect(rendered.length).toBeLessThanOrEqual(600);
    expect(rendered).toContain("Niche: Fitness");
    expect(rendered).not.toContain("Oldest");
    expect(rendered).not.toContain("Newest");
    expect(rendered).toContain("2026-10-20");
  });
});

describe("startStudioItem", () => {
  it("calls start_studio_item with the idea id only and returns the item", async () => {
    const { client, rpcCalls } = fakeSupabase({}, () => ({ data: ITEM_ID }));
    await expect(startStudioItem(client, USER_ID, IDEA_ID)).resolves.toEqual({ ok: true, itemId: ITEM_ID });
    expect(rpcCalls).toEqual([{ name: "start_studio_item", args: { p_idea_id: IDEA_ID } }]);
  });

  it.each([
    ["idea_not_found", "idea_not_found"],
    ["idea_not_available", "idea_not_available"],
    ["something else", "db_error"],
  ] as const)("maps %s to %s", async (message, code) => {
    const { client } = fakeSupabase({}, () => ({ error: { code: "P0001", message } }));
    await expect(startStudioItem(client, USER_ID, IDEA_ID)).resolves.toEqual({ ok: false, code, ...STUDIO_ERRORS[code] });
  });

  it("refuses an invalid id without calling the database", async () => {
    const { client, rpcCalls } = fakeSupabase({});
    await expect(startStudioItem(client, USER_ID, "x")).resolves.toMatchObject({ code: "idea_not_found" });
    expect(rpcCalls).toEqual([]);
  });

  it("treats an unexpected result or a throw as db_error", async () => {
    const odd = fakeSupabase({}, () => ({ data: null }));
    await expect(startStudioItem(odd.client, USER_ID, IDEA_ID)).resolves.toMatchObject({ code: "db_error" });
    const thrown = fakeSupabase({}, () => new Error("network"));
    await expect(startStudioItem(thrown.client, USER_ID, IDEA_ID)).resolves.toMatchObject({ code: "db_error" });
  });
});

describe("scheduleStudioItem", () => {
  it("converts the local date and time in the creator's zone and calls schedule_content_item", async () => {
    const { client, rpcCalls } = fakeSupabase({}, () => ({}));
    await expect(scheduleStudioItem(client, USER_ID, ITEM_ID, "2026-10-15", "09:00", TZ, NOW)).resolves.toEqual({ ok: true });
    expect(rpcCalls).toEqual([
      { name: "schedule_content_item", args: { p_item_id: ITEM_ID, p_scheduled_for: "2026-10-15T08:00:00.000Z" } },
    ]);
  });

  it.each([
    ["a past time", "2026-10-13", "09:00", "date_past"],
    ["more than 180 days ahead", "2027-06-01", "09:00", "date_too_far"],
    ["a malformed date", "15/10/2026", "09:00", "invalid_input"],
  ])("refuses %s without calling the database", async (_label, date, time, code) => {
    const { client, rpcCalls } = fakeSupabase({});
    await expect(scheduleStudioItem(client, USER_ID, ITEM_ID, date, time, TZ, NOW)).resolves.toMatchObject({ ok: false, code });
    expect(rpcCalls).toEqual([]);
  });

  it.each([
    ["item_not_found", "not_found"],
    ["item_not_draft", "not_draft"],
    ["scheduled_for_out_of_range", "date_past"],
    ["boom", "db_error"],
  ])("maps %s to %s", async (message, code) => {
    const { client } = fakeSupabase({}, () => ({ error: { code: "P0001", message } }));
    await expect(scheduleStudioItem(client, USER_ID, ITEM_ID, "2026-10-15", "09:00", TZ, NOW)).resolves.toMatchObject({
      ok: false,
      code,
    });
  });

  it("refuses an invalid id", async () => {
    const { client } = fakeSupabase({});
    await expect(scheduleStudioItem(client, USER_ID, "x", "2026-10-15", "09:00", TZ, NOW)).resolves.toMatchObject({
      code: "not_found",
    });
  });
});

describe("listStudioItems", () => {
  const row = (id: string, extra: Record<string, unknown>) => ({
    id,
    title: `Item ${id}`,
    platform: "youtube",
    format: "short",
    status: "draft",
    scheduled_for: null,
    created_at: "2026-10-10T00:00:00Z",
    pillar: { name: "Quick workouts" },
    content_versions: [],
    ...extra,
  });

  it("lists scheduled items soonest first (past included), then drafts newest first", async () => {
    const rows = [
      row("old-draft", { created_at: "2026-10-01T00:00:00Z" }),
      row("later", { status: "scheduled", scheduled_for: "2026-10-20T08:00:00+00:00", content_versions: [{ version_no: 1 }] }),
      row("new-draft", { created_at: "2026-10-12T00:00:00Z", platform: "myspace", pillar: null }),
      row("passed", { status: "scheduled", scheduled_for: "2026-10-13T08:00:00+00:00" }),
    ];
    const { client, queries } = fakeSupabase({ content_items: { data: rows } });
    const result = await listStudioItems(client, USER_ID, NOW);
    if (!result.ok) throw new Error("expected ok");
    expect(result.items.map((item) => [item.id, item.passed, item.has_package])).toEqual([
      ["passed", true, false],
      ["later", false, true],
      ["new-draft", false, false],
      ["old-draft", false, false],
    ]);
    expect(result.items[2]).toMatchObject({ platform: null, pillar_name: null });
    expect(queries[0].filters).toEqual(
      expect.arrayContaining([
        ["eq", "user_id", USER_ID],
        ["in", "status", ["draft", "ready", "scheduled"]],
        ["limit", 50],
        ["limit", 1, { referencedTable: "content_versions" }],
      ]),
    );
  });

  it("skips rows that no longer validate and fails soft on read errors", async () => {
    const { client } = fakeSupabase({ content_items: { data: [row("ok", {}), { id: "bad" }] } });
    const result = await listStudioItems(client, USER_ID, NOW);
    expect(result.ok && result.items.map((item) => item.id)).toEqual(["ok"]);
    const broken = fakeSupabase({ content_items: { error: pgError() } });
    await expect(listStudioItems(broken.client, USER_ID, NOW)).resolves.toEqual({ ok: false });
  });
});


// ---------------------------------------------------------------------------
// Part 2: versions, editing, section regeneration, discard
// ---------------------------------------------------------------------------

/** A stored package as the database holds it (normalised through the app schema). */
function storedPkg(overrides: Partial<ContentPackageModelOutput> = {}): StudioPackage {
  const parsed = parseWith(studioPackage, validPackage(overrides));
  if (!parsed.ok) throw new Error("fixture");
  return parsed.data;
}
const stored = (pkg: StudioPackage = storedPkg()) => ({ schema_version: 1, package: pkg });

interface VersionOptions extends Options {
  /** The latest version row (`version_no, content`), or null for none. */
  latestRow?: { version_no: number; content: unknown } | null;
  /** The restore target (`content`). */
  target?: { content: unknown } | null;
  /** Full rows for getStudioItem: the latest and a requested one. */
  latestFull?: unknown;
  requestedFull?: unknown;
  history?: unknown[];
  versionsError?: FakeResult["error"];
}

function versionSetup(options: VersionOptions = {}) {
  return fakeSupabase({
    content_items: (query) =>
      query.columns?.startsWith("title, platform")
        ? { data: options.recentContent ?? [] }
        : { data: options.item === undefined ? itemRow : options.item, error: options.itemError ?? null },
    creator_profiles: { data: options.profile === undefined ? profileRow : options.profile },
    brand_profiles: { data: { tone: "warm", voice_traits: [], do_list: [], dont_list: [], sample_text: null } },
    content_pillars: { data: [{ name: "Quick workouts", description: null }] },
    creator_strategies: { data: options.strategy === undefined ? strategyRow : options.strategy },
    analytics_snapshots: { data: [] },
    creator_insights: { data: [] },
    ai_generations: { count: options.pendingCount ?? 0 },
    content_versions: (query) => {
      if (options.versionsError) return { error: options.versionsError };
      if (query.op === "insert") return options.insert ?? {};
      if (query.options) return { count: options.recentCount ?? 0, error: options.recentError ?? null };
      if (query.columns === "version_no, content") {
        return { data: options.latestRow === undefined ? { version_no: 2, content: stored() } : options.latestRow };
      }
      if (query.columns === "content") return { data: options.target === undefined ? { content: stored() } : options.target };
      if (query.columns === "version_no, source, note, created_at") return { data: options.history ?? [] };
      const requested = query.filters.some(([method, column]) => method === "eq" && column === "version_no");
      return { data: requested ? (options.requestedFull ?? null) : (options.latestFull ?? null) };
    },
  });
}

const newTitles = [
  { text: "  My own title  ", why: "Because I said so." },
  { text: "Second title", why: "Clear." },
  { text: "Third title", why: "Short." },
];

describe("savePackageSection", () => {
  it("merges only the edited section into the latest package and stores it as a user version", async () => {
    const { client, queries } = versionSetup();
    await expect(
      savePackageSection(client, USER_ID, ITEM_ID, { baseVersion: 2, section: "titles", value: { titles: newTitles, extra: 1 } }),
    ).resolves.toEqual({ ok: true, versionNo: 3 });
    const [insert] = inserts(queries);
    const payload = insert.payload as { content: { package: StudioPackage }; [key: string]: unknown };
    expect(payload).toMatchObject({ user_id: USER_ID, content_item_id: ITEM_ID, version_no: 3, source: "user", note: "Edited titles" });
    expect(payload.ai_generation_id).toBeUndefined();
    expect(payload.content.package.titles[0].text).toBe("My own title");
    // Everything else is the latest package, untouched.
    expect({ ...payload.content.package, titles: storedPkg().titles }).toEqual(storedPkg());
  });

  it("lets a creator save fewer than 3 shots and remove the thumbnail", async () => {
    const shots = versionSetup();
    await expect(
      savePackageSection(shots.client, USER_ID, ITEM_ID, {
        baseVersion: 2,
        section: "shot_list",
        value: { shot_list: [{ shot: "Just one", notes: "" }] },
      }),
    ).resolves.toMatchObject({ ok: true });
    expect((inserts(shots.queries)[0].payload as { content: { package: StudioPackage } }).content.package.shot_list).toEqual([
      { shot: "Just one", notes: null },
    ]);
    const thumb = versionSetup();
    await expect(
      savePackageSection(thumb.client, USER_ID, ITEM_ID, { baseVersion: 2, section: "thumbnail", value: { thumbnail: null } }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("is a conflict when the latest version moved on, and stores nothing", async () => {
    const { client, queries } = versionSetup({ latestRow: { version_no: 3, content: stored() } });
    await expect(
      savePackageSection(client, USER_ID, ITEM_ID, { baseVersion: 2, section: "cta", value: { cta: "New" } }),
    ).resolves.toEqual({ ok: false, code: "version_conflict", ...STUDIO_ERRORS.version_conflict });
    expect(inserts(queries)).toEqual([]);
  });

  it("is a conflict when another save took the version number first", async () => {
    const { client } = versionSetup({ insert: { error: pgError("23505", "duplicate key") } });
    await expect(
      savePackageSection(client, USER_ID, ITEM_ID, { baseVersion: 2, section: "cta", value: { cta: "New" } }),
    ).resolves.toMatchObject({ code: "version_conflict" });
  });

  it.each([
    ["an over-long CTA", { section: "cta", value: { cta: "x".repeat(201) } }, "Call to action is too long (max 200 characters)."],
    ["an empty caption", { section: "caption", value: { caption: "  ", hashtags: [] } }, "Caption can't be empty."],
    ["2 beats", { section: "script", value: { script: { beats: [{ label: "a", say: "b", show: null }, { label: "c", say: "d", show: null }] } } }, "Beat: use at least 3."],
    ["a platform the creator doesn't use", { section: "repurposing", value: { repurposing: [{ platform: "linkedin", format: "post", adaptation: "a" }] } }, "Repurposing must target one of your platforms."],
  ])("rejects %s with a readable message and stores nothing", async (_label, edit, message) => {
    const { client, queries } = versionSetup();
    await expect(savePackageSection(client, USER_ID, ITEM_ID, { baseVersion: 2, ...edit })).resolves.toEqual({
      ok: false,
      code: "invalid_input",
      message,
      retryable: false,
    });
    expect(inserts(queries)).toEqual([]);
  });

  it.each([
    ["an unknown section", { baseVersion: 2, section: "music", value: {} }, "invalid_input"],
    ["a missing base version", { section: "cta", value: { cta: "x" } }, "invalid_input"],
  ])("rejects %s without reading anything", async (_label, input, code) => {
    const { client, queries } = versionSetup();
    await expect(savePackageSection(client, USER_ID, ITEM_ID, input)).resolves.toMatchObject({ code });
    expect(queries).toEqual([]);
  });

  it.each([
    ["an invalid id", "x", {}, "not_found"],
    ["a missing (or another creator's) item", ITEM_ID, { item: null }, "not_found"],
    ["a published item", ITEM_ID, { item: { ...itemRow, status: "published" } }, "not_editable"],
    ["no package yet", ITEM_ID, { latestRow: null }, "version_not_found"],
    ["an unreadable latest version", ITEM_ID, { latestRow: { version_no: 2, content: { schema_version: 9 } } }, "unreadable_version"],
    ["100 versions", ITEM_ID, { latestRow: { version_no: 100, content: stored() } }, "version_limit"],
  ] as const)("refuses %s", async (_label, id, options, code) => {
    const { client, queries } = versionSetup(options as VersionOptions);
    const base = "latestRow" in options && options.latestRow ? options.latestRow.version_no : 2;
    await expect(
      savePackageSection(client, USER_ID, id, { baseVersion: base, section: "cta", value: { cta: "New" } }),
    ).resolves.toMatchObject({ ok: false, code });
    expect(inserts(queries)).toEqual([]);
  });
});

describe("restoreVersion", () => {
  it("copies the chosen version into a new latest version", async () => {
    const old = storedPkg({ cta: "The old CTA" });
    const { client, queries } = versionSetup({ target: { content: stored(old) } });
    await expect(restoreVersion(client, USER_ID, ITEM_ID, { versionNo: 1, baseVersion: 2 })).resolves.toEqual({
      ok: true,
      versionNo: 3,
    });
    const target = queries.find((q) => q.table === "content_versions" && q.columns === "content")!;
    expect(target.filters).toEqual(
      expect.arrayContaining([
        ["eq", "user_id", USER_ID],
        ["eq", "content_item_id", ITEM_ID],
        ["eq", "version_no", 1],
      ]),
    );
    expect(inserts(queries)[0].payload).toMatchObject({
      version_no: 3,
      source: "user",
      note: "Restored version 1",
      content: { schema_version: 1, package: old },
    });
  });

  it.each([
    ["the latest version", { versionNo: 2, baseVersion: 2 }, {}, "already_latest"],
    ["a stale base version", { versionNo: 1, baseVersion: 1 }, {}, "version_conflict"],
    ["a missing version", { versionNo: 7, baseVersion: 2 }, { target: null }, "version_not_found"],
    ["an unreadable version", { versionNo: 1, baseVersion: 2 }, { target: { content: {} } }, "unreadable_version"],
    ["bad input", { versionNo: 0, baseVersion: 2 }, {}, "invalid_input"],
  ] as const)("refuses %s and stores nothing", async (_label, input, options, code) => {
    const { client, queries } = versionSetup(options as VersionOptions);
    await expect(restoreVersion(client, USER_ID, ITEM_ID, input)).resolves.toMatchObject({ ok: false, code });
    expect(inserts(queries)).toEqual([]);
  });
});

/** Returns `output` through the request's validator, as `runStructured` does. */
const sectionSucceeds = (output: unknown) =>
  vi.fn<SectionDeps["run"]>(async (request) => {
    const validated = request.validate!(output as never);
    if (!validated.ok) return { ok: false as const, code: "invalid_output" as const, ...AI_ERRORS.invalid_output };
    return {
      ok: true as const,
      data: validated.data,
      generationId: "gen_section",
      usage: { model: "m", tier: "quality" as const, inputTokens: 1, outputTokens: 1, latencyMs: 1, costMicros: 1 },
    };
  });

const freshHooks = {
  hooks: [
    { text: "New hook one", why: "Sharper." },
    { text: "New hook two", why: "Shorter." },
    { text: "New hook three", why: "Warmer." },
  ],
};

describe("regenerateSection", () => {
  it("regenerates only that section with the current package as context, and stores an AI version", async () => {
    const { client, queries } = versionSetup();
    const run = sectionSucceeds(freshHooks);
    await expect(
      regenerateSection(client, USER_ID, ITEM_ID, { section: "hooks", baseVersion: 2, instruction: "  make them punchier " }, {
        run,
        now: () => NOW,
      }),
    ).resolves.toEqual({ ok: true, versionNo: 3 });

    const request = run.mock.calls[0][0];
    expect(request).toMatchObject({ userId: USER_ID, kind: "content_section" });
    expect(request.input).toMatchObject({ section: "hooks", instruction: "make them punchier", platforms: ["youtube", "tiktok"] });
    expect(request.input.packageSections.find((entry) => entry.section === "cta")?.text).toBe(validPackage().cta);
    expect(JSON.stringify(request.input)).not.toContain("http");

    const payload = inserts(queries)[0].payload as { content: { package: StudioPackage }; [key: string]: unknown };
    expect(payload).toMatchObject({ version_no: 3, source: "ai", note: "Regenerated hooks", ai_generation_id: "gen_section" });
    expect(payload.content.package.hooks).toEqual(freshHooks.hooks);
    expect({ ...payload.content.package, hooks: storedPkg().hooks }).toEqual(storedPkg());
  });

  it("counts this item's section regenerations in 24 hours and pending Studio generations", async () => {
    const { client, queries } = versionSetup();
    await regenerateSection(client, USER_ID, ITEM_ID, { section: "hooks", baseVersion: 2, instruction: null }, {
      run: sectionSucceeds(freshHooks),
      now: () => NOW,
    });
    const cap = queries.find((q) => q.table === "content_versions" && q.options)!;
    expect(cap.filters).toEqual([
      ["eq", "user_id", USER_ID],
      ["eq", "content_item_id", ITEM_ID],
      ["eq", "source", "ai"],
      ["like", "note", "Regenerated %"],
      ["gte", "created_at", "2026-10-13T09:00:00.000Z"],
    ]);
    const pending = queries.find((q) => q.table === "ai_generations")!;
    expect(pending.filters).toEqual(expect.arrayContaining([["in", "kind", ["content_package", "content_section"]]]));
  });

  it.each([
    ["10 regenerations in 24 hours", { recentCount: 10 }, "section_limit"],
    ["a pending generation", { pendingCount: 1 }, "in_progress"],
    ["a stale base version", { latestRow: { version_no: 5, content: stored() } }, "version_conflict"],
    ["an unreadable latest version", { latestRow: { version_no: 2, content: {} } }, "unreadable_version"],
    ["no package yet", { latestRow: null }, "version_not_found"],
    ["no strategy", { strategy: null }, "missing_context"],
    ["a published item", { item: { ...itemRow, status: "published" } }, "not_editable"],
  ] as const)("refuses %s without calling AI or storing", async (_label, options, code) => {
    const { client, queries } = versionSetup(options as VersionOptions);
    const run = sectionSucceeds(freshHooks);
    await expect(
      regenerateSection(client, USER_ID, ITEM_ID, { section: "hooks", baseVersion: 2, instruction: null }, { run, now: () => NOW }),
    ).resolves.toEqual({ ok: false, code, ...STUDIO_ERRORS[code] });
    expect(run).not.toHaveBeenCalled();
    expect(inserts(queries)).toEqual([]);
  });

  it.each([
    ["an over-long instruction", { section: "hooks", baseVersion: 2, instruction: "x".repeat(201) }],
    ["an unknown section", { section: "music", baseVersion: 2, instruction: null }],
  ])("rejects %s without reading anything", async (_label, input) => {
    const { client, queries } = versionSetup();
    await expect(
      regenerateSection(client, USER_ID, ITEM_ID, input, { run: sectionSucceeds(freshHooks) }),
    ).resolves.toMatchObject({ code: "invalid_input" });
    expect(queries).toEqual([]);
  });

  it("refuses a shot list for a written item with no shots", async () => {
    const written = { ...itemRow, platform: "linkedin", format: "text post" };
    const { client } = versionSetup({ item: written, latestRow: { version_no: 2, content: stored(storedPkg({ shot_list: [] })) } });
    const run = sectionSucceeds({ shot_list: [] });
    await expect(
      regenerateSection(client, USER_ID, ITEM_ID, { section: "shot_list", baseVersion: 2, instruction: null }, { run }),
    ).resolves.toMatchObject({ code: "invalid_input" });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ["a video shot list with 2 shots", "shot_list", { shot_list: [{ shot: "a", notes: null }, { shot: "b", notes: null }] }],
    ["a null thumbnail", "thumbnail", { thumbnail: null }],
    ["4 titles", "titles", { titles: [...newTitles, newTitles[0]] }],
  ])("rejects regenerated output with %s and stores nothing", async (_label, section, output) => {
    const { client, queries } = versionSetup();
    await expect(
      regenerateSection(client, USER_ID, ITEM_ID, { section, baseVersion: 2, instruction: null }, {
        run: sectionSucceeds(output),
        now: () => NOW,
      }),
    ).resolves.toMatchObject({ code: "invalid_output", retryable: true });
    expect(inserts(queries)).toEqual([]);
  });

  it("passes AI failures through and stores nothing", async () => {
    const { client, queries } = versionSetup();
    const run = vi.fn<SectionDeps["run"]>(async () => ({ ok: false as const, code: "disabled" as const, ...AI_ERRORS.disabled }));
    await expect(
      regenerateSection(client, USER_ID, ITEM_ID, { section: "hooks", baseVersion: 2, instruction: null }, { run }),
    ).resolves.toEqual({ ok: false, code: "disabled", ...STUDIO_ERRORS.disabled });
    expect(inserts(queries)).toEqual([]);
  });
});

describe("regenerableSections", () => {
  it("offers the shot list and thumbnail only when the format needs them or they exist", () => {
    const empty = storedPkg({ shot_list: [], thumbnail: null });
    expect(regenerableSections(empty, { video: false, thumbnailRequired: false })).toEqual([
      "titles",
      "hooks",
      "script",
      "caption",
      "cta",
      "repurposing",
    ]);
    expect(regenerableSections(empty, { video: true, thumbnailRequired: true })).toContain("thumbnail");
    expect(regenerableSections(storedPkg(), { video: false, thumbnailRequired: false })).toEqual(
      expect.arrayContaining(["shot_list", "thumbnail"]),
    );
  });
});

describe("discardStudioItem", () => {
  it("calls discard_studio_item with the item id only", async () => {
    const { client, rpcCalls } = fakeSupabase({}, () => ({}));
    await expect(discardStudioItem(client, USER_ID, ITEM_ID)).resolves.toEqual({ ok: true });
    expect(rpcCalls).toEqual([{ name: "discard_studio_item", args: { p_item_id: ITEM_ID } }]);
  });

  it.each([
    ["item_not_found", "not_found"],
    ["item_not_draft", "not_draft"],
    ["boom", "db_error"],
  ] as const)("maps %s to %s", async (message, code) => {
    const { client } = fakeSupabase({}, () => ({ error: { code: "P0001", message } }));
    await expect(discardStudioItem(client, USER_ID, ITEM_ID)).resolves.toEqual({ ok: false, code, ...STUDIO_ERRORS[code] });
  });

  it("refuses an invalid id without calling the database", async () => {
    const { client, rpcCalls } = fakeSupabase({});
    await expect(discardStudioItem(client, USER_ID, "x")).resolves.toMatchObject({ code: "not_found" });
    expect(rpcCalls).toEqual([]);
  });
});

describe("getStudioItem", () => {
  const fullRow = (version_no: number, content: unknown = stored(), source = "ai", note: string | null = "Generated package") => ({
    version_no,
    source,
    note,
    content,
    created_at: "2026-10-14T08:00:00+00:00",
  });

  it("returns the item with its idea, latest version and the creator's platforms, in their timezone", async () => {
    const scheduled = { ...itemRow, status: "scheduled", scheduled_for: "2026-10-13T08:00:00+00:00" };
    const { client, queries } = versionSetup({ item: scheduled, latestFull: fullRow(2) });
    const result = await getStudioItem(client, USER_ID, ITEM_ID, TZ, { now: NOW });
    if (!result.ok) throw new Error("expected ok");
    expect(result.item).toMatchObject({
      id: ITEM_ID,
      pillar_name: "Quick workouts",
      date: "2026-10-13",
      time: "09:00",
      passed: true,
      latestVersionNo: 2,
      missingVersion: false,
      platforms: ["youtube", "tiktok"],
      version: { version_no: 2, source: "ai", note: "Generated package", package: expect.objectContaining({ cta: validPackage().cta }) },
    });
    expect(result.item.idea?.evidence).toHaveLength(1);
    const latest = queries.find((q) => q.table === "content_versions")!;
    expect(latest.filters).toEqual(
      expect.arrayContaining([
        ["eq", "user_id", USER_ID],
        ["eq", "content_item_id", ITEM_ID],
        ["order", "version_no", { ascending: false }],
        ["limit", 1],
      ]),
    );
  });

  it("returns a requested older version alongside the latest version number", async () => {
    const { client } = versionSetup({ latestFull: fullRow(3), requestedFull: fullRow(1, stored(), "user", "Edited titles") });
    const result = await getStudioItem(client, USER_ID, ITEM_ID, TZ, { now: NOW, versionNo: 1 });
    expect(result.ok && [result.item.version?.version_no, result.item.version?.source, result.item.latestVersionNo]).toEqual([
      1,
      "user",
      3,
    ]);
  });

  it("flags a requested version that doesn't exist", async () => {
    const { client } = versionSetup({ latestFull: fullRow(3), requestedFull: null });
    const result = await getStudioItem(client, USER_ID, ITEM_ID, TZ, { now: NOW, versionNo: 9 });
    expect(result.ok && result.item).toMatchObject({ version: null, missingVersion: true, latestVersionNo: 3 });
  });

  it("marks an unreadable version instead of failing", async () => {
    const { client } = versionSetup({ latestFull: fullRow(1, { schema_version: 9 }) });
    const result = await getStudioItem(client, USER_ID, ITEM_ID, TZ, { now: NOW });
    expect(result.ok && result.item.version).toMatchObject({ version_no: 1, package: null });
  });

  it("has no version and no date for a fresh draft", async () => {
    const { client } = versionSetup({ latestFull: null });
    const result = await getStudioItem(client, USER_ID, ITEM_ID, TZ, { now: NOW });
    expect(result.ok && result.item).toMatchObject({ version: null, latestVersionNo: null, date: null, time: null, passed: false });
  });

  it("is not_found for an invalid id, or a missing or another creator's item", async () => {
    const empty = fakeSupabase({});
    await expect(getStudioItem(empty.client, USER_ID, "not-a-uuid", TZ)).resolves.toEqual({ ok: false, code: "not_found" });
    expect(empty.queries).toEqual([]);
    const { client } = versionSetup({ item: null });
    await expect(getStudioItem(client, USER_ID, ITEM_ID, TZ)).resolves.toEqual({ ok: false, code: "not_found" });
  });

  it("is read_error when a read fails", async () => {
    const { client } = versionSetup({ versionsError: pgError() });
    await expect(getStudioItem(client, USER_ID, ITEM_ID, TZ)).resolves.toEqual({ ok: false, code: "read_error" });
  });
});

describe("listVersions", () => {
  it("lists the latest 20 versions without content, with local times", async () => {
    const history = [
      { version_no: 2, source: "user", note: "Edited titles", created_at: "2026-10-14T08:12:00+00:00" },
      { version_no: 1, source: "ai", note: "Generated package", created_at: "2026-10-13T17:00:00+00:00" },
      { version_no: 0, source: "robot", note: null, created_at: "x" },
    ];
    const { client, queries } = versionSetup({ history });
    const result = await listVersions(client, USER_ID, ITEM_ID, TZ);
    expect(result).toEqual({
      ok: true,
      versions: [
        { ...history[0], date: "2026-10-14", time: "09:12" },
        { ...history[1], date: "2026-10-13", time: "18:00" },
      ],
    });
    expect(queries[0].filters).toEqual(expect.arrayContaining([["limit", 20], ["eq", "content_item_id", ITEM_ID]]));
  });

  it("fails soft on errors and invalid ids", async () => {
    const { client } = versionSetup({ versionsError: pgError() });
    await expect(listVersions(client, USER_ID, ITEM_ID, TZ)).resolves.toEqual({ ok: false });
    await expect(listVersions(client, USER_ID, "x", TZ)).resolves.toEqual({ ok: false });
  });
});
