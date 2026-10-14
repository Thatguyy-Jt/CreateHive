import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseWith } from "@/lib/schemas/parse";
import {
  contentPackageModelSchemaFor,
  contentPackageOutputFor,
  formatRulesFor,
  normalizeHashtags,
  parseStoredPackage,
  STUDIO_ERRORS,
} from "@/lib/schemas/studio";
import { validPackage } from "./studio-fixture";

const youtubeLong = contentPackageOutputFor({
  platforms: ["youtube", "tiktok"],
  primaryPlatform: "youtube",
  format: "10-minute tutorial",
});
const linkedinPost = contentPackageOutputFor({ platforms: ["linkedin"], primaryPlatform: "linkedin", format: "text post" });

type JsonNode = { properties?: Record<string, JsonNode>; required?: string[]; items?: JsonNode; anyOf?: JsonNode[] };

/** Keys missing from `required` anywhere in the JSON schema (OpenAI strict mode rejects them). */
function optionalPaths(node: JsonNode, path: string[] = []): string[] {
  const found: string[] = [];
  if (node.properties) {
    const required = new Set(node.required ?? []);
    for (const [key, child] of Object.entries(node.properties)) {
      if (!required.has(key)) found.push([...path, key].join("."));
      found.push(...optionalPaths(child, [...path, key]));
    }
  }
  if (node.items) found.push(...optionalPaths(node.items, [...path, "[]"]));
  for (const option of node.anyOf ?? []) found.push(...optionalPaths(option, path));
  return found;
}

describe("contentPackageModelSchemaFor", () => {
  it("is strict-mode safe: every key is required", () => {
    const schema = contentPackageModelSchemaFor(["youtube"]);
    expect(optionalPaths(z.toJSONSchema(schema) as JsonNode)).toEqual([]);
  });

  it("only allows the creator's platforms for repurposing", () => {
    const schema = contentPackageModelSchemaFor(["youtube", "tiktok"]);
    expect(schema.safeParse(validPackage()).success).toBe(true);
    const bad = validPackage({ repurposing: [{ platform: "linkedin" as never, format: "post", adaptation: "x" }] });
    expect(schema.safeParse(bad).success).toBe(false);
  });
});

describe("formatRulesFor", () => {
  it.each([
    ["youtube", "10-minute tutorial", { video: true, thumbnailRequired: true }],
    ["youtube", null, { video: true, thumbnailRequired: true }],
    ["youtube", "Shorts", { video: true, thumbnailRequired: false }],
    ["youtube", "60-second tutorial", { video: true, thumbnailRequired: false }],
    ["tiktok", "storytime", { video: true, thumbnailRequired: false }],
    ["instagram", "reel", { video: true, thumbnailRequired: false }],
    ["instagram", "carousel", { video: false, thumbnailRequired: false }],
    ["linkedin", "text post", { video: false, thumbnailRequired: false }],
    ["x", "thread", { video: false, thumbnailRequired: false }],
    ["linkedin", "talking-head video", { video: true, thumbnailRequired: false }],
    [null, null, { video: false, thumbnailRequired: false }],
  ] as const)("%s / %s", (platform, format, expected) => {
    expect(formatRulesFor(platform, format)).toEqual(expected);
  });
});

describe("contentPackageOutputFor", () => {
  it("accepts a valid package and normalises hashtags", () => {
    const result = parseWith(youtubeLong, validPackage({ hashtags: ["#home workout", "HomeWorkout", "##busy", " ", "x"] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.hashtags).toEqual(["homeworkout", "busy", "x"]);
  });

  it("turns blank optional lines into null", () => {
    const pkg = validPackage();
    pkg.script.beats[0].show = "   ";
    pkg.shot_list[0].notes = "";
    const result = parseWith(youtubeLong, pkg);
    expect(result.ok && [result.data.script.beats[0].show, result.data.shot_list[0].notes]).toEqual([null, null]);
  });

  it.each([
    ["2 titles", { titles: validPackage().titles.slice(0, 2) }],
    ["4 hooks", { hooks: [...validPackage().hooks, validPackage().hooks[0]] }],
    ["a long title", { titles: [{ text: "x".repeat(101), why: "y" }, ...validPackage().titles.slice(1)] }],
    ["a long why", { hooks: [{ text: "x", why: "y".repeat(161) }, ...validPackage().hooks.slice(1)] }],
    ["2 beats", { script: { beats: validPackage().script.beats.slice(0, 2) } }],
    ["13 beats", { script: { beats: Array.from({ length: 13 }, () => validPackage().script.beats[0]) } }],
    ["a long beat", { script: { beats: [{ label: "L", say: "s".repeat(1201), show: null }, ...validPackage().script.beats.slice(1)] } }],
    ["16 shots", { shot_list: Array.from({ length: 16 }, () => ({ shot: "s", notes: null })) }],
    ["a long caption", { caption: "c".repeat(2201) }],
    ["an empty caption", { caption: "  " }],
    ["9 hashtags", { hashtags: Array.from({ length: 9 }, (_, i) => `tag${i}`) }],
    ["a long hashtag", { hashtags: ["h".repeat(41)] }],
    ["a long CTA", { cta: "c".repeat(201) }],
    ["long overlay text", { thumbnail: { concept: "c", overlay_text: "o".repeat(41) } }],
    ["4 repurposing ideas", { repurposing: Array.from({ length: 4 }, () => validPackage().repurposing[0]) }],
    ["repurposing to another platform", { repurposing: [{ platform: "linkedin" as const, format: "post", adaptation: "a" }] }],
    ["a video with 2 shots", { shot_list: validPackage().shot_list.slice(0, 2) }],
    ["YouTube long-form without a thumbnail", { thumbnail: null }],
  ])("rejects %s", (_label, overrides) => {
    expect(parseWith(youtubeLong, validPackage(overrides as never)).ok).toBe(false);
  });

  it("lets written formats skip the shot list and thumbnail", () => {
    const pkg = validPackage({ shot_list: [], thumbnail: null, repurposing: [] });
    pkg.script.beats = pkg.script.beats.map((beat) => ({ ...beat, show: null }));
    expect(parseWith(linkedinPost, pkg).ok).toBe(true);
  });
});

describe("parseStoredPackage", () => {
  it("reads a version-1 package", () => {
    const pkg = parseWith(youtubeLong, validPackage());
    if (!pkg.ok) throw new Error("fixture");
    expect(parseStoredPackage({ schema_version: 1, package: pkg.data })).toEqual({ ok: true, package: pkg.data });
  });

  it.each([
    ["an unknown schema version", { schema_version: 2, package: validPackage() }],
    ["invalid content", { schema_version: 1, package: { titles: [] } }],
    ["an empty object", {}],
    ["null", null],
  ])("treats %s as unreadable", (_label, content) => {
    expect(parseStoredPackage(content)).toEqual({ ok: false });
  });
});

describe("normalizeHashtags and errors", () => {
  it("strips #, spaces and case-insensitive duplicates", () => {
    expect(normalizeHashtags(["#A b", "ab", "#", "C"])).toEqual(["Ab", "C"]);
  });

  it("has a message for every code without leaking internals", () => {
    for (const { message } of Object.values(STUDIO_ERRORS)) {
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/openai|supabase|sql|token/i);
    }
  });
});
