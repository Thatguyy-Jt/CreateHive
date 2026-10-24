import type { OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import { generateText, NoObjectGeneratedError, Output, type LanguageModel, type LanguageModelUsage } from "ai";
import type { z } from "zod";
import { getAllowance } from "@/lib/billing/allowance";
import { allowanceFor } from "@/lib/billing/features";
import { logEvent } from "@/lib/observability/log";
import type { ParseResult } from "@/lib/schemas/parse";
import { isAiEnabled, readAiConfig, type EnvSource } from "./env";
import { AI_ERRORS, classifyProviderError, type AiErrorCode } from "./errors";
import { checkDailyLimit, checkMonthlyAllowance, type AiDbClient } from "./limits";
import { routeTask, type AiTier } from "./models";
import { costMicros } from "./pricing";
import { getPrompt, type AiKind, type PromptInput } from "./prompts/registry";

export const AI_CALL_TIMEOUT_MS = 60_000;
export const AI_MAX_RETRIES = 1;

export interface RunStructuredDeps {
  /** Service-role client: `ai_generations` and `usage_events` are server-owned. */
  db: AiDbClient;
  /** Builds the provider model for a routed model ID. */
  languageModel: (modelId: string, apiKey: string) => LanguageModel;
  env?: EnvSource;
  now?: () => number;
}

export interface RunStructuredRequest<K extends AiKind, Output, Data> {
  /** Clerk user id from the verified server session. Never from the browser. */
  userId: string;
  kind: K;
  /** Only what this task needs; the service fetches no creator data itself. */
  input: PromptInput<K>;
  /**
   * Model-facing schema. OpenAI strict mode needs every property present: use
   * `.nullable()`, never `.optional()`.
   */
  schema: z.ZodType<Output>;
  /** Optional app-level validation, typically `(o) => parseWith(appSchema, o)`. */
  validate?: (output: Output) => ParseResult<Data>;
}

export interface AiUsage {
  model: string;
  tier: AiTier;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  costMicros: number | null;
}

export type AiResult<Data> =
  | { ok: true; data: Data; generationId: string; usage: AiUsage }
  | { ok: false; code: AiErrorCode; message: string; retryable: boolean };

// Stable event names with kind, model, code and latency only: never prompts,
// responses, user ids, emails or keys. `logEvent` enforces that with types.
const log = logEvent;

function fail<Data>(code: AiErrorCode): AiResult<Data> {
  return { ok: false, code, ...AI_ERRORS[code] };
}

function tokenCounts(usage: LanguageModelUsage | undefined) {
  return { input: usage?.inputTokens ?? null, output: usage?.outputTokens ?? null };
}

/**
 * The one path for AI calls: kill switch → config → daily limit → pending row
 * → model call with structured output → validation → metering. Never throws;
 * every failure becomes `{ ok: false, code }` so the UI can recover.
 */
export async function runStructuredWith<K extends AiKind, Output, Data = Output>(
  deps: RunStructuredDeps,
  request: RunStructuredRequest<K, Output, Data>,
): Promise<AiResult<Data>> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const { kind } = request;

  if (!isAiEnabled(env)) return fail("disabled");

  const configResult = readAiConfig(env);
  if (!configResult.ok) {
    log("error", "ai_not_configured", { kind, variables: configResult.variables });
    return fail("not_configured");
  }
  const { config } = configResult;

  let route: ReturnType<typeof routeTask>;
  let prompt: ReturnType<typeof getPrompt<K>>;
  try {
    route = routeTask(kind, config.modelOverrides);
    prompt = getPrompt(kind);
  } catch {
    log("error", "ai_unknown_kind", { kind: String(kind) });
    return fail("not_configured");
  }
  const model = route.modelId;

  try {
    // Daily abuse guard: the same on every plan.
    const limit = await checkDailyLimit(deps.db, request.userId, config.dailyGenerationLimit, now());
    // Fail closed: without a count there is no cost control.
    if (!limit.ok) {
      log("error", "ai_limit_check_failed", { kind, model, db_code: limit.code });
      return fail("persistence_error");
    }
    if (limit.reached) return fail("limit_reached");

    // The plan's monthly allowance for this task (Free unless they pay).
    const { plan } = await getAllowance(deps.db, request.userId, now(), env);
    const allowance = allowanceFor(plan.id, kind);
    if (allowance !== null) {
      const monthly = await checkMonthlyAllowance(deps.db, request.userId, kind, allowance, now());
      if (!monthly.ok) {
        log("error", "ai_limit_check_failed", { kind, model, stage: "monthly", db_code: monthly.code });
        return fail("persistence_error");
      }
      if (monthly.reached) return fail(plan.id === "free" ? "upgrade_required" : "plan_limit");
    }

    const pending = await deps.db
      .from("ai_generations")
      .insert({
        user_id: request.userId,
        kind,
        model,
        prompt_version: prompt.version,
        status: "pending",
      })
      .select("id")
      .single();
    if (pending.error || !pending.data) {
      log("error", "ai_generation_start_failed", { kind, model, db_code: pending.error?.code });
      return fail("persistence_error");
    }
    const generationId = pending.data.id;

    const started = now();
    let output: Output;
    let usage: LanguageModelUsage | undefined;
    let failure: AiErrorCode | null = null;
    try {
      const result = await generateText({
        model: deps.languageModel(model, config.apiKey),
        instructions: prompt.system,
        prompt: (prompt.buildUser as (input: PromptInput<K>) => string)(request.input),
        output: Output.object({ schema: request.schema }),
        maxOutputTokens: route.maxOutputTokens,
        reasoning: route.reasoning,
        maxRetries: AI_MAX_RETRIES,
        timeout: AI_CALL_TIMEOUT_MS,
        providerOptions: {
          openai: {
            // The Responses API stores responses by default; keep creator data out.
            store: false,
            // Summaries are never shown or stored, so don't generate them.
            reasoningSummary: null,
          } satisfies OpenAILanguageModelResponsesOptions,
        },
      });
      usage = result.totalUsage;
      output = result.output;
    } catch (error) {
      failure = classifyProviderError(error);
      // A schema miss still consumed tokens; record them.
      if (NoObjectGeneratedError.isInstance(error)) usage = error.usage;
      output = undefined as Output;
    }

    let data: Data | undefined;
    if (failure === null) {
      if (request.validate) {
        const validated = request.validate(output);
        if (validated.ok) data = validated.data;
        else failure = "invalid_output";
      } else {
        data = output as unknown as Data;
      }
    }

    const latencyMs = Math.max(0, Math.round(now() - started));
    const tokens = tokenCounts(usage);
    const update = await deps.db
      .from("ai_generations")
      .update({
        status: failure === null ? "succeeded" : "failed",
        input_tokens: tokens.input,
        output_tokens: tokens.output,
        latency_ms: latencyMs,
        completed_at: new Date(now()).toISOString(),
        error_code: failure,
      })
      .eq("id", generationId)
      .eq("user_id", request.userId);
    if (update.error) {
      log("error", "ai_generation_record_failed", { kind, model, db_code: update.error.code });
    }

    if (failure !== null) {
      log("error", "ai_generation_failed", { kind, model, code: failure, latency_ms: latencyMs });
      return fail(failure);
    }

    const cost =
      tokens.input === null || tokens.output === null ? null : costMicros(model, tokens.input, tokens.output);
    if (cost === null) log("warn", "ai_cost_unknown", { kind, model });

    // A paid result is returned even if metering fails; the failure is logged.
    const metered = await deps.db.from("usage_events").insert({
      user_id: request.userId,
      event_type: "ai_generation",
      quantity: 1,
      cost_micros: cost,
      ai_generation_id: generationId,
      metadata: { kind, model, tier: route.tier },
    });
    if (metered.error) {
      log("error", "ai_usage_record_failed", { kind, model, db_code: metered.error.code });
    }

    return {
      ok: true,
      data: data as Data,
      generationId,
      usage: {
        model,
        tier: route.tier,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        latencyMs,
        costMicros: cost,
      },
    };
  } catch (error) {
    // Unexpected (for example a network failure talking to Supabase). The
    // pending row, if any, counts until the daily maintenance job marks it
    // `abandoned` (lib/jobs/daily-maintenance.ts).
    log("error", "ai_generation_unexpected", {
      kind,
      model,
      code: error instanceof Error ? error.name : typeof error,
    });
    return fail("persistence_error");
  }
}
