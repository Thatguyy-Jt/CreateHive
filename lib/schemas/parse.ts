import type { z } from "zod";

export type ParseResult<T> = { ok: true; data: T } | { ok: false; issues: string[] };

/**
 * Validates without throwing, so callers (for example the AI service handling
 * malformed model output) can retry or show a recoverable error. Issues name
 * the failing path and rule only; they never echo the input value.
 */
export function parseWith<T>(schema: z.ZodType<T>, input: unknown): ParseResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
  };
}
