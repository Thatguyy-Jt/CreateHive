# Core Types and Supabase Client

Phase 1 (Foundation), item "Core types (generated DB types, shared Zod schemas)" in `PHASES.md`, plus the minimum Supabase wiring those types need to be useful: a Clerk-authenticated server client and creation of the creator's `users` row on first sign-in.

## Goal

1. Generate TypeScript types from the live schema so every database call is typed.
2. Add shared Zod schemas for the JSONB columns and constrained text columns, so AI output and user input are validated before they reach the database (AGENTS.md §9), and keep those schemas from drifting away from the database.
3. Add the server-only Supabase clients: one that acts as the signed-in creator (RLS applies) and one service-role client for trusted server work.
4. Make sure a `users` row exists for every signed-in creator, because every other table references it.

No new product features, no UI, no AI calls. Phase 2 (onboarding, profile, strategy) builds directly on this.

## Skills Read

- `supabase` (Data API/RLS checklist; "never expose service_role"; verify against docs; pin versions)
- `supabase-postgres-best-practices` (re-checked only for the upsert/data-access rules)
- `clerk-nextjs-patterns` (`auth()` and `getToken()` usage in server code)

`clerk-webhooks` is deliberately not used. Syncing `users` through a webhook is a later item (decision 6).

## Existing Code Inspected

- `supabase/migrations/20261009000100_core_schema.sql` and `…000200_rls_policies.sql`: the schema, and the exact grants. Relevant: `authenticated` may `select` and `insert` on `users` and may `update` only `display_name`; there is no grant for updating `email`. `subscriptions`, `usage_events` and `ai_generations` are read-only to `authenticated`.
- `tests/db/helpers.ts`, `tests/db/*.test.ts`, `vitest.config.mts`: PGlite harness that applies the real migrations. I will reuse `createTestDb()` for the schema-parity test.
- `proxy.ts`: bare `clerkMiddleware`; routes protect themselves with `auth.protect()`.
- `app/app/layout.tsx`: `RequireSession` runs `auth.protect()` inside `<Suspense>` because `cacheComponents: true` forbids request data in the static shell. `app/app/page.tsx` has its own `auth.protect()`.
- `next.config.ts`: `cacheComponents: true`. Server modules reading request data must stay out of the static shell.
- `package.json`: no `@supabase/supabase-js`, `zod`, or `server-only`. Scripts: `dev`, `build`, `lint`, `typecheck`, `test`.
- `.env.example`: Clerk variables only. No Supabase variables.
- `lib/`: only `app-shell/` and `marketing/`. No data layer or schemas.
- Supabase docs (fetched): Clerk third-party auth page and type-generation page. The Clerk page gives the pattern (pass a callback returning the Clerk session token as the client's access token) but no Next.js code, so the Next.js code is mine and gets verified by the manual procedure.

## Decisions / Assumptions

1. **Packages (pinned via lockfile):** `@supabase/supabase-js`, `zod`, `server-only`. **Not** `@supabase/ssr`: it exists to manage Supabase Auth cookies, and this app uses Clerk for sessions.
2. **Two server clients, no browser client.**
   - `createUserClient()` returns a client whose `accessToken` callback returns the current Clerk session token (`(await auth()).getToken()`), so requests run as `authenticated` with the creator's `sub` and RLS applies. Created per request, never cached or shared across requests.
   - `createAdminClient()` uses the secret (service-role) key and bypasses RLS. It is for webhooks, the AI service, metering and background jobs. Its module imports `server-only`, so importing it from a client component fails the build.
   - No browser Supabase client. AGENTS.md §4 says the UI must not modify protected state directly, and nothing needs one yet. It can be added when a feature requires it.
3. **Env vars (server-only, no `NEXT_PUBLIC_` prefix):** `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`. They are read lazily and validated with Zod on first use, so `pnpm build` and the test suite do not need them. A missing variable raises a clear error naming the variable. `.env.example` gets the names only. I will not read or edit `.env.local`; you add the three values (Supabase → Project Settings → API).
4. **Generated types** live in `lib/supabase/database.types.ts`, produced by `supabase gen types typescript` against your linked project (schema `public`), and are committed. A `db:types` script regenerates them. The file is generated; nobody edits it by hand. I will confirm the exact flag with `--help` first, since the CLI changes between versions. If generation fails because the CLI isn't authenticated, I stop and tell you.
5. **Zod schemas live in `lib/schemas/`**, one file per area, re-exported from an index: enums for every text column constrained by a `check`, and JSON shapes for the JSONB columns. Their shapes are my proposal for the Phase 3 and 4 outputs and are intentionally small. Each can be extended later without a migration, since the columns are plain JSONB.
   - `content_ideas.evidence`: list of items `{ kind, summary, source?, source_url?, observed_at? }`, so a recommendation always carries where its evidence came from (AGENTS.md §12).
   - `content_versions.content`: the content package. Optional sections `hooks[]`, `script`, `shot_list[]`, `caption`, `cta`, `titles[]`, `thumbnail_concept`, `repurposing[]`, so one section can be regenerated without the rest (AGENTS.md §9).
   - `creator_insights.evidence`, `research_signals.payload`, `analytics_snapshots.raw`, `usage_events.metadata`: loose but typed. The first has a defined item shape; the last three are `record(string, unknown)` until their features define them.
   - A numeric opportunity "virality score" is deliberately not modelled (AGENTS.md §8).
6. **`users` row provisioning is lazy, from the app layout.** `ensureUser()` selects the creator's `users` row and inserts it if it is missing, as the creator, using the policies from the last migration. It runs inside the existing `RequireSession` component, so nothing is added to the static shell. It stores `id` and `email` only on first insert, because the user role cannot update `email` (by design). A Clerk webhook can keep `email` fresh later. It is **fail-soft**: a database or env error is logged and the page still renders, because AGENTS.md §14/§18 says an infrastructure failure must not crash the UI. Downstream features must therefore handle a missing row themselves, and the follow-up webhook item remains.
7. **Logging.** Errors go through `console.error` with a stable event name and no tokens, emails or row contents. Sentry arrives with the observability item.
8. **Service layer shape.** Server code gets typed clients from `lib/supabase/`, and feature logic goes in `lib/services/`. This change adds only `lib/services/users.ts`, which keeps the layout thin.
9. **Tests.** Vitest only, no Playwright. Pure modules (schemas, env parsing) get unit tests. `ensureUser` is tested against a small fake client. The Clerk token handoff cannot be tested without a live Clerk session, so it is covered by the manual procedure, and I will not claim otherwise.

## Files Likely to Change

| File | Change |
|---|---|
| `package.json`, `pnpm-lock.yaml` | Add `@supabase/supabase-js`, `zod`, `server-only`; add `db:types` script |
| `lib/supabase/database.types.ts` (new, generated) | Typed schema |
| `lib/supabase/env.ts` (new) | Lazy Zod validation of the three variables |
| `lib/supabase/server.ts` (new) | `createUserClient()` using the Clerk token |
| `lib/supabase/admin.ts` (new) | `createAdminClient()` using the secret key; imports `server-only` |
| `lib/schemas/*.ts`, `lib/schemas/index.ts` (new) | Enums and JSON shapes (decision 5) |
| `lib/services/users.ts` (new) | `ensureUser()` |
| `app/app/layout.tsx` | Call `ensureUser()` inside `RequireSession` after `auth.protect()` |
| `.env.example` | Add the three variable names |
| `tests/schemas/*.test.ts`, `tests/services/users.test.ts`, `tests/db/schema-parity.test.ts` (new) | See Checks |
| `PHASES.md` | Tick "Core types" |

## Database Changes

None. No migration, no policy change. The generated types describe the existing schema. If the parity test or the types reveal a mismatch in the schema, I will stop and report it rather than edit a migration that is already applied.

## Implementation Requirements

1. `createUserClient()`: obtains the token with Clerk's `auth()`, passes it to `createClient<Database>(url, publishableKey, { accessToken })`, and returns a typed client. If there is no session, calls fail through RLS (zero rows or permission error). It never falls back to the secret key.
2. `createAdminClient()`: `createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })`. Documented in its header comment as server-trusted-code only, never to be used for a request that should be limited to the signed-in creator.
3. `lib/schemas`: export each enum as a Zod enum plus its inferred type. Enum values must equal the database `check` lists exactly (verified by the parity test). Export typed parse helpers where useful, for example `parseContentPackage(json)` returning a result object instead of throwing, so callers can implement the "malformed AI output" path.
4. `ensureUser()`: input is the authenticated user's id and optional email obtained from Clerk server-side. It never accepts an id from the browser. Select-then-insert (not an upsert), because the creator role has no update grant on `email`. It handles the insert race (unique violation means success) and returns `{ ok: true } | { ok: false }`.
5. `RequireSession` stays a Suspense-wrapped async component. It calls `auth.protect()`, then `ensureUser()`, and ignores the result apart from logging.
6. No secret reaches client code: the admin module imports `server-only`, and no `NEXT_PUBLIC_` variable carries a Supabase secret.

## AI Behavior

No model calls and no prompts. The change adds the validation layer AI features will use. AI output for `content_versions.content` and `content_ideas.evidence` must pass these schemas before persistence. On failure the caller gets a typed error result, not an exception, so it can retry or show a recoverable error. The retry and persistence logic belongs to the AI-service item.

## Security Requirements

- The creator's identity comes only from the Clerk session on the server. The user client carries the creator's token, so RLS from the last migration is the enforcement layer, and nothing here weakens it.
- The service-role key is read only in `admin.ts`, only on the server, never logged, and never given a `NEXT_PUBLIC_` name. `.env.example` lists names only.
- `ensureUser` writes only `id` and `email` for the authenticated creator, and cannot create a row for anyone else (the `WITH CHECK` policy would reject it anyway).
- Logs exclude tokens, emails and row contents.
- No new tables, so no new data is stored beyond the `users` row. That row holds the Clerk id and email, is readable only by its owner and the server, is deleted with the account, and is not sent to any AI provider.

## Acceptance Criteria

1. `database.types.ts` exists, was generated from the linked project, and `createUserClient`/`createAdminClient` return clients typed with `Database`. A deliberately wrong column name in a query is a type error.
2. Each enum in `lib/schemas` matches the corresponding database `check` constraint, enforced by an automated parity test run against the real migrations.
3. Schemas accept a valid example and reject malformed input for: idea evidence, content package, and each enum. Unknown or empty sections do not crash parsing.
4. After signing in and opening `/app`, a row for the creator exists in `public.users` with their Clerk id. Reloading creates no duplicate and no error.
5. A second creator gets their own row and cannot read the first creator's row through the user client.
6. With the Supabase variables removed, `/app` still renders for a signed-in creator and the failure is logged without secrets. `pnpm build` does not require the variables.
7. Importing `lib/supabase/admin.ts` in a client component fails at build time.
8. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass.

## Checks

```bash
pnpm install
pnpm db:types        # regenerates lib/supabase/database.types.ts
pnpm typecheck
pnpm lint
pnpm test
pnpm build           # required: layout and server modules change
```

New automated tests:
- `tests/schemas/*.test.ts`: valid and invalid parsing for every schema.
- `tests/db/schema-parity.test.ts`: reads `pg_constraint` from the migrated PGlite database and compares each constrained column's allowed values with the Zod enums.
- `tests/services/users.test.ts`: `ensureUser` with a fake client: inserts when missing, no-ops when present, treats a unique violation as success, returns `{ ok: false }` on error without throwing.

## Manual Test Procedure

Prerequisite: add `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` to `.env.local`.

1. `pnpm dev`, sign in as creator A, open `/app`. It renders as before.
2. In the Supabase dashboard (Table Editor → `users`), confirm one row with A's Clerk id and email.
3. Reload `/app` a few times. Still exactly one row.
4. Sign in as a different creator B in another browser. A second row appears.
5. Stop the server, comment out `SUPABASE_SECRET_KEY` and `SUPABASE_URL`, restart, reload `/app`. The page still renders, and the terminal shows a logged `ensure_user_failed` event with no tokens. Restore the variables.
6. In the dashboard delete both test rows (`delete from public.users where id in (...)`). Creating them again by revisiting `/app` should work.

## UI

No visual change. The dashboard renders exactly as before.

## Out of scope / Follow-ups

Clerk `user.created`/`user.updated` webhook to keep `email` current; a browser Supabase client; pgvector columns; Storage; Zod schemas for onboarding forms (Phase 2); AI service and model routing; Sentry.
