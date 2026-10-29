import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { experienceLevel } from "@/lib/schemas/enums";
import { creatorGoal, platform } from "@/lib/schemas/creator";
import {
  CREATOR_GOALS,
  EVIDENCE_KINDS,
  EXPERIENCE_LEVELS,
  MANUAL_SIGNAL_TYPES,
  PLATFORMS,
  SIGNAL_TYPES,
} from "@/lib/schemas/labels";
import { evidenceKind } from "@/lib/schemas/opportunities";
import { manualSignalType, signalType } from "@/lib/schemas/research";

// Client components show labels and limits without shipping Zod (about 29 KB
// gzipped) to the browser. These guards keep it that way.

const ZOD_FREE = ["lib/schemas/labels.ts", "lib/schemas/limits.ts"];

function resolveImport(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? spec.slice(2) : path.join(path.dirname(from), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The value-import chain from `file` to `zod`, or null. Type-only imports are
 * erased, and "use server" modules reach the browser only as action
 * references, so neither is followed.
 */
function zodPath(file: string, seen: Set<string>): string[] | null {
  if (seen.has(file)) return null;
  seen.add(file);
  const source = readFileSync(file, "utf8");
  if (/^["']use server["']/m.test(source) && !source.includes('"use client"')) return null;
  for (const match of source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gm)) {
    const [, typeOnly, spec] = match;
    if (typeOnly) continue;
    if (spec === "zod") return [file];
    if (!spec.startsWith("@/") && !spec.startsWith(".")) continue;
    const resolved = resolveImport(spec, file);
    const rest = resolved ? zodPath(resolved, seen) : null;
    if (rest) return [file, ...rest];
  }
  return null;
}

describe("client-safe schema modules", () => {
  it.each(ZOD_FREE)("%s imports nothing", (file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(/^import /m);
  });

  it("no client component reaches Zod through its imports", () => {
    const files = execSync('git grep -l "^\\"use client\\"" -- app components', { encoding: "utf8" }).trim().split("\n");
    const leaks = files.map((file) => zodPath(file, new Set())).filter((p): p is string[] => p !== null);
    expect(leaks.map((p) => p.join(" → "))).toEqual([]);
  });

  it("Zod enums are built from the same value lists", () => {
    expect(platform.options).toEqual([...PLATFORMS]);
    expect(creatorGoal.options).toEqual([...CREATOR_GOALS]);
    expect(experienceLevel.options).toEqual([...EXPERIENCE_LEVELS]);
    expect(manualSignalType.options).toEqual([...MANUAL_SIGNAL_TYPES]);
    expect(signalType.options).toEqual([...SIGNAL_TYPES]);
    expect(evidenceKind.options).toEqual([...EVIDENCE_KINDS]);
  });
});
