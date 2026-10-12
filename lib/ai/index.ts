import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/observability/log";
import { SupabaseEnvError } from "@/lib/supabase/env";
import { AI_ERRORS } from "./errors";
import type { AiKind } from "./prompts/registry";
import {
  runStructuredWith,
  type AiResult,
  type RunStructuredDeps,
  type RunStructuredRequest,
} from "./run-structured";

/**
 * Server-only entry point for every AI feature. `server-only` makes any import
 * from client code fail the build, so the OpenAI key never reaches a browser.
 */

export function createDefaultDeps(): RunStructuredDeps {
  return {
    db: createAdminClient(),
    languageModel: (modelId, apiKey) => createOpenAI({ apiKey })(modelId),
  };
}

/**
 * Runs one structured AI task for a creator. `userId` must come from Clerk's
 * verified server session.
 */
export function runStructured<K extends AiKind, Output, Data = Output>(
  request: RunStructuredRequest<K, Output, Data>,
): Promise<AiResult<Data>> {
  let deps: RunStructuredDeps;
  try {
    deps = createDefaultDeps();
  } catch (error) {
    // Supabase env missing or invalid; the result type promises no throw.
    const variables = error instanceof SupabaseEnvError ? error.variables : [];
    logEvent("error", "ai_not_configured", { kind: request.kind, variables });
    return Promise.resolve({ ok: false, code: "not_configured", ...AI_ERRORS.not_configured });
  }
  return runStructuredWith(deps, request);
}

export type { AiResult, AiUsage, RunStructuredRequest } from "./run-structured";
export type { AiErrorCode } from "./errors";
export type { AiKind, PromptInput } from "./prompts/registry";
export type { AiTier } from "./models";
