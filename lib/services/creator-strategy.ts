import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_ERRORS, type AiErrorCode } from "@/lib/ai/errors";
import { getPrompt } from "@/lib/ai/prompts/registry";
import type { AiResult, RunStructuredRequest } from "@/lib/ai/run-structured";
import { logEvent } from "@/lib/observability/log";
import {
  platform as platformSchema,
  storedStrategyColumns,
  strategyModelSchema,
  strategyOutputFor,
  type AudienceProfile,
  type FormatStrategy,
  type Platform,
  type StrategyModelOutput,
  type StrategyOutput,
  type ThirtyDayPlan,
  type VoiceProfile,
} from "@/lib/schemas/creator";
import { parseWith } from "@/lib/schemas/parse";
import type { Database, Json } from "@/lib/supabase/database.types";
import { buildCreatorContext, renderContextForPrompt } from "./creator-context";

type StrategyClient = Pick<SupabaseClient<Database>, "from" | "rpc">;

/** A strategy generation still pending inside this window blocks another one. */
export const IN_FLIGHT_WINDOW_MS = 2 * 60 * 1000;

export type StrategyErrorCode = AiErrorCode | "missing_context" | "in_progress";

export type GenerateStrategyResult =
  | { ok: true; version: number }
  | { ok: false; code: StrategyErrorCode; message: string; retryable: boolean };

/** Creator-facing messages: what happened and what to do next. */
export const STRATEGY_ERRORS: Record<StrategyErrorCode, { message: string; retryable: boolean }> = {
  ...AI_ERRORS,
  invalid_output: { message: "Your strategy didn't come out right. Please try again.", retryable: true },
  persistence_error: {
    message: "We couldn't save your strategy. Please try again in a moment.",
    retryable: true,
  },
  limit_reached: {
    message:
      "You've used all of your AI generations for now. Your allowance frees up as generations age past 24 hours.",
    retryable: false,
  },
  missing_context: {
    message: "Finish your profile and voice first, so we can build a strategy that fits you.",
    retryable: false,
  },
  in_progress: {
    message: "Your strategy is already being built. Give it a minute, then refresh the page.",
    retryable: false,
  },
};

export function isStrategyErrorCode(value: string): value is StrategyErrorCode {
  return Object.hasOwn(STRATEGY_ERRORS, value);
}

function fail(code: StrategyErrorCode): GenerateStrategyResult {
  return { ok: false, code, ...STRATEGY_ERRORS[code] };
}

type RunStrategy = (
  request: RunStructuredRequest<"creator_strategy", StrategyModelOutput, StrategyOutput>,
) => Promise<AiResult<StrategyOutput>>;

export interface StrategyDeps {
  /** `runStructured` from `@/lib/ai`; injected so tests never reach a provider. */
  run: RunStrategy;
  now?: () => number;
}

/**
 * Strategy Agent: builds context from the creator's profile and brand voice,
 * generates a strategy through the AI service, validates it, and saves it with
 * its pillars in one transaction. Never throws.
 *
 * `client` acts as the creator (`createUserClient()`); `userId` comes from
 * Clerk's verified session. AI metering and the daily cap happen in `run`.
 */
export async function generateCreatorStrategy(
  client: StrategyClient,
  userId: string,
  deps: StrategyDeps,
): Promise<GenerateStrategyResult> {
  const now = deps.now ?? Date.now;
  try {
    const built = await buildCreatorContext(client, userId, { include: ["profile", "brand"] });
    if (!built.ok) return fail("persistence_error");
    const { context } = built;
    if (!context.profile || !context.brand) return fail("missing_context");

    const platforms = context.profile.platforms.filter((p): p is Platform => platformSchema.safeParse(p).success);
    if (platforms.length === 0) return fail("missing_context");

    const since = new Date(now() - IN_FLIGHT_WINDOW_MS).toISOString();
    const pending = await client
      .from("ai_generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "creator_strategy")
      .eq("status", "pending")
      .gte("created_at", since);
    if (pending.error) {
      logEvent("error", "strategy_generation_failed", { stage: "in_flight_check", db_code: pending.error.code });
      return fail("persistence_error");
    }
    if ((pending.count ?? 0) > 0) return fail("in_progress");

    const schema = strategyOutputFor(platforms);
    const result = await deps.run({
      userId,
      kind: "creator_strategy",
      input: { context: renderContextForPrompt(context), platforms },
      schema: strategyModelSchema,
      validate: (output) => parseWith(schema, output),
    });
    if (!result.ok) {
      logEvent("error", "strategy_generation_failed", { stage: "ai", code: result.code });
      return fail(result.code);
    }

    const { pillars, ...strategy } = result.data;
    const saved = await client.rpc("save_creator_strategy", {
      p_strategy: {
        ...strategy,
        prompt_version: getPrompt("creator_strategy").version,
        ai_generation_id: result.generationId,
      } as unknown as Json,
      p_pillars: pillars as unknown as Json,
    });
    if (saved.error || typeof saved.data !== "number") {
      logEvent("error", "strategy_save_failed", { stage: "rpc", db_code: saved.error?.code });
      return fail("persistence_error");
    }
    return { ok: true, version: saved.data };
  } catch (error) {
    logEvent("error", "strategy_generation_failed", {
      stage: "unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
    return fail("persistence_error");
  }
}

// ---------------------------------------------------------------------------
// Reading the stored strategy
// ---------------------------------------------------------------------------

export interface StoredStrategy {
  positioning: string;
  audience_profile: AudienceProfile;
  format_strategy: FormatStrategy;
  voice_profile: VoiceProfile;
  growth_objective: string;
  monetization_objective: string;
  thirty_day_plan: ThirtyDayPlan;
  notes: string | null;
  version: number;
  updated_at: string;
  pillars: { id: string; name: string; description: string | null }[];
}

export type GetStrategyResult = { ok: true; strategy: StoredStrategy | null } | { ok: false };

/** The creator's current strategy and active pillars, re-validated. Never throws. */
export async function getCreatorStrategy(
  client: Pick<SupabaseClient<Database>, "from">,
  userId: string,
): Promise<GetStrategyResult> {
  try {
    const [row, pillars] = await Promise.all([
      client
        .from("creator_strategies")
        .select(
          "positioning, audience_profile, format_strategy, voice_profile, growth_objective, monetization_objective, thirty_day_plan, notes, version, updated_at",
        )
        .eq("user_id", userId)
        .maybeSingle(),
      client
        .from("content_pillars")
        .select("id, name, description")
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("position", { ascending: true }),
    ]);
    if (row.error || pillars.error) {
      logEvent("error", "strategy_read_failed", { stage: "select", db_code: row.error?.code ?? pillars.error?.code });
      return { ok: false };
    }
    if (!row.data) return { ok: true, strategy: null };

    const columns = parseWith(storedStrategyColumns, row.data);
    if (!columns.ok) {
      logEvent("error", "strategy_read_failed", { stage: "validate" });
      return { ok: false };
    }
    return {
      ok: true,
      strategy: {
        ...columns.data,
        positioning: row.data.positioning,
        growth_objective: row.data.growth_objective,
        monetization_objective: row.data.monetization_objective,
        notes: row.data.notes,
        version: row.data.version,
        updated_at: row.data.updated_at,
        pillars: pillars.data ?? [],
      },
    };
  } catch (error) {
    logEvent("error", "strategy_read_failed", {
      stage: "unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
    return { ok: false };
  }
}
