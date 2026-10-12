import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * OpenAI strict structured outputs (the AI SDK provider default) require every
 * property to be present: model-facing schemas use `.nullable()`, never
 * `.optional()`. Callers then map the result into the app schema.
 */
const sampleModelSchema = z.object({
  title: z.string(),
  hook: z.string().nullable(),
  tags: z.array(z.string()),
  cta: z.object({ text: z.string(), url: z.string().nullable() }).nullable(),
});

function optionalPaths(schema: z.ZodType): string[] {
  return collect(z.toJSONSchema(schema) as JsonSchemaNode, []);
}

type JsonSchemaNode = {
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
};

function collect(node: JsonSchemaNode, path: string[]): string[] {
  const found: string[] = [];
  if (node.properties) {
    const required = new Set(node.required ?? []);
    for (const [key, child] of Object.entries(node.properties)) {
      if (!required.has(key)) found.push([...path, key].join("."));
      found.push(...collect(child, [...path, key]));
    }
  }
  if (node.items) found.push(...collect(node.items, [...path, "[]"]));
  for (const option of node.anyOf ?? []) found.push(...collect(option, path));
  return found;
}

describe("strict-mode schema rule", () => {
  it("the sample model-facing schema has no optional keys", () => {
    expect(optionalPaths(sampleModelSchema)).toEqual([]);
  });

  it("the check catches .optional()", () => {
    const bad = z.object({ title: z.string(), hook: z.string().optional(), nested: z.object({ x: z.string().optional() }) });
    expect(optionalPaths(bad)).toEqual(["hook", "nested.x"]);
  });
});
