import { z } from "zod";
import { AI_ERRORS, type AiErrorCode } from "@/lib/ai/errors";
import { signalLevel, type SignalLevel } from "./enums";
import { parseWith } from "./parse";

// Diagnosis Agent (AGENTS.md §8): why one post did what it did, and one next
// experiment. Stored in `content_diagnoses.diagnosis` as `{ schema_version: 1, ... }`.

export const DIAGNOSIS_SCHEMA_VERSION = 1;

export const FACTORS = ["topic", "hook", "format", "length", "timing", "audience_response", "cta", "other"] as const;
export type Factor = (typeof FACTORS)[number];

export const FACTOR_LABELS: Record<Factor, string> = {
  topic: "Topic",
  hook: "Hook",
  format: "Format",
  length: "Length",
  timing: "Timing",
  audience_response: "Audience response",
  cta: "Call to action",
  other: "Other",
};

export const CONFIDENCE_LABELS: Record<SignalLevel, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

export const MAX_FACTORS = 4;
export const MAX_CAVEATS = 3;
/** Fewer other settled posts than this caps every factor at `medium`. */
export const MEDIUM_CONFIDENCE_PEERS = 8;
/** Fewer other settled posts than this (no baseline) caps every factor at `low`. */
export const LOW_CONFIDENCE_PEERS = 3;

// ---------------------------------------------------------------------------
// Model-facing schema (OpenAI strict mode: every key present, no optionals)
// ---------------------------------------------------------------------------

export const diagnosisModelSchema = z.object({
  headline: z.string(),
  what_happened: z.string(),
  factors: z.array(
    z.object({
      factor: z.enum(FACTORS),
      observation: z.string(),
      evidence: z.string(),
      confidence: signalLevel,
    }),
  ),
  next_experiment: z.object({
    change: z.string(),
    why: z.string(),
    how_to_tell: z.string(),
    idea: z.object({ topic: z.string(), angle: z.string(), format: z.string().nullable() }),
  }),
  caveats: z.array(z.string()),
});
export type DiagnosisModelOutput = z.infer<typeof diagnosisModelSchema>;

// ---------------------------------------------------------------------------
// App validation
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max);

export const diagnosisOutput = z.object({
  headline: text(160),
  what_happened: text(600),
  factors: z
    .array(
      z.object({
        factor: z.enum(FACTORS),
        observation: text(300),
        evidence: text(300),
        confidence: signalLevel,
      }),
    )
    .min(1)
    .max(MAX_FACTORS),
  next_experiment: z.object({
    change: text(200),
    why: text(300),
    how_to_tell: text(200),
    idea: z.object({
      topic: text(120),
      angle: text(300),
      format: z
        .string()
        .trim()
        .max(60)
        .nullable()
        .transform((value) => (value === "" ? null : value)),
    }),
  }),
  caveats: z.array(text(200)).max(MAX_CAVEATS),
});
export type Diagnosis = z.infer<typeof diagnosisOutput>;

export const parseDiagnosisOutput = (input: unknown) => parseWith(diagnosisOutput, input);

// ---------------------------------------------------------------------------
// Honesty rules (deterministic, applied before storing)
// ---------------------------------------------------------------------------

const RANK: Record<SignalLevel, number> = { low: 0, medium: 1, high: 2 };

export interface EvidenceStrength {
  /** The post's latest results are at least a week after posting. */
  settled: boolean;
  /** Days from posting to the latest results. */
  ageDays: number;
  /** The creator's other settled posts on the platform. */
  peers: number;
}

export const earlyCaveat = (ageDays: number) =>
  `These are early results (day ${ageDays}). Diagnose again after day 7.`;

/**
 * Caps confidence by how much evidence exists, and makes sure early results
 * say so. One post, or a thin history, is never presented as a firm pattern.
 */
export function applyHonestyRules(
  diagnosis: Diagnosis,
  strength: EvidenceStrength,
): { diagnosis: Diagnosis; capped: boolean } {
  const ceiling: SignalLevel =
    !strength.settled || strength.peers < LOW_CONFIDENCE_PEERS
      ? "low"
      : strength.peers < MEDIUM_CONFIDENCE_PEERS
        ? "medium"
        : "high";
  let capped = false;
  const factors = diagnosis.factors.map((f) => {
    if (RANK[f.confidence] <= RANK[ceiling]) return f;
    capped = true;
    return { ...f, confidence: ceiling };
  });

  let caveats = diagnosis.caveats;
  if (!strength.settled) {
    const caveat = earlyCaveat(strength.ageDays);
    if (!caveats.includes(caveat)) caveats = [caveat, ...caveats].slice(0, MAX_CAVEATS);
  }
  return { diagnosis: { ...diagnosis, factors, caveats }, capped };
}

// ---------------------------------------------------------------------------
// Stored rows
// ---------------------------------------------------------------------------

export const storedDiagnosis = diagnosisOutput.extend({
  schema_version: z.literal(DIAGNOSIS_SCHEMA_VERSION),
  confidence_capped: z.boolean(),
});
export type StoredDiagnosis = z.infer<typeof storedDiagnosis>;

export function toStoredDiagnosis(diagnosis: Diagnosis, capped: boolean): StoredDiagnosis {
  return { schema_version: DIAGNOSIS_SCHEMA_VERSION, confidence_capped: capped, ...diagnosis };
}

/** An unknown version or invalid content is "unreadable": the UI shows an error state, never a crash. */
export function parseStoredDiagnosis(input: unknown): { ok: true; diagnosis: StoredDiagnosis } | { ok: false } {
  const parsed = storedDiagnosis.safeParse(input);
  return parsed.success ? { ok: true, diagnosis: parsed.data } : { ok: false };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type DiagnosisErrorCode =
  | AiErrorCode
  | "not_found"
  | "no_results"
  | "missing_context"
  | "post_limit"
  | "in_progress"
  | "idea_failed";

export const DIAGNOSIS_ERRORS: Record<DiagnosisErrorCode, { message: string; retryable: boolean }> = {
  ...AI_ERRORS,
  not_found: {
    message: "We couldn't find that post. Refresh the page to see your current posts.",
    retryable: false,
  },
  no_results: { message: "Add results first, then ask for a diagnosis.", retryable: false },
  missing_context: {
    message: "Finish your creator profile first, so the diagnosis can use your goals and audience.",
    retryable: false,
  },
  post_limit: {
    message: "You've diagnosed this post 3 times today. Try again tomorrow, or add new results first.",
    retryable: false,
  },
  in_progress: {
    message: "A diagnosis is already running. Wait a moment, then refresh the page.",
    retryable: false,
  },
  idea_failed: { message: "We couldn't save this idea right now. Please try again.", retryable: true },
};
