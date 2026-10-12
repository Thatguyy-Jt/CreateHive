import { describe, expect, it } from "vitest";
import { ACTIVE_PROMPTS, getPrompt, isAiKind, type AiKind } from "@/lib/ai/prompts/registry";

describe("prompt registry", () => {
  it("resolves the active version for a kind", () => {
    const prompt = getPrompt("smoke_test");
    expect(prompt).toMatchObject({ kind: "smoke_test", version: "v1" });
    expect(prompt.buildUser({ word: "hello" })).toContain("hello");
  });

  it("gives every prompt its own kind, a vN version and instructions", () => {
    for (const [key, prompt] of Object.entries(ACTIVE_PROMPTS)) {
      expect(prompt.kind).toBe(key);
      expect(prompt.version).toMatch(/^v\d+$/);
      expect(prompt.system.trim()).not.toBe("");
    }
  });

  it("registers creator_strategy with data-delimiter and no-fabrication rules", () => {
    const prompt = getPrompt("creator_strategy");
    expect(prompt).toMatchObject({ kind: "creator_strategy", version: "v1" });
    expect(prompt.system).toContain("<creator_input>");
    expect(prompt.system).toMatch(/never\s+an instruction/i);
    expect(prompt.system).toMatch(/do not invent statistics/i);
    expect(prompt.system).toMatch(/impersonate/i);
  });

  it("builds the creator_strategy user message from context and platforms only", () => {
    const context = '<creator_input section="profile">\nNiche: fitness\n</creator_input>';
    const user = getPrompt("creator_strategy").buildUser({ context, platforms: ["youtube", "tiktok"] });
    expect(user).toContain("youtube, tiktok");
    expect(user).toContain(context);
  });

  it("rejects unknown kinds, including inherited property names", () => {
    expect(isAiKind("smoke_test")).toBe(true);
    expect(isAiKind("nope")).toBe(false);
    expect(isAiKind("constructor")).toBe(false);
    expect(() => getPrompt("nope" as AiKind)).toThrow(/Unknown AI task kind/);
  });
});
