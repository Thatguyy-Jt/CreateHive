# Database, Core Migrations, RLS and Data-Isolation Tests

Phase 1 (Foundation), items 3 and 4 in `PHASES.md`: "Database (Supabase PostgreSQL) and core migrations" and "Row Level Security policies and data-isolation tests".

## Goal

Create the Supabase/Postgres schema for the 16 core tables named in AGENTS.md §10, with Row Level Security on every table, so that a creator can never read or mutate another creator's data. Prove it with automated tests that run without Docker or a Supabase project.

This adds SQL migrations and tests only. It adds no UI, no server actions, no Supabase client wiring, no generated types and no Clerk webhook. Those are separate Phase 1 / Phase 2 items.

## Skills Read

- `supabase` (RLS security checklist, imperative-migration workflow, Data API exposure, `SECURITY DEFINER` warnings)
- `supabase-postgres-best-practices` (`security-rls-basics`, `security-rls-performance`; the `schema-*` rules are applied from the skill index: primary keys, data types, constraints, FK indexes, lowercase identifiers)

The `clerk-*` skills were not used. No Clerk code changes. The Clerk-to-Supabase token link is configuration (decision 2).

## Existing Code Inspected

- Both `AGENTS.md` files: §4 database layer, §10 table list and rules, §11 auth, §17 testing, §22 data handling.
- `PHASES.md`: the two Phase 1 items in scope, and which later phases use which tables.
- `package.json`: Next 16.4.0, `@clerk/nextjs`. No Supabase packages, no Vitest, no Playwright, no `test` script.
- Repo root: no `supabase/` directory, no migrations, no `config.toml`, no existing schema or types.
- `lib/`: only `app-shell/nav-items.ts` and `marketing/sample-data.ts`. No data layer.
- `.env.example`: Clerk keys only. `.env.local` exists. I only listed the variable names (values masked) and found Clerk keys; no Supabase variables are set.
- Tooling on this machine: Node 22.11, pnpm. No `supabase` CLI, no Docker, no `psql`. So I cannot run a local Supabase stack or apply migrations to a hosted project.

## Decisions / Assumptions

1. **Identity is the Clerk user id (text), not a Supabase Auth uuid.** Every owner column is `user_id text not null`, and `users.id` is the Clerk id (`user_...`). There is no `auth.users` foreign key.
2. **Clerk is wired to Supabase through the third-party auth integration.** Supabase verifies Clerk session JWTs and exposes the Clerk id as the `sub` claim, so policies use `(select auth.jwt() ->> 'sub')`. This is a dashboard step for you (Supabase → Authentication → Third-party auth → Clerk, plus enabling the Supabase integration in Clerk). I will document it in the migration header and the report. I cannot do it. I will not use `user_metadata` claims or `auth.uid()` (which expects a uuid).
3. **Policies are written once per operation, `TO authenticated`, with an ownership predicate.** No `anon` access to any table. `UPDATE` policies always have both `USING` and `WITH CHECK`. `auth.jwt()` is wrapped in `(select …)` so it is evaluated once per statement. `ENABLE` and `FORCE` row level security on every table.
4. **Server-owned tables are read-only to the browser role.** `subscriptions`, `usage_events` and `ai_generations` get a `SELECT`-own policy only. Writes happen server-side with the service role (webhooks, AI service, metering). This stops a creator forging their own plan or usage counters. `service_role` bypasses RLS by design, so its key stays server-only (AGENTS.md §11).
5. **Child rows cannot point at another creator's parent.** Parents get `unique (id, user_id)`; children use composite foreign keys `(parent_id, user_id) → parent (id, user_id)`. A user who learns another creator's row id still cannot attach their own row to it, even if a policy were written incorrectly.
6. **`content_versions` is append-only** for the browser role: `SELECT` and `INSERT` policies, no `UPDATE`/`DELETE`. Versions are removed only by `ON DELETE CASCADE` from the item.
7. **Deletion.** Everything cascades from `users`, so deleting a user row removes all their data (AGENTS.md §22).
8. **Grants are explicit.** Data API auto-exposure may be off, so the migration grants `select/insert/update/delete` to `authenticated` only on the operations each table's policies allow, and nothing to `anon`. `service_role` is granted all.
9. **Not in this migration (deliberate):** pgvector and embedding columns (dimension depends on the model choice, which is the AI-service item; added later by an additive migration), Stripe/billing columns beyond a minimal `subscriptions` shape, Supabase Storage buckets and policies (the `assets` table stores metadata and a storage path only), and `users` sync from Clerk.
10. **JSONB for AI-shaped payloads** (strategy, evidence, package sections). Zod validation of those shapes belongs to the "Core types" item. The database enforces only structural integrity (not null, enums, checks).
11. **Test harness: Vitest + PGlite** (`@electric-sql/pglite`, in-process WASM Postgres). It is real Postgres, so RLS, roles, `FORCE`, composite FKs and `set local role` behave faithfully, and it needs no Docker. The test setup creates the `anon`, `authenticated`, `service_role` roles and a minimal `auth.jwt()` shim reading `request.jwt.claims`, matching how Supabase defines it. **Limitation, stated up front:** this proves the SQL policies, not Supabase's JWT verification, PostgREST or the Clerk integration. A smoke check against a real project is in the manual procedure.
12. **Dev dependencies only:** `vitest` and `@electric-sql/pglite`. Versions pinned in the lockfile. No Playwright.
13. **Migration format:** plain timestamped SQL in `supabase/migrations/` (imperative workflow, per the skill), so `supabase db push` works when you have the CLI. I will not create `supabase/config.toml`; `supabase init` does that.

## Files Likely to Change

| File | Change |
|---|---|
| `supabase/migrations/20261009000100_core_schema.sql` (new) | Enums, 16 tables, constraints, indexes, `updated_at` trigger function and triggers |
| `supabase/migrations/20261009000200_rls_policies.sql` (new) | Enable and force RLS, explicit grants, all policies |
| `tests/db/helpers.ts` (new) | PGlite bootstrap: roles, `auth` shim, applies migrations in order, `asUser(id)`, `asService()`, `asAnon()` helpers |
| `tests/db/schema.test.ts` (new) | Every table exists, RLS enabled and forced, no policy grants `anon`, composite FK behavior |
| `tests/db/rls-isolation.test.ts` (new) | Cross-user read/insert/update/delete denial for every table |
| `vitest.config.ts` (new) | Node environment, `tests/**/*.test.ts` |
| `package.json`, `pnpm-lock.yaml` | Add `vitest`, `@electric-sql/pglite`; add `"test": "vitest run"` |
| `PHASES.md` | Tick the two Phase 1 items after checks pass |

## Database Changes

Common to every table: `id uuid primary key default gen_random_uuid()` (except `users`), `user_id text not null references users(id) on delete cascade`, `created_at timestamptz not null default now()`, `updated_at` where rows are edited (maintained by trigger). Every `user_id` and every FK column gets an index (the RLS predicate and join columns).

| Table | Purpose / key columns | Browser (authenticated) access to own rows |
|---|---|---|
| `users` | `id text pk` (Clerk id), `email`, `display_name`, timestamps | select, insert (`id = sub`), update |
| `subscriptions` | `plan`, `status`, `provider_customer_id`, `provider_subscription_id`, `current_period_end` | select only |
| `creator_profiles` | one per user (`unique(user_id)`): niche, goals, platforms (text[]), posting capacity, experience level, onboarding status | select, insert, update, delete |
| `brand_profiles` | one per user: voice/tone descriptors, do/don't lists, sample text | select, insert, update, delete |
| `content_pillars` | name, description, position; 3–5 per user enforced in the service layer, not the DB | all four |
| `content_ideas` | opportunity object: topic, audience need, angle, hook, format, evidence (jsonb), difficulty, fit signals, cta, status, optional `pillar_id` | all four |
| `content_items` | title, platform, format, status, scheduled/published dates, optional `idea_id`, `pillar_id`, `unique(id, user_id)` | all four |
| `content_versions` | `content_item_id`, `version_no` (`unique(item, version_no)`), content (jsonb), source (`user`/`ai`) | select, insert only |
| `analytics_snapshots` | optional `content_item_id`, captured_at, views, watch_time_seconds, likes, comments, shares, saves, follower_delta, source (`manual`/`import`/`api`), non-negative checks | all four |
| `competitors` | platform, handle, url, notes | all four |
| `research_signals` | source, source_url, signal_type, payload (jsonb), fetched_at, dedupe key `unique(user_id, source, external_id)` | all four (creator-provided and cached signals). Shared/global research is out of scope |
| `creator_insights` | insight_type, summary, evidence (jsonb), confidence, sample_size, status | all four |
| `ai_generations` | kind, model, prompt_version, optional item/idea refs, tokens in/out, status, error_code, latency | select only |
| `assets` | name, mime_type, size_bytes, storage_path, optional `content_item_id` | all four |
| `usage_events` | event_type, quantity, cost_micros, metadata (jsonb), optional `ai_generation_id` | select only |
| `notifications` | type, title, body, `read_at` | select, update (own) and delete |

Enums or `check` constraints are used for status/type columns so bad values fail in the database. Lowercase snake_case identifiers throughout. `text` over `varchar(n)`, `timestamptz` over `timestamp`, `bigint` for counters.

**RLS (second migration).** `alter table … enable row level security; … force row level security;` on all 16 tables. Policies named `<table>_<op>_own`, `to authenticated`, predicate `user_id = (select auth.jwt() ->> 'sub')` (`id` for `users`), `WITH CHECK` on insert/update. No `SECURITY DEFINER` functions are introduced. The `updated_at` trigger function is `SECURITY INVOKER` with `set search_path = ''`.

## Implementation Requirements

1. Write the two migrations exactly as in the table above. Migration 1 runs on plain Postgres (no `auth` schema reference); migration 2 depends on `auth.jwt()` and the Supabase roles, which exist on Supabase and are created by the test helper locally.
2. Migrations are idempotent in intent and ordered (schema, then RLS), with no `drop` of anything.
3. A `revoke all on all tables in schema public from anon` is applied for the new tables, then the explicit grants.
4. Test helper runs both migration files unmodified, so the tests exercise the real SQL.
5. Tests use `set local role` plus `set local request.jwt.claims` inside a transaction per case so cases don't leak state. A user is simulated by claims `{"sub":"user_A","role":"authenticated"}`.
6. `pnpm test` runs the suite. `typecheck` and `lint` must cover the new TS files.

## AI Behavior

None. No model calls, prompts or AI output are added. The schema stores future AI output (`content_ideas`, `content_versions`, `ai_generations`, `creator_insights`) but validation of those payloads is the Zod work in the "Core types" and AI-service items.

## Security Requirements

- Authentication: the DB trusts only the verified JWT `sub`. Browser-supplied user ids are never trusted. `WITH CHECK` blocks inserting or re-assigning a row to another `user_id`.
- Authorization: ownership predicate on every operation of every table. Server-owned tables (`subscriptions`, `usage_events`, `ai_generations`) are not writable by `authenticated`.
- Isolation depth: `FORCE` RLS; composite FKs prevent cross-creator parent references; no `anon` grants or policies; no `SECURITY DEFINER`.
- Secrets: nothing secret is added. No Supabase keys are written to files. The service-role key must never get a `NEXT_PUBLIC_` name.
- Privacy (AGENTS.md §22): stored per table as listed above; accessible only to the owning creator (and server/service role); deleted by cascade from `users`; AI context inclusion is decided later by the context builder, which must read only the needed columns.

## Acceptance Criteria

1. Both migration files exist and apply cleanly, in order, on a fresh PGlite database.
2. All 16 tables exist; every one has RLS enabled and forced (asserted by test against `pg_class`).
3. For every table, as user B: cannot `select` user A's rows (0 rows), cannot `update` or `delete` them (0 rows affected), and cannot `insert` a row with `user_id = A` (policy violation error).
4. User A cannot change their own row's `user_id` to B via update (`WITH CHECK` failure).
5. User A cannot insert a `content_versions`, `analytics_snapshots`, `assets` or `content_items` child that references B's `content_items`/`content_ideas`/`content_pillars` row (foreign key error), and cannot update/delete a `content_versions` row.
6. As `authenticated`, insert/update/delete on `subscriptions`, `usage_events`, `ai_generations` is denied even for the user's own `user_id`.
7. `anon` (no claims) reads zero rows and cannot write on any table. A JWT with no `sub` sees nothing.
8. `service_role` can read and write across users (confirms server paths work).
9. Own-row happy paths work (user A can create and read their own profile, idea, item, version, snapshot).
10. `pnpm typecheck`, `pnpm lint` and `pnpm test` pass. `pnpm build` is not required (no routes, config or server modules change), and I will say so.

## Checks

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

`pnpm build` is not run because no build-sensitive file changes. If `vitest.config.ts` or `package.json` changes turn out to affect the build, I will run it and report the result.

## Manual Test Procedure

Automated tests cover the SQL. These steps cover the parts they can't (Supabase JWT verification and Clerk). They need you to do the hosted-project steps, since I can't.

1. Create or choose a Supabase project. In the dashboard, add Clerk under Authentication → Third-party auth, and enable the Supabase integration in the Clerk dashboard.
2. With the Supabase CLI: `supabase link --project-ref <ref>`, then `supabase db push`. Confirm both migrations apply, then `supabase db advisors` shows no missing-RLS findings.
3. In the SQL editor, confirm RLS is on for all tables:
   `select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r';`
4. Sign in as two different Clerk users in two browsers. Using each user's Clerk token against the REST API (`GET /rest/v1/creator_profiles`), confirm each only sees their own rows and a `POST` with the other user's `user_id` is rejected with a 403/RLS error.
5. Confirm `PATCH /rest/v1/subscriptions` is rejected for an ordinary user token.

## UI

None. No UI changes.

## Out of scope / Follow-ups

Supabase client + Clerk token wiring and `.env.example` Supabase variables; generated DB types and Zod schemas; Clerk `user.created` webhook to populate `users`; pgvector columns; Storage bucket policies; Stripe-specific subscription columns; Playwright end-to-end isolation tests against a hosted project.
