import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseWith } from "@/lib/schemas/parse";
import {
  contentPackageModelSchemaFor,
  contentPackageOutputFor,
  describeIssue,
  downloadFileName,
  formatRulesFor,
  normalizeHashtags,
  packageToText,
  parseStoredPackage,
  pickSection,
  SECTION_FIELDS,
  SECTION_KEYS,
  sectionInputFor,
  sectionModelSchemaFor,
  sectionOutputFor,
  sectionTexts,
  STUDIO_ERRORS,
  userPackageFor,
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

describe("section schemas", () => {
  const stored = () => {
    const parsed = parseWith(youtubeLong, validPackage());
    if (!parsed.ok) throw new Error("fixture");
    return parsed.data;
  };

  it.each(SECTION_KEYS)("the %s model schema is strict-mode safe and covers only its fields", (section) => {
    const schema = sectionModelSchemaFor(section, ["youtube", "tiktok"]);
    expect(optionalPaths(z.toJSONSchema(schema) as JsonNode)).toEqual([]);
    expect(Object.keys(schema.shape).sort()).toEqual([...SECTION_FIELDS[section]].sort());
  });

  it("never lets a regenerated thumbnail be null", () => {
    expect(sectionModelSchemaFor("thumbnail", ["youtube"]).safeParse({ thumbnail: null }).success).toBe(false);
    expect(parseWith(sectionOutputFor("thumbnail", { platforms: ["youtube"], video: true }), { thumbnail: null }).ok).toBe(false);
  });

  it("needs 3 shots for video and 1 otherwise", () => {
    const two = { shot_list: [{ shot: "a", notes: null }, { shot: "b", notes: null }] };
    expect(parseWith(sectionOutputFor("shot_list", { platforms: ["youtube"], video: true }), two).ok).toBe(false);
    expect(parseWith(sectionOutputFor("shot_list", { platforms: ["youtube"], video: false }), two).ok).toBe(true);
    expect(parseWith(sectionOutputFor("shot_list", { platforms: ["youtube"], video: false }), { shot_list: [] }).ok).toBe(false);
  });

  it("checks regenerated repurposing platforms and bounds", () => {
    const schema = sectionOutputFor("repurposing", { platforms: ["youtube"], video: true });
    expect(parseWith(schema, { repurposing: [{ platform: "tiktok", format: "f", adaptation: "a" }] }).ok).toBe(false);
    expect(parseWith(schema, { repurposing: [{ platform: "youtube", format: "f", adaptation: "a" }] }).ok).toBe(true);
    expect(parseWith(sectionOutputFor("cta", { platforms: ["youtube"], video: true }), { cta: "x".repeat(201) }).ok).toBe(false);
  });

  it("sectionInputFor trims strings, strips unknown keys and rejects bad shapes", () => {
    const parsed = sectionInputFor("caption").safeParse({ caption: "  Hi  ", hashtags: ["#a b"], titles: [] });
    expect(parsed.success && parsed.data).toEqual({ caption: "Hi", hashtags: ["ab"] });
    expect(sectionInputFor("titles").safeParse({ titles: "one" }).success).toBe(false);
    expect(sectionInputFor("cta").safeParse({}).success).toBe(false);
  });

  it("pickSection returns only the section's fields", () => {
    expect(pickSection(stored(), "caption")).toEqual({ caption: stored().caption, hashtags: stored().hashtags });
  });

  it("userPackageFor drops the AI-only format rules but keeps the platform check", () => {
    const relaxed = { ...stored(), shot_list: [], thumbnail: null };
    expect(userPackageFor({ platforms: ["youtube", "tiktok"] }).safeParse(relaxed).success).toBe(true);
    expect(userPackageFor({ platforms: ["youtube"] }).safeParse(stored()).success).toBe(false);
  });

  it("describeIssue turns issues into sentences a creator can act on", () => {
    const issues = (input: unknown) => sectionInputFor("titles").safeParse(input).error!.issues;
    const titles = validPackage().titles.map((title, i) => (i === 1 ? { ...title, text: "x".repeat(101) } : title));
    expect(describeIssue(issues({ titles })[0])).toBe("Title 2 text is too long (max 100 characters).");
    expect(describeIssue(issues({ titles: [titles[0]] })[0])).toBe("Title: use at least 3.");
  });
});

describe("plain text", () => {
  const pkg = () => {
    const parsed = parseWith(linkedinPost, { ...validPackage({ shot_list: [], thumbnail: null, repurposing: [] }) });
    if (!parsed.ok) throw new Error("fixture");
    return parsed.data;
  };

  it("joins every non-empty section with headings, identical to the per-section copy text", () => {
    const texts = sectionTexts(pkg());
    const all = packageToText(pkg(), "10-minute squats");
    expect(all.startsWith("10-minute squats\n\nTITLES\n1. 10-minute squats for busy parents")).toBe(true);
    expect(all).toContain(`CAPTION\n${texts.caption}`);
    expect(all).toContain("#homeworkout #busyparents");
    expect(all).not.toContain("SHOT LIST");
    expect(all).not.toContain("THUMBNAIL");
    for (const key of SECTION_KEYS) if (texts[key]) expect(all).toContain(texts[key]);
  });

  it.each([
    ["10-Minute Squats!", "10-minute-squats.txt"],
    ["Café   crème", "cafe-creme.txt"],
    ["???", "content-package.txt"],
    ["a".repeat(80), `${"a".repeat(60)}.txt`],
  ])("downloadFileName(%s) = %s", (title, expected) => {
    expect(downloadFileName(title)).toBe(expected);
  });
});
