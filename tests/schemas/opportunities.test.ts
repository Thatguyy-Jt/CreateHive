import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ideaStatus, type IdeaStatus } from "@/lib/schemas/enums";
import {
  canTransition,
  IDEA_STATUS_TRANSITIONS,
  normalizeTopic,
  opportunityModelSchemaFor,
  opportunityOutputFor,
  type AllowedEvidenceKinds,
} from "@/lib/schemas/opportunities";
import { parseWith } from "@/lib/schemas/parse";
import { FIXTURE_PILLARS, validBatch, validIdea } from "./opportunity-fixture";

type JsonSchemaNode = {
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
};

function optionalPaths(node: JsonSchemaNode, path: string[] = []): string[] {
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

const profileOnly: AllowedEvidenceKinds = ["creator_input"];
const withHistory: AllowedEvidenceKinds = ["creator_input", "creator_history"];

const validate = (input: unknown, kinds: AllowedEvidenceKinds = profileOnly) =>
  parseWith(
    opportunityOutputFor({ pillarNames: FIXTURE_PILLARS, platforms: ["youtube", "tiktok"], allowedEvidenceKinds: kinds }),
    input,
  );

const batchWith = (index: number, overrides: Parameters<typeof validIdea>[1]) => {
  const batch = validBatch();
  batch.opportunities[index] = validIdea(index, overrides);
  return batch;
};

describe("opportunityModelSchemaFor", () => {
  it("has no optional keys (OpenAI strict mode)", () => {
    for (const kinds of [profileOnly, withHistory]) {
      expect(optionalPaths(z.toJSONSchema(opportunityModelSchemaFor(kinds)) as JsonSchemaNode)).toEqual([]);
    }
  });

  it("only allows the evidence kinds it was built with", () => {
    const history = batchWith(0, { evidence: [{ kind: "creator_history", summary: "Your squat video did well.", signal_ref: null }] });
    expect(opportunityModelSchemaFor(profileOnly).safeParse(history).success).toBe(false);
    expect(opportunityModelSchemaFor(withHistory).safeParse(history).success).toBe(true);

    const trend = batchWith(0, { evidence: [{ kind: "trend" as never, summary: "Trending now.", signal_ref: null }] });
    expect(opportunityModelSchemaFor(withHistory).safeParse(trend).success).toBe(false);
  });
});

describe("opportunityOutputFor", () => {
  it("accepts a valid batch", () => {
    expect(validate(validBatch()).ok).toBe(true);
  });

  it("requires exactly 5 opportunities", () => {
    const four = validBatch();
    four.opportunities.pop();
    expect(validate(four).ok).toBe(false);
    const six = validBatch();
    six.opportunities.push(validIdea(5));
    expect(validate(six).ok).toBe(false);
  });

  it("requires unique topics, case- and whitespace-insensitive", () => {
    expect(validate(batchWith(1, { topic: "  IDEA   number 0 " })).ok).toBe(false);
  });

  it("matches pillars case-insensitively and rejects unknown pillars", () => {
    expect(validate(batchWith(0, { pillar_name: "quick WORKOUTS" })).ok).toBe(true);
    expect(validate(batchWith(0, { pillar_name: "Retired pillar" })).ok).toBe(false);
  });

  it("rejects platforms the creator doesn't use", () => {
    expect(validate(batchWith(0, { platform: "tiktok" })).ok).toBe(true);
    expect(validate(batchWith(0, { platform: "linkedin" })).ok).toBe(false);
  });

  it("requires 1-3 evidence items of allowed kinds", () => {
    expect(validate(batchWith(0, { evidence: [] })).ok).toBe(false);
    const item = { kind: "creator_input" as const, summary: "From your profile.", signal_ref: null };
    expect(validate(batchWith(0, { evidence: [item, item, item, item] })).ok).toBe(false);
    const history = batchWith(0, { evidence: [{ kind: "creator_history", summary: "Your squat video did well.", signal_ref: null }] });
    expect(validate(history).ok).toBe(false);
    expect(validate(history, withHistory).ok).toBe(true);
  });

  it.each([
    ["topic", 120],
    ["audience_need", 300],
    ["angle", 300],
    ["hook", 200],
    ["format", 60],
    ["rationale", 400],
    ["cta", 200],
  ] as const)("bounds %s at %i characters", (field, max) => {
    expect(validate(batchWith(0, { [field]: "x".repeat(max) })).ok).toBe(true);
    expect(validate(batchWith(0, { [field]: "x".repeat(max + 1) })).ok).toBe(false);
    expect(validate(batchWith(0, { [field]: "   " })).ok).toBe(false);
  });

  it("bounds evidence summaries at 300 characters", () => {
    expect(validate(batchWith(0, { evidence: [{ kind: "creator_input", summary: "x".repeat(301), signal_ref: null }] })).ok).toBe(false);
  });
});

describe("status transitions", () => {
  it("allows only triage moves", () => {
    const allowed = ideaStatus.options.flatMap((from) =>
      ideaStatus.options.filter((to) => canTransition(from, to)).map((to) => `${from}->${to}`),
    );
    expect(allowed.sort()).toEqual(
      ["new->saved", "new->dismissed", "saved->dismissed", "saved->new", "dismissed->new"].sort(),
    );
  });

  it("never moves to calendar or studio states", () => {
    for (const targets of Object.values(IDEA_STATUS_TRANSITIONS)) {
      for (const to of ["planned", "in_production", "used"] satisfies IdeaStatus[]) {
        expect(targets).not.toContain(to);
      }
    }
  });
});

describe("normalizeTopic", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeTopic("  Home   Workouts\tFor Parents ")).toBe("home workouts for parents");
  });
});

describe("signal refs", () => {
  const kinds: AllowedEvidenceKinds = ["creator_input", "audience_comment", "research_signal"];
  const signals = [
    { ref: "S1", kind: "audience_comment" },
    { ref: "S2", kind: "research_signal" },
    { ref: "S3", kind: "creator_input" },
  ] as const;
  const check = (evidence: NonNullable<Parameters<typeof validIdea>[1]>["evidence"]) =>
    parseWith(
      opportunityOutputFor({ pillarNames: FIXTURE_PILLARS, platforms: ["youtube"], allowedEvidenceKinds: kinds, signals }),
      batchWith(0, { evidence }),
    ).ok;

  it("makes signal_ref a required, nullable enum of the prompt's refs", () => {
    const schema = opportunityModelSchemaFor(kinds, ["S1", "S2"]);
    expect(optionalPaths(z.toJSONSchema(schema) as JsonSchemaNode)).toEqual([]);
    const cite = (ref: string | null) => batchWith(0, { evidence: [{ kind: "audience_comment", summary: "s", signal_ref: ref }] });
    expect(schema.safeParse(cite("S1")).success).toBe(true);
    expect(schema.safeParse(cite(null)).success).toBe(true);
    expect(schema.safeParse(cite("S9")).success).toBe(false);
    // Without signals, only null is accepted.
    expect(opportunityModelSchemaFor(profileOnly).safeParse(validBatch()).success).toBe(true);
    expect(opportunityModelSchemaFor(profileOnly).safeParse(cite("S1")).success).toBe(false);
  });

  it("accepts a cited signal whose kind matches", () => {
    expect(check([{ kind: "audience_comment", summary: "A comment you pasted says…", signal_ref: "S1" }])).toBe(true);
    expect(check([{ kind: "research_signal", summary: "A YouTube video titled…", signal_ref: "S2" }])).toBe(true);
    expect(check([{ kind: "creator_input", summary: "Your note says…", signal_ref: "S3" }])).toBe(true);
    expect(check([{ kind: "creator_input", summary: "You said…", signal_ref: null }])).toBe(true);
  });

  it("rejects unknown refs and kind mismatches", () => {
    expect(check([{ kind: "audience_comment", summary: "s", signal_ref: "S7" }])).toBe(false);
    expect(check([{ kind: "research_signal", summary: "s", signal_ref: "S1" }])).toBe(false);
    expect(check([{ kind: "creator_input", summary: "s", signal_ref: "S1" }])).toBe(false);
  });

  it("requires a ref for signal-backed kinds and forbids one for creator_history", () => {
    expect(check([{ kind: "audience_comment", summary: "s", signal_ref: null }])).toBe(false);
    expect(check([{ kind: "research_signal", summary: "s", signal_ref: null }])).toBe(false);
    const history = parseWith(
      opportunityOutputFor({
        pillarNames: FIXTURE_PILLARS,
        platforms: ["youtube"],
        allowedEvidenceKinds: ["creator_input", "creator_history"],
        signals,
      }),
      batchWith(0, { evidence: [{ kind: "creator_history", summary: "s", signal_ref: "S1" }] }),
    );
    expect(history.ok).toBe(false);
  });
});
