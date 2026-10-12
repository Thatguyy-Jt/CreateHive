import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_ERRORS, type AiErrorCode } from "@/lib/ai/errors";
import type { AiResult } from "@/lib/ai/run-structured";
import type { StrategyOutput } from "@/lib/schemas/creator";
import {
  generateCreatorStrategy,
  getCreatorStrategy,
  STRATEGY_ERRORS,
  type StrategyDeps,
} from "@/lib/services/creator-strategy";
import { validStrategy } from "../schemas/strategy-fixture";
import { fakeSupabase, pgError, type FakeResult } from "./fake-supabase";

const USER_ID = "user_strategy";
const NOW = Date.parse("2026-10-12T12:00:00Z");

const profileRow = {
  niche: "Home fitness",
  audience_description: "Busy parents",
  goals: ["grow_audience"],
  platforms: ["youtube", "tiktok"],
  posting_capacity_per_week: 3,
  experience_level: "beginner",
};
const brandRow = { tone: "warm", voice_traits: [], do_list: [], dont_list: [], sample_text: null };

function setup(options: {
  profile?: unknown;
  brand?: unknown;
  pendingCount?: number;
  pendingError?: FakeResult["error"];
  rpc?: FakeResult;
} = {}) {
  return fakeSupabase(
    {
      creator_profiles: { data: options.profile === undefined ? profileRow : options.profile },
      brand_profiles: { data: options.brand === undefined ? brandRow : options.brand },
      ai_generations: { count: options.pendingCount ?? 0, error: options.pendingError ?? null },
    },
    () => options.rpc ?? { data: 1 },
  );
}

/** Returns the fixture through the request's validator, as `runStructured` does. */
const succeed = (): StrategyDeps["run"] =>
  vi.fn(async (request): Promise<AiResult<StrategyOutput>> => {
    const validated = request.validate!(validStrategy());
    if (!validated.ok) return { ok: false, code: "invalid_output", ...AI_ERRORS.invalid_output };
    return {
      ok: true,
      data: validated.data,
      generationId: "gen_1",
      usage: { model: "m", tier: "quality", inputTokens: 1, outputTokens: 1, latencyMs: 1, costMicros: 1 },
    } satisfies AiResult<StrategyOutput>;
  });

const failWith = (code: AiErrorCode): StrategyDeps["run"] =>
  vi.fn(async () => ({ ok: false as const, code, ...AI_ERRORS[code] }));

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errorLog.mockRestore());

describe("generateCreatorStrategy", () => {
  it("generates from profile + brand context, then saves strategy and pillars atomically", async () => {
    const { client, rpcCalls } = setup({ rpc: { data: 2 } });
    const run = succeed();

    await expect(generateCreatorStrategy(client, USER_ID, { run, now: () => NOW })).resolves.toEqual({
      ok: true,
      version: 2,
    });

    const request = vi.mocked(run).mock.calls[0][0];
    expect(request).toMatchObject({ userId: USER_ID, kind: "creator_strategy" });
    expect(request.input.platforms).toEqual(["youtube", "tiktok"]);
    expect(request.input.context).toContain("Niche: Home fitness");
    expect(request.input.context).not.toContain(USER_ID);

    expect(rpcCalls).toHaveLength(1);
    const { name, args } = rpcCalls[0] as { name: string; args: { p_strategy: Record<string, unknown>; p_pillars: unknown[] } };
    expect(name).toBe("save_creator_strategy");
    expect(args.p_pillars).toHaveLength(3);
    expect(args.p_strategy).toMatchObject({ prompt_version: "v1", ai_generation_id: "gen_1" });
    expect(args.p_strategy).not.toHaveProperty("pillars");
    expect(args.p_strategy).not.toHaveProperty("user_id");
  });

  it("checks for an in-flight generation for this creator in the last 2 minutes", async () => {
    const { client, queries } = setup();
    await generateCreatorStrategy(client, USER_ID, { run: succeed(), now: () => NOW });
    const check = queries.find((q) => q.table === "ai_generations")!;
    expect(check.filters).toEqual(
      expect.arrayContaining([
        ["eq", "user_id", USER_ID],
        ["eq", "kind", "creator_strategy"],
        ["eq", "status", "pending"],
        ["gte", "created_at", "2026-10-12T11:58:00.000Z"],
      ]),
    );
  });

  it.each([
    ["no profile", { profile: null }],
    ["no brand voice", { brand: null }],
    ["no supported platform", { profile: { ...profileRow, platforms: ["myspace"] } }],
  ])("returns missing_context with %s, without calling the AI", async (_label, options) => {
    const { client } = setup(options);
    const run = succeed();
    await expect(generateCreatorStrategy(client, USER_ID, { run })).resolves.toMatchObject({
      ok: false,
      code: "missing_context",
      retryable: false,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a second generation while one is pending", async () => {
    const { client } = setup({ pendingCount: 1 });
    const run = succeed();
    await expect(generateCreatorStrategy(client, USER_ID, { run })).resolves.toMatchObject({ ok: false, code: "in_progress" });
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed when the in-flight check errors", async () => {
    const { client } = setup({ pendingError: pgError() });
    const run = succeed();
    await expect(generateCreatorStrategy(client, USER_ID, { run })).resolves.toMatchObject({
      ok: false,
      code: "persistence_error",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it.each(Object.keys(AI_ERRORS) as AiErrorCode[])("maps AI failure %s to a message and saves nothing", async (code) => {
    const { client, rpcCalls } = setup();
    const result = await generateCreatorStrategy(client, USER_ID, { run: failWith(code) });
    expect(result).toEqual({ ok: false, code, ...STRATEGY_ERRORS[code] });
    expect(rpcCalls).toEqual([]);
  });

  it("validates output against the creator's platforms and saves nothing invalid", async () => {
    const { client, rpcCalls } = setup({ profile: { ...profileRow, platforms: ["youtube"] } });
    const run = succeed(); // the fixture also covers TikTok
    await expect(generateCreatorStrategy(client, USER_ID, { run })).resolves.toMatchObject({
      ok: false,
      code: "invalid_output",
      retryable: true,
    });
    expect(rpcCalls).toEqual([]);
  });

  it("surfaces a save failure as persistence_error", async () => {
    const { client } = setup({ rpc: { error: pgError("22023") } });
    await expect(generateCreatorStrategy(client, USER_ID, { run: succeed() })).resolves.toMatchObject({
      ok: false,
      code: "persistence_error",
      retryable: true,
    });
    expect(errorLog.mock.calls.flat().join(" ")).toContain("strategy_save_failed");
  });

  it("logs no creator text or ids", async () => {
    const { client } = setup({ rpc: { error: pgError("XX000", `failed for ${USER_ID}`) } });
    await generateCreatorStrategy(client, USER_ID, { run: succeed() });
    const logged = errorLog.mock.calls.flat().join(" ");
    expect(logged).not.toContain(USER_ID);
    expect(logged).not.toContain("Home fitness");
  });
});

describe("getCreatorStrategy", () => {
  // A stored row has the strategy's columns; pillars live in their own table.
  const row: Record<string, unknown> = { ...validStrategy(), version: 3, updated_at: "2026-10-12T00:00:00Z" };
  delete row.pillars;
  const pillarRows = [{ id: "p1", name: "Quick workouts", description: "d" }];

  it("returns null when there is no strategy yet", async () => {
    const { client } = fakeSupabase({ creator_strategies: { data: null }, content_pillars: { data: [] } });
    await expect(getCreatorStrategy(client, USER_ID)).resolves.toEqual({ ok: true, strategy: null });
  });

  it("returns the stored strategy with active pillars", async () => {
    const { client, queries } = fakeSupabase({
      creator_strategies: { data: row },
      content_pillars: { data: pillarRows },
    });
    const result = await getCreatorStrategy(client, USER_ID);
    expect(result.ok && result.strategy).toMatchObject({ version: 3, positioning: row.positioning, pillars: pillarRows });
    expect(queries.find((q) => q.table === "content_pillars")!.filters).toContainEqual(["eq", "is_active", true]);
  });

  it("rejects a stored row whose JSON no longer validates", async () => {
    const { client } = fakeSupabase({
      creator_strategies: { data: { ...row, thirty_day_plan: [] } },
      content_pillars: { data: pillarRows },
    });
    await expect(getCreatorStrategy(client, USER_ID)).resolves.toEqual({ ok: false });
  });

  it("returns ok:false on a read error", async () => {
    const { client } = fakeSupabase({ creator_strategies: { error: pgError() }, content_pillars: { data: [] } });
    await expect(getCreatorStrategy(client, USER_ID)).resolves.toEqual({ ok: false });
  });
});
