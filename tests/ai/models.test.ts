import { describe, expect, it } from "vitest";
import { readAiConfig, readDailyGenerationLimit } from "@/lib/ai/env";
import { AI_TASK_ROUTES, AI_TIERS, modelForTier, routeTask } from "@/lib/ai/models";
import { ACTIVE_PROMPTS, type AiKind } from "@/lib/ai/prompts/registry";

describe("model routing", () => {
  it("routes each kind through its tier", () => {
    expect(routeTask("smoke_test")).toEqual({
      tier: "fast",
      modelId: "gpt-6-luna",
      reasoning: "low",
      maxOutputTokens: 1_000,
    });
  });

  it("routes content packages to the quality tier with an 8k output ceiling", () => {
    expect(routeTask("content_package")).toEqual({
      tier: "quality",
      modelId: "gpt-6.1-sol",
      reasoning: "medium",
      maxOutputTokens: 8_000,
    });
  });

  it("has a route for every prompt kind and a prompt for every route", () => {
    expect(Object.keys(AI_TASK_ROUTES).sort()).toEqual(Object.keys(ACTIVE_PROMPTS).sort());
  });

  it("maps tiers to their default models and efforts", () => {
    expect(AI_TIERS.quality).toEqual({ defaultModel: "gpt-6.1-sol", reasoning: "medium" });
    expect(AI_TIERS.fast).toEqual({ defaultModel: "gpt-6-luna", reasoning: "low" });
  });

  it("lets AI_MODEL_QUALITY and AI_MODEL_FAST override models without code changes", () => {
    const config = readAiConfig({
      OPENAI_API_KEY: "sk-x",
      AI_MODEL_QUALITY: "gpt-6-sol",
      AI_MODEL_FAST: " ",
    });
    if (!config.ok) throw new Error("expected config");
    expect(modelForTier("quality", config.config.modelOverrides)).toBe("gpt-6-sol");
    // Blank means default.
    expect(modelForTier("fast", config.config.modelOverrides)).toBe("gpt-6-luna");
    expect(routeTask("smoke_test", { fast: "gpt-6-sol" }).modelId).toBe("gpt-6-sol");
  });

  it("rejects an unknown kind", () => {
    expect(() => routeTask("not_a_kind" as AiKind)).toThrow(/Unknown AI task kind/);
    expect(() => routeTask("toString" as AiKind)).toThrow(/Unknown AI task kind/);
  });
});

describe("AI config", () => {
  it("names missing variables without echoing values", () => {
    const result = readAiConfig({ OPENAI_API_KEY: "", AI_DAILY_GENERATION_LIMIT: "-5" });
    expect(result).toEqual({
      ok: false,
      variables: expect.arrayContaining(["OPENAI_API_KEY", "AI_DAILY_GENERATION_LIMIT"]),
    });
    expect(JSON.stringify(result)).not.toContain("-5");
  });

  it("defaults the daily limit to 25", () => {
    const result = readAiConfig({ OPENAI_API_KEY: "sk-x" });
    expect(result).toMatchObject({ ok: true, config: { dailyGenerationLimit: 25 } });
  });
});

describe("readDailyGenerationLimit", () => {
  it("reads the cap without needing the OpenAI key", () => {
    expect(readDailyGenerationLimit({})).toBe(25);
    expect(readDailyGenerationLimit({ AI_DAILY_GENERATION_LIMIT: "5" })).toBe(5);
    expect(readDailyGenerationLimit({ AI_DAILY_GENERATION_LIMIT: "  " })).toBe(25);
  });

  it("returns null for invalid values", () => {
    for (const value of ["lots", "0", "-5", "2.5"]) {
      expect(readDailyGenerationLimit({ AI_DAILY_GENERATION_LIMIT: value })).toBeNull();
    }
  });

  it("agrees with the cap the AI service enforces", () => {
    for (const value of [undefined, "", "7", "40"]) {
      const config = readAiConfig({ OPENAI_API_KEY: "sk-x", AI_DAILY_GENERATION_LIMIT: value });
      if (!config.ok) throw new Error("expected config");
      expect(readDailyGenerationLimit({ AI_DAILY_GENERATION_LIMIT: value })).toBe(config.config.dailyGenerationLimit);
    }
  });
});
