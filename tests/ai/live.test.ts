import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Real OpenAI + Supabase round trip. Skipped unless run with
 * `pnpm test:live` (vitest mode "live") or RUN_LIVE_AI=1. Costs a fraction of
 * a cent. Set KEEP_AI_SMOKE_ROWS=1 to keep the rows for inspection.
 */
const LIVE = import.meta.env.MODE === "live" || process.env.RUN_LIVE_AI === "1";
const SMOKE_USER_ID = "user_ai_smoke";

// Vitest doesn't load env files like Next.js does. Existing variables win, so
// `.env.local` takes priority over `.env`.
if (LIVE) {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

const schema = z.object({ status: z.literal("ok"), echo: z.string() });

describe.skipIf(!LIVE)("AI service (live)", () => {
  // Imported lazily so a skipped run never touches real clients.
  let lib: typeof import("@/lib/ai");
  let admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

  beforeAll(async () => {
    lib = await import("@/lib/ai");
    admin = (await import("@/lib/supabase/admin")).createAdminClient();
    const { error } = await admin.from("users").upsert({ id: SMOKE_USER_ID, email: null });
    if (error) throw new Error(`could not create smoke user: ${error.code}`);
  });

  afterAll(async () => {
    if (!admin || process.env.KEEP_AI_SMOKE_ROWS === "1") return;
    await admin.from("users").delete().eq("id", SMOKE_USER_ID); // cascades
  });

  it("runs the smoke_test prompt and records one generation and one usage event", async () => {
    const result = await lib.runStructured({
      userId: SMOKE_USER_ID,
      kind: "smoke_test",
      input: { word: "pineapple" },
      schema,
    });
    if (!result.ok) throw new Error(`live call failed: ${result.code}`);

    expect(result.data).toEqual({ status: "ok", echo: "pineapple" });

    const generation = await admin
      .from("ai_generations")
      .select("status, model, prompt_version, input_tokens, output_tokens, latency_ms")
      .eq("id", result.generationId)
      .single();
    expect(generation.error).toBeNull();
    expect(generation.data).toMatchObject({ status: "succeeded", prompt_version: "v1" });
    expect(generation.data!.input_tokens).toBeGreaterThan(0);
    expect(generation.data!.output_tokens).toBeGreaterThan(0);

    const usage = await admin
      .from("usage_events")
      .select("cost_micros, event_type")
      .eq("ai_generation_id", result.generationId);
    expect(usage.error).toBeNull();
    expect(usage.data).toHaveLength(1);
    expect(usage.data![0].event_type).toBe("ai_generation");
    console.info(`live smoke: model=${generation.data!.model} cost_micros=${usage.data![0].cost_micros}`);
  }, 90_000);

  it("generates a creator_strategy that passes app validation", async () => {
    const { strategyModelSchema, strategyOutputFor } = await import("@/lib/schemas/creator");
    const { parseWith } = await import("@/lib/schemas/parse");
    const { renderContextForPrompt } = await import("@/lib/services/creator-context");
    const platforms = ["youtube", "tiktok"] as const;
    const context = renderContextForPrompt({
      profile: {
        niche: "Home workouts for busy parents",
        audience_description: "Parents of young kids who have 20 minutes a day and no gym.",
        goals: ["grow_audience", "monetize"],
        platforms: [...platforms],
        posting_capacity_per_week: 3,
        experience_level: "beginner",
      },
      brand: { tone: "warm and practical", voice_traits: ["Encouraging"], do_list: [], dont_list: ["No shaming"], sample_text: null },
      missing: [],
    });

    const result = await lib.runStructured({
      userId: SMOKE_USER_ID,
      kind: "creator_strategy",
      input: { context, platforms },
      schema: strategyModelSchema,
      validate: (output) => parseWith(strategyOutputFor(platforms), output),
    });
    if (!result.ok) throw new Error(`live strategy failed: ${result.code}`);

    expect(result.data.pillars.length).toBeGreaterThanOrEqual(3);
    expect(result.data.thirty_day_plan.map((w) => w.week)).toEqual([1, 2, 3, 4]);
    console.info(`live strategy: model=${result.usage.model} cost_micros=${result.usage.costMicros}`);
  }, 180_000);

  it("generates content_opportunities that pass app validation", async () => {
    const { opportunityModelSchemaFor, opportunityOutputFor } = await import("@/lib/schemas/opportunities");
    const { parseWith } = await import("@/lib/schemas/parse");
    const { renderContextForPrompt } = await import("@/lib/services/creator-context");
    const platforms = ["youtube", "tiktok"] as const;
    const pillars = [
      { name: "Quick home workouts", description: "Short sessions that fit around kids." },
      { name: "Fuel for busy days", description: "Simple meals and snacks." },
      { name: "Staying consistent", description: "Habits and mindset for parents." },
    ];
    const context = renderContextForPrompt({
      profile: {
        niche: "Home workouts for busy parents",
        audience_description: "Parents of young kids who have 20 minutes a day and no gym.",
        goals: ["grow_audience"],
        platforms: [...platforms],
        posting_capacity_per_week: 3,
        experience_level: "beginner",
      },
      brand: { tone: "warm and practical", voice_traits: ["Encouraging"], do_list: [], dont_list: ["No shaming"], sample_text: null },
      pillars,
      strategy: {
        positioning: "Helps busy parents get fit at home in 20 minutes a day.",
        growth_objective: "Post 3 times a week for 90 days.",
        monetization_objective: "Start an email list.",
        version: 1,
      },
      missing: [],
    });
    const allowedEvidenceKinds = ["creator_input", "audience_comment", "research_signal"] as const;
    const signals = [
      {
        ref: "S1",
        type: "audience_comment",
        source: "manual",
        kind: "audience_comment",
        excerpt: "Comment on my squat video: I only have 10 minutes after the kids are in bed, what can I do?",
      },
      {
        ref: "S2",
        type: "video",
        source: "youtube",
        kind: "research_signal",
        excerpt: "10 Minute No-Equipment Workout for Busy Moms | channel: Example Fit | published Sep 30, 2026 | 48,210 views",
      },
    ] as const;

    const result = await lib.runStructured({
      userId: SMOKE_USER_ID,
      kind: "content_opportunities",
      input: { context, platforms, allowedEvidenceKinds, signals, previousTopics: [], dismissedTopics: [] },
      schema: opportunityModelSchemaFor(
        allowedEvidenceKinds,
        signals.map((s) => s.ref),
      ),
      validate: (output) =>
        parseWith(
          opportunityOutputFor({ pillarNames: pillars.map((p) => p.name), platforms, allowedEvidenceKinds, signals }),
          output,
        ),
    });
    if (!result.ok) throw new Error(`live opportunities failed: ${result.code}`);

    expect(result.data.opportunities).toHaveLength(5);
    const refs = result.data.opportunities.flatMap((o) => o.evidence.map((e) => e.signal_ref)).filter(Boolean);
    console.info(`live opportunities: cited refs=${refs.join(",") || "none"}`);
    console.info(`live opportunities: model=${result.usage.model} cost_micros=${result.usage.costMicros}`);
  }, 180_000);

  it("returns limit_reached once the cap is hit, without a new generation row", async () => {
    const { runStructuredWith } = await import("@/lib/ai/run-structured");
    const before = await admin
      .from("ai_generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", SMOKE_USER_ID);

    const result = await runStructuredWith(
      { ...lib.createDefaultDeps(), env: { ...process.env, AI_DAILY_GENERATION_LIMIT: "1" } },
      { userId: SMOKE_USER_ID, kind: "smoke_test", input: { word: "pineapple" }, schema },
    );

    expect(result).toMatchObject({ ok: false, code: "limit_reached" });
    const after = await admin
      .from("ai_generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", SMOKE_USER_ID);
    expect(after.count).toBe(before.count);
  });
});
