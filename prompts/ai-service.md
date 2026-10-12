# AI Service (OpenAI, Vercel AI SDK, Model Routing, Prompt Registry)

Phase 1 (Foundation), item "AI service (Vercel AI SDK, model routing, prompt organization)" in `PHASES.md`.

## Goal

Build the one reusable, server-only path every future AI feature goes through (AGENTS.md §9 and §19). It does the following on each call:

1. Checks the creator's usage limit.
2. Calls OpenAI through the Vercel AI SDK, using a model chosen by a routing layer.
3. Validates the output against a Zod schema.
4. Records the call in `ai_generations` and `usage_events` (tokens, latency, cost).
5. Returns a typed result that never throws, so the UI can recover from any failure.

This builds the infrastructure only. It adds no creator-facing AI feature, no UI, no route, and no strategy, opportunity or content prompts. Those arrive in Phases 2 to 4 and plug into this.

## Skills Read

- `supabase` and `supabase-postgres-best-practices` (re-read for the service-role write path and the rolling-window limit query).
- `claude-api`: **not applicable.** The provider is OpenAI, so no Anthropic SDK code is written. I used its pricing and structured-output notes only as background for the recommendation.
- No Vercel AI SDK skill exists in `.agents/skills/`, so the SDK facts below come from its current official docs, fetched this session (decision 1).

## Existing Code Inspected

- Both `AGENTS.md` files: §9 (AI service rules, 9-step capability checklist, prompt management, model routing, fallbacks, safety), §19 (usage and cost controls), §21 (no private data in logs), §22 (data sent to AI providers). §5 already names OpenAI as the default provider, so no `AGENTS.md` change is needed.
- `supabase/migrations/20261009000100_core_schema.sql`: `ai_generations` (`kind`, `model`, `prompt_version`, `status` of `pending|succeeded|failed`, `input_tokens`, `output_tokens`, `latency_ms`, `error_code`, `completed_at`, optional item and idea links) and `usage_events` (`event_type`, `quantity`, `cost_micros`, `ai_generation_id`, `metadata`). The index `ai_generations_user_id_created_at_idx` already supports the limit query.
- `…000200_rls_policies.sql`: both tables are **read-only** to `authenticated`. Only the service role can write them, so this service writes through `createAdminClient()`.
- `lib/supabase/admin.ts`, `server.ts`, `env.ts`: the pattern for lazy env validation and the `server-only` import. I will follow it.
- `lib/schemas/*` (`parseWith`, `parseContentPackage` and the others): the validation layer AI output must pass.
- `lib/services/users.ts`: the fail-soft result-object pattern (`{ ok: true } | { ok: false }`). I will follow it.
- `package.json`: no `ai` or `@ai-sdk/openai`. `zod` 4.6 is installed. `vitest.config.mts` has an `@/` alias but no stub for `server-only`.
- No `lib/ai/`, no prompts folder, no `OPENAI_API_KEY` in `.env.example`.
- Docs fetched this session: the AI SDK structured-output page, the AI SDK OpenAI provider page, and OpenAI's models page.

## Decisions / Assumptions

1. **AI SDK API (from the docs, not memory).** Install `ai` and `@ai-sdk/openai`. Structured output is `generateText({ model, output: Output.object({ schema }) })`, and the typed value is `result.output`. Invalid output rejects with `NoObjectGeneratedError` (checked with `.isInstance(error)`); reading a missing output throws `NoOutputGeneratedError`. The provider is `openai('<model-id>')`, which uses OpenAI's Responses API. The key comes from `OPENAI_API_KEY`. I will confirm `result.usage` field names against the installed package's types, since the docs page didn't show them. Zod 4 compatibility is also checked at install. If either fails, I stop and report instead of working around it.
2. **Models and routing.** Two tiers, each mapped to a model ID. IDs and prices are from OpenAI's models page this session.
   - `quality` → `gpt-6.1-sol` ($2 in / $10 out per million tokens), reasoning effort `medium`. For strategy, opportunities, content packages and diagnosis.
   - `fast` → `gpt-6-luna` ($0.10 / $0.50), reasoning effort `low`. For rewrites, variations and tagging.
   - Each task kind maps to a tier in one routing table. `AI_MODEL_QUALITY` and `AI_MODEL_FAST` environment variables override the model IDs, so models can change without code edits. The default effort is `medium` and the page lists `low` as valid for both models.
3. **OpenAI strict structured outputs reject optional fields.** The AI SDK OpenAI provider's strict-schema mode (on by default) wants every property present, with `.nullable()` instead of `.optional()`. The schemas I wrote last step (for example the content package) use `.optional()`, so they can't be handed to the model unchanged. The service therefore expects a model-facing schema, and the caller then maps the result into the app schema with `parseWith`. This item documents the rule and tests it with a compatible sample schema. The nullable variants of the real schemas are written with each feature in Phases 2 to 4.
4. **The service stores metadata only.** `ai_generations` records kind, model, prompt version, tokens, latency, status and an error code. It does **not** store prompt or response text. Features persist their own validated artifacts (strategy, ideas, versions) where they belong. This keeps creator content out of the logging tables.
5. **OpenAI-side storage is switched off.** Every call sets `providerOptions.openai.store = false`, because the Responses API stores responses by default. Sending creator data to OpenAI is still a privacy-policy item, and the report will say so.
6. **Cost is computed from a versioned price table** (`lib/ai/pricing.ts`) keyed by model ID, in USD per million tokens. `cost_micros = ceil(input_tokens × input_price + output_tokens × output_price)` (a $/MTok price equals µ$/token). Cached-input discounts are ignored, so recorded cost is a conservative upper bound. An unknown model records tokens with `cost_micros = null` and logs a warning rather than guessing.
7. **Usage limits.**
   - A per-creator rolling 24-hour cap on generations, default **25**, set by `AI_DAILY_GENERATION_LIMIT`. The count is of `ai_generations` rows in the last 24 hours, excluding provider failures (rows with `status = 'failed'` and an `error_code` other than `invalid_output`), so an outage doesn't burn a creator's allowance but a model returning bad output does.
   - A kill switch, `AI_ENABLED=false`, returns `disabled` without calling OpenAI.
   - Plan-based limits (free versus paid) arrive with billing in Phase 6.
   - The check-then-insert is not atomic, so two simultaneous requests can exceed the cap by a small amount. I judge that acceptable for cost control and will say so rather than hide it.
8. **Bounded calls.** Each call has a per-kind `maxOutputTokens`, a 60-second timeout via an abort signal, and at most 1 SDK retry. There are no agent loops, and tools are not used.
9. **Prompts are versioned files**, not strings in components: `lib/ai/prompts/<kind>/v<N>.ts`, each exporting `{ kind, version, system, buildUser(input) }`, plus a registry that resolves the active version. `ai_generations.prompt_version` records which one ran. This item ships the mechanism and a single `smoke_test` prompt used only by the live test.
10. **Identity is the caller's responsibility.** `userId` is passed in by server code that obtained it from Clerk's verified session. The service never accepts an id from the browser. It writes with the admin client because both tables are server-owned, and it takes that `userId` from its own argument only.
11. **No route handler or server action in this item.** Nothing in the app calls the service yet, and exposing an HTTP endpoint would only be a fake feature (AGENTS.md §14).
12. **Tests.** Vitest unit tests run against the AI SDK's mock language model (I'll confirm the export name from `ai/test`) and a fake Supabase client. Real OpenAI calls only happen in an opt-in live test, which is skipped unless `RUN_LIVE_AI=1`. `server-only` is stubbed for Vitest.

## Files Likely to Change

| File | Change |
|---|---|
| `package.json`, `pnpm-lock.yaml` | Add `ai`, `@ai-sdk/openai`; add `test:live` script |
| `lib/ai/env.ts` (new) | Lazy Zod validation of `OPENAI_API_KEY` and the optional settings (decisions 2, 7) |
| `lib/ai/models.ts` (new) | Tier → model ID, effort, per-kind routing table, env overrides |
| `lib/ai/pricing.ts` (new) | Price table and `costMicros()` |
| `lib/ai/prompts/registry.ts`, `lib/ai/prompts/smoke_test/v1.ts` (new) | Versioned prompt mechanism |
| `lib/ai/limits.ts` (new) | Rolling-window usage check |
| `lib/ai/errors.ts` (new) | Error codes, user-safe messages, mapping from SDK errors |
| `lib/ai/run-structured.ts` (new) | The core wrapper |
| `lib/ai/index.ts` (new) | Server-only entry point (`import "server-only"`) |
| `tests/ai/*.test.ts` (new) | See Checks |
| `tests/stubs/server-only.ts` (new), `vitest.config.mts` | Alias `server-only` to an empty stub |
| `.env.example` | Add `OPENAI_API_KEY` and the optional variables, names only |
| `PHASES.md` | Tick the AI service item |

## Database Changes

None. The existing `ai_generations`, `usage_events` and their index cover this. If testing shows a missing column or constraint, I stop and report instead of editing an applied migration.

## Implementation Requirements

`runStructured({ userId, kind, input, schema, validate? })` does the following, in order:

1. If `AI_ENABLED=false`, return `{ ok: false, code: "disabled" }`.
2. Read the config. If `OPENAI_API_KEY` is missing, return `not_configured` and log the event name only.
3. Check the rolling-24-hour limit. If reached, return `limit_reached` **without calling OpenAI**.
4. Insert an `ai_generations` row with `status: "pending"`, `kind`, `model` and `prompt_version`.
5. Call `generateText` with the routed model, the prompt from the registry, `Output.object({ schema })`, `maxOutputTokens`, the abort signal, `store: false`, and the reasoning effort.
6. On success, optionally run `validate` (the app-level schema via `parseWith`). If it fails, treat it as `invalid_output`.
7. Update the `ai_generations` row: `status`, token counts, `latency_ms`, `completed_at`, and `error_code` when failed.
8. On success, insert one `usage_events` row (`event_type: "ai_generation"`, `quantity: 1`, `cost_micros`, `ai_generation_id`, `metadata: { kind, model, tier }`).
9. Return `{ ok: true, data, generationId, usage }`.

On failure the function returns `{ ok: false, code, message, retryable }`, never an exception:

| Code | When | `retryable` |
|---|---|---|
| `disabled` | Kill switch on | no |
| `not_configured` | No API key | no |
| `limit_reached` | Daily cap hit | no |
| `invalid_output` | Schema or `validate` failed (`NoObjectGeneratedError`) | yes |
| `rate_limited` | Provider 429 | yes |
| `timeout` | Abort or timeout | yes |
| `provider_error` | Any other provider or network error | yes |
| `persistence_error` | The pending-row insert failed | yes |

- Messages are written for creators and say what to do next. They never include provider text, ids or prompts.
- If recording the result to the database fails **after** a successful generation, the data is still returned and the failure is logged, because losing a paid result is worse than an unrecorded row.
- Logging uses a stable event name (for example `ai_generation_failed`) with `kind`, `model`, `code` and `latency_ms` only. It never logs prompts, responses, user ids or emails.

## AI Behavior

- **Input context:** none yet. Callers build creator context (a Phase 2 item) and pass only what the task needs. The service doesn't fetch creator data itself, which keeps unrelated private data out of OpenAI requests (AGENTS.md §22).
- **Prompt behavior:** versioned and organized as in decision 9. The `smoke_test` prompt only returns a tiny fixed-shape object.
- **Model behavior:** routed by tier (decision 2), with effort and token ceilings per kind.
- **Structured output:** `Output.object` with a Zod schema that follows decision 3's strict-mode rule.
- **Validation:** SDK-level schema validation plus an optional app-level `validate`.
- **Error handling:** the table above. The UI gets a result object and decides what to show.
- **Persistence:** metadata only, in `ai_generations` and `usage_events` (decision 4).
- **Usage controls:** daily cap, kill switch, output-token ceiling, timeout, and a single retry. Any "regenerate" button built later must go through this same path so it is capped the same way.
- **Safety:** impersonation, spam and deceptive-engagement rules (AGENTS.md §9) belong in each feature's prompt and are added with those prompts. The service does not claim to enforce them.

## Security Requirements

- `OPENAI_API_KEY` is read only in server code, lazily, and is never prefixed with `NEXT_PUBLIC_`. `lib/ai/index.ts` imports `server-only` so a client import fails the build. The key is never logged or included in error text.
- Writes to `ai_generations` and `usage_events` go through `createAdminClient()` (RLS bypass is required because creators can't write these tables, by design). Each row's `user_id` comes only from the verified `userId` argument.
- No browser-supplied model name, limit or user id is accepted. Callers choose `kind`, and `kind` selects the model.
- OpenAI response storage is off (decision 5). Creator data sent to OpenAI must be disclosed in the privacy policy before public launch.
- Prompt and response bodies are never logged or stored.

## Acceptance Criteria

1. A successful call returns validated typed data, records one `ai_generations` row (`succeeded`, with tokens and latency) and one `usage_events` row with a non-null `cost_micros`.
2. Malformed or schema-violating model output returns `invalid_output` and records a `failed` row. It does not throw and does not insert a `usage_events` row.
3. Provider rate-limit, timeout and generic errors map to `rate_limited`, `timeout` and `provider_error` with `retryable: true`.
4. Once a creator has reached the cap, the next call returns `limit_reached` and **makes no model call**. A failed provider call does not count toward the cap.
5. With `AI_ENABLED=false` or no `OPENAI_API_KEY`, the result is `disabled` or `not_configured`, with no model call and no database write.
6. Changing `AI_MODEL_QUALITY` changes the model used without code changes.
7. Logs from a failing call contain no prompt text, response text, user id or key.
8. Importing `lib/ai` from client code fails the build.
9. `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` pass. The live test passes when run against a real key.

## Checks

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build      # required: new server modules and config
pnpm test:live  # opt-in, spends a fraction of a cent; needs OPENAI_API_KEY + Supabase env
```

New automated tests (all offline):
- `tests/ai/run-structured.test.ts`: success path and the two rows written; invalid output; each provider-error mapping; limit reached with no model call; the provider-failure exclusion from the count; disabled and not-configured; DB failure after success still returns data; logs contain no prompt or id.
- `tests/ai/models.test.ts`: routing per kind, env override, unknown kind rejected.
- `tests/ai/pricing.test.ts`: cost arithmetic and rounding up, unknown model gives null.
- `tests/ai/prompts.test.ts`: registry resolves the active version; every prompt has a kind and version.
- `tests/ai/strict-schema.test.ts`: documents decision 3 by asserting the sample schema has no optional keys.
- `tests/ai/live.test.ts`: skipped unless `RUN_LIVE_AI=1`. It creates a temporary `users` row through the admin client, runs the `smoke_test` prompt for real, asserts the two rows, then deletes the user (cascade).

## Manual Test Procedure

1. Create an OpenAI account at platform.openai.com, add billing, and **set a low monthly spend limit** (for example $5) in the billing settings. Create an API key.
2. Add `OPENAI_API_KEY=...` to `.env.local` yourself. Don't paste the key into this chat.
3. Run `pnpm test:live` with `RUN_LIVE_AI=1`. It should pass in a few seconds.
4. While it runs, or just after, open Supabase Table Editor. The temporary user is deleted by the test, so to inspect the rows, run the test with `KEEP_AI_SMOKE_ROWS=1` (it then skips the delete). `ai_generations` should show one `succeeded` row with `model`, `prompt_version`, token counts and latency. `usage_events` should show one row with a small `cost_micros` (a few hundred at most).
5. In the OpenAI dashboard's usage page, confirm the call appears with a matching small cost.
6. Set `AI_DAILY_GENERATION_LIMIT=1` and run the live test twice in a row. The second run should report `limit_reached` and no new OpenAI usage.
7. Clean up with `delete from public.users where id = 'user_ai_smoke';`.

## UI

No UI.

## Known Limitations / Follow-ups

- Nothing in the app calls the service yet. The first consumer is Phase 2's strategy generation.
- The daily cap isn't strictly atomic (decision 7), and stale `pending` rows from a crash count toward the cap until a cleanup job exists.
- Cost ignores cached-input discounts and is an upper bound.
- Plan-based limits wait for billing (Phase 6). Observability (Sentry) replaces `console.error` in the next Phase 1 item.
- Nullable, strict-mode-compatible versions of the content, idea and insight schemas come with those features (decision 3).
- Model IDs and prices come from OpenAI's pages as of this session and need re-checking when you deploy.
