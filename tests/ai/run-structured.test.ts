import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runStructuredWith, type RunStructuredDeps } from "@/lib/ai/run-structured";
import { fakeDb, type FakeDbOptions } from "./fake-db";

const USER_ID = "user_secret_123";
const PROMPT_WORD = "pineapple-prompt-marker";
const API_KEY = "sk-test-should-never-be-logged";

const schema = z.object({ status: z.literal("ok"), echo: z.string() });

type DoGenerate = ConstructorParameters<typeof MockLanguageModelV4>[0] extends infer O
  ? O extends { doGenerate?: infer G }
    ? Exclude<G, undefined>
    : never
  : never;

const usage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 30, text: 30, reasoning: undefined },
};

function replyWith(text: string): DoGenerate {
  return (async () => ({
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: undefined },
    usage,
    warnings: [],
  })) as DoGenerate;
}

function setup({
  doGenerate = replyWith(JSON.stringify({ status: "ok", echo: "pineapple" })),
  db: dbOptions,
  env = {},
}: { doGenerate?: DoGenerate; db?: FakeDbOptions; env?: Record<string, string> } = {}) {
  const fake = fakeDb(dbOptions);
  const model = new MockLanguageModelV4({ doGenerate });
  const languageModel = vi.fn((modelId: string, apiKey: string) => {
    void modelId;
    void apiKey;
    return model;
  });
  let clock = 1_760_000_000_000;
  const deps: RunStructuredDeps = {
    db: fake.db,
    languageModel,
    env: { OPENAI_API_KEY: API_KEY, ...env },
    now: () => (clock += 250),
  };
  const run = () =>
    runStructuredWith(deps, { userId: USER_ID, kind: "smoke_test", input: { word: PROMPT_WORD }, schema });
  return { ...fake, model, languageModel, run, deps };
}

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

function allLogs() {
  return [...errorLog.mock.calls, ...warnLog.mock.calls].map((args) => args.map(String).join(" ")).join("\n");
}

describe("runStructuredWith", () => {
  it("returns validated data and records one succeeded generation and one usage event", async () => {
    const { run, writes, model, languageModel } = setup();

    const result = await run();

    expect(result).toMatchObject({
      ok: true,
      data: { status: "ok", echo: "pineapple" },
      generationId: "gen_1",
      usage: { model: "gpt-6-luna", tier: "fast", inputTokens: 120, outputTokens: 30, costMicros: 27 },
    });
    expect(languageModel).toHaveBeenCalledWith("gpt-6-luna", API_KEY);

    expect(writes.generationInserts).toEqual([
      { user_id: USER_ID, kind: "smoke_test", model: "gpt-6-luna", prompt_version: "v1", status: "pending" },
    ]);
    expect(writes.generationUpdates).toHaveLength(1);
    expect(writes.generationUpdates[0].row).toMatchObject({
      status: "succeeded",
      input_tokens: 120,
      output_tokens: 30,
      error_code: null,
    });
    expect(writes.generationUpdates[0].row.latency_ms).toBeGreaterThanOrEqual(0);
    expect(writes.generationUpdates[0].row.completed_at).toEqual(expect.any(String));
    expect(writes.generationUpdates[0].filters).toEqual([
      ["id", "gen_1"],
      ["user_id", USER_ID],
    ]);
    expect(writes.usageInserts).toEqual([
      {
        user_id: USER_ID,
        event_type: "ai_generation",
        quantity: 1,
        cost_micros: 27,
        ai_generation_id: "gen_1",
        metadata: { kind: "smoke_test", model: "gpt-6-luna", tier: "fast" },
      },
    ]);

    // Bounded, private call settings reach the provider.
    const call = model.doGenerateCalls[0];
    expect(call.maxOutputTokens).toBe(1_000);
    expect(call.providerOptions?.openai).toMatchObject({ store: false });
  });

  it("returns invalid_output for schema-violating output, records a failed row, meters nothing", async () => {
    const { run, writes } = setup({ doGenerate: replyWith(JSON.stringify({ status: "nope" })) });

    const result = await run();

    expect(result).toMatchObject({ ok: false, code: "invalid_output", retryable: true });
    expect(writes.generationUpdates[0].row).toMatchObject({
      status: "failed",
      error_code: "invalid_output",
      input_tokens: 120,
      output_tokens: 30,
    });
    expect(writes.usageInserts).toEqual([]);
  });

  it("returns invalid_output for non-JSON output", async () => {
    const { run } = setup({ doGenerate: replyWith("not json at all") });
    await expect(run()).resolves.toMatchObject({ ok: false, code: "invalid_output" });
  });

  it("returns invalid_output when app-level validation fails", async () => {
    const { deps, writes } = setup();
    const result = await runStructuredWith(deps, {
      userId: USER_ID,
      kind: "smoke_test",
      input: { word: PROMPT_WORD },
      schema,
      validate: () => ({ ok: false, issues: ["echo: too short"] }),
    });
    expect(result).toMatchObject({ ok: false, code: "invalid_output" });
    expect(writes.generationUpdates[0].row).toMatchObject({ status: "failed", error_code: "invalid_output" });
    expect(writes.usageInserts).toEqual([]);
  });

  it("returns the validated app data when validation passes", async () => {
    const { deps } = setup();
    const result = await runStructuredWith(deps, {
      userId: USER_ID,
      kind: "smoke_test",
      input: { word: PROMPT_WORD },
      schema,
      validate: (output) => ({ ok: true, data: output.echo.toUpperCase() }),
    });
    expect(result).toMatchObject({ ok: true, data: "PINEAPPLE" });
  });

  it.each([
    [
      "rate_limited",
      () =>
        new APICallError({
          message: "Rate limit",
          url: "https://api.openai.com/v1/responses",
          requestBodyValues: {},
          statusCode: 429,
          // Zero delay so the single SDK retry doesn't slow the test.
          responseHeaders: { "retry-after-ms": "0" },
        }),
    ],
    ["timeout", () => new DOMException("Total timeout of 60000ms exceeded", "TimeoutError")],
    [
      "provider_error",
      () =>
        new APICallError({
          message: "Bad request",
          url: "https://api.openai.com/v1/responses",
          requestBodyValues: {},
          statusCode: 400,
        }),
    ],
    ["provider_error", () => new Error("socket hang up")],
  ])("maps provider failures to %s, retryable, without metering", async (code, makeError) => {
    const { run, writes } = setup({
      doGenerate: (async () => {
        throw makeError();
      }) as DoGenerate,
    });

    const result = await run();

    expect(result).toMatchObject({ ok: false, code, retryable: true });
    expect(writes.generationUpdates[0].row).toMatchObject({ status: "failed", error_code: code });
    expect(writes.usageInserts).toEqual([]);
  });

  it("retries a rate-limited call at most once", async () => {
    const doGenerate = vi.fn(async () => {
      throw new APICallError({
        message: "Rate limit",
        url: "https://api.openai.com/v1/responses",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { "retry-after-ms": "0" },
      });
    });
    const { run } = setup({ doGenerate: doGenerate as unknown as DoGenerate });
    await run();
    expect(doGenerate).toHaveBeenCalledTimes(2);
  });

  it("returns limit_reached without calling the model or writing rows", async () => {
    const { run, writes, model, limitQueries } = setup({ db: { count: 3 }, env: { AI_DAILY_GENERATION_LIMIT: "3" } });

    await expect(run()).resolves.toMatchObject({ ok: false, code: "limit_reached", retryable: false });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(writes.generationInserts).toEqual([]);
    expect(limitQueries).toHaveLength(1);
  });

  it("counts the creator's own last 24 hours, excluding provider failures", async () => {
    const { run, limitQueries } = setup({ db: { count: 2 }, env: { AI_DAILY_GENERATION_LIMIT: "3" } });

    await expect(run()).resolves.toMatchObject({ ok: true });
    const [query] = limitQueries;
    expect(query.filters[0]).toEqual(["user_id", USER_ID]);
    expect(query.filters[1][0]).toBe("created_at>=");
    // Failed rows count only when the model produced bad output.
    expect(query.or).toBe("status.neq.failed,error_code.eq.invalid_output");
  });

  it("defaults the daily cap to 25", async () => {
    await expect(setup({ db: { count: 24 } }).run()).resolves.toMatchObject({ ok: true });
    await expect(setup({ db: { count: 25 } }).run()).resolves.toMatchObject({ code: "limit_reached" });
  });

  describe("monthly plan allowances", () => {
    const pro = {
      plan: "pro",
      status: "active",
      provider: "paystack",
      current_period_end: "2099-01-01T00:00:00Z",
      cancel_at_period_end: true,
    };
    const weeklyInput = {
      postingCapacityPerWeek: 3,
      remainingSlots: 1,
      platforms: ["youtube"],
      experienceLevel: null,
      cadence: [],
      weekTheme: null,
      days: [],
      scheduled: [],
      ideas: [],
    };

    // weekly_plan: Free 2, Pro 8 per 30 days.
    function weekly(db: FakeDbOptions) {
      const ctx = setup({ db });
      const run = () => runStructuredWith(ctx.deps, { userId: USER_ID, kind: "weekly_plan", input: weeklyInput, schema });
      return { ...ctx, run };
    }

    it("returns upgrade_required for a Free creator at the allowance, without calling the model", async () => {
      const { run, model, writes, limitQueries } = weekly({ monthlyCount: 2 });
      await expect(run()).resolves.toMatchObject({ ok: false, code: "upgrade_required", retryable: false });
      expect(model.doGenerateCalls).toHaveLength(0);
      expect(writes.generationInserts).toEqual([]);
      // The monthly count: this kind, last 30 days, provider failures excluded.
      const monthly = limitQueries.find((q) => q.filters.some(([column]) => column === "kind"))!;
      expect(monthly.filters).toEqual([
        ["user_id", USER_ID],
        ["kind", "weekly_plan"],
        ["created_at>=", expect.any(String)],
      ]);
      expect(monthly.or).toBe("status.neq.failed,error_code.eq.invalid_output");
    });

    it("lets a Free creator run under the allowance", async () => {
      await expect(weekly({ monthlyCount: 1 }).run()).resolves.toMatchObject({ ok: true });
    });

    it("gives Pro the larger allowance, and plan_limit (no upgrade) at its end", async () => {
      await expect(weekly({ monthlyCount: 7, subscription: pro }).run()).resolves.toMatchObject({ ok: true });
      await expect(weekly({ monthlyCount: 8, subscription: pro }).run()).resolves.toMatchObject({
        ok: false,
        code: "plan_limit",
      });
    });

    it("treats an expired pass as Free", async () => {
      const expired = { ...pro, current_period_end: "2020-01-01T00:00:00Z" };
      await expect(weekly({ monthlyCount: 2, subscription: expired }).run()).resolves.toMatchObject({
        code: "upgrade_required",
      });
    });

    it("falls back to Free, not an open allowance, when the plan can't be read", async () => {
      const { run } = weekly({ monthlyCount: 2, subscriptionError: { code: "XX000", message: "boom" } });
      await expect(run()).resolves.toMatchObject({ ok: false, code: "upgrade_required" });
      expect(allLogs()).toContain("billing_entitlement_read_failed");
      expect(allLogs()).not.toContain(USER_ID);
    });

    it("has no monthly allowance for internal tasks", async () => {
      const { run, limitQueries } = setup({ db: { monthlyCount: 999 } });
      await expect(run()).resolves.toMatchObject({ ok: true });
      expect(limitQueries.some((q) => q.filters.some(([column]) => column === "kind"))).toBe(false);
    });

    it("keeps the daily guard the same on every plan", async () => {
      await expect(weekly({ count: 25, subscription: pro }).run()).resolves.toMatchObject({ code: "limit_reached" });
    });
  });

  it("fails closed when the limit query fails", async () => {
    const { run, model } = setup({ db: { countError: { code: "XX000", message: "boom" } } });
    await expect(run()).resolves.toMatchObject({ ok: false, code: "persistence_error" });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("returns persistence_error without calling the model when the pending insert fails", async () => {
    const { run, model } = setup({ db: { insertGenerationError: { code: "23503", message: "fk" } } });
    await expect(run()).resolves.toMatchObject({ ok: false, code: "persistence_error", retryable: true });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it.each([
    ["disabled", { AI_ENABLED: "false" }],
    ["disabled", { AI_ENABLED: "FALSE" }],
    ["not_configured", { OPENAI_API_KEY: "" }],
    ["not_configured", { AI_DAILY_GENERATION_LIMIT: "lots" }],
  ])("returns %s with no model call and no database access", async (code, env) => {
    const { run, model, writes, limitQueries } = setup({ env });

    await expect(run()).resolves.toMatchObject({ ok: false, code, retryable: false });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(limitQueries).toEqual([]);
    expect(writes.generationInserts).toEqual([]);
  });

  it("uses AI_MODEL_FAST without a code change", async () => {
    const { run, languageModel, writes } = setup({ env: { AI_MODEL_FAST: "gpt-6-sol" } });

    const result = await run();

    expect(languageModel).toHaveBeenCalledWith("gpt-6-sol", API_KEY);
    expect(writes.generationInserts[0].model).toBe("gpt-6-sol");
    // No price on file: tokens are recorded, cost is null, and a warning is logged.
    expect(result).toMatchObject({ ok: true, usage: { costMicros: null } });
    expect(writes.usageInserts[0].cost_micros).toBeNull();
    expect(allLogs()).toContain("ai_cost_unknown");
  });

  it("still returns the paid result when recording it fails", async () => {
    const { run } = setup({
      db: {
        updateGenerationError: { code: "08006", message: "down" },
        insertUsageError: { code: "08006", message: "down" },
      },
    });

    await expect(run()).resolves.toMatchObject({ ok: true, data: { echo: "pineapple" } });
    expect(allLogs()).toContain("ai_generation_record_failed");
    expect(allLogs()).toContain("ai_usage_record_failed");
  });

  it("logs failures with no prompt, response, user id or key", async () => {
    const leakyBody = `{"error":"echoing ${PROMPT_WORD} for ${USER_ID}"}`;
    const { run } = setup({
      doGenerate: (async () => {
        throw new APICallError({
          message: `Server error mentioning ${PROMPT_WORD}`,
          url: "https://api.openai.com/v1/responses",
          requestBodyValues: { input: PROMPT_WORD },
          statusCode: 500,
          responseBody: leakyBody,
          isRetryable: false,
        });
      }) as DoGenerate,
    });

    const result = await run();
    const logs = allLogs();

    expect(logs).toContain("ai_generation_failed");
    for (const secret of [PROMPT_WORD, USER_ID, API_KEY, "pineapple"]) {
      expect(logs).not.toContain(secret);
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });
});
