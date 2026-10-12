# Creator Intelligence (Phase 2)

Phase 2 in `PHASES.md`: onboarding, creator profile, brand voice, strategy generation, persistent strategy at `/app/strategy`, and the creator context builder.

## Goal

A new creator signs up, answers a short onboarding, and gets a **persistent, personalised strategy**: positioning, audience profile, 3–5 content pillars, format strategy, voice profile, growth and monetization objectives, and a 30-day plan. The strategy is stored as strategic memory (not a one-off AI reply) and is the first consumer of a reusable **creator context builder** that every later agent (opportunities, studio, diagnosis) will use.

Loop step served: *Creator Profile → Audience Understanding* (AGENTS.md §1, §7, §8 "Strategy Agent").

## Skills Read

- `supabase`, `supabase-postgres-best-practices` (migration, RLS, composite-FK pattern, RPC with `security invoker`).
- `clerk`, `clerk-nextjs-patterns` (`auth.protect()` in every page and server action, post-sign-up redirect).
- `ai-sdk` (structured output through the existing `runStructured`; no new provider code).
- Next.js docs `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` (server actions are public POST endpoints: authenticate inside each one; `useActionState`; `revalidatePath`; `redirect` throws).

## Existing Code Inspected

- `PHASES.md`, both `AGENTS.md` sections (§7 creator context, §8 strategy agent, §9 AI service rules, §10 DB rules, §14 UX, §18, §19, §22).
- `supabase/migrations/20261009000100_core_schema.sql` and `…000200_rls_policies.sql`: `creator_profiles` (niche, audience_description, goals[], platforms[], posting_capacity_per_week, experience_level, onboarding_status), `brand_profiles` (tone, voice_traits[], do_list[], dont_list[], sample_text), `content_pillars` (name, description, position, is_active). All have own-row CRUD RLS. **Nothing exists for positioning, audience profile, format strategy, objectives or the 30-day plan.**
- `lib/ai/*`: `runStructured` (kill switch → config → daily cap → pending row → `generateText` with `Output.object` → validation → metering; never throws), `ACTIVE_PROMPTS` registry, `AI_TASK_ROUTES` (compiler forces a route per kind), versioned `PromptDefinition`, `store: false` on OpenAI. Schemas passed to it must use `.nullable()`, never `.optional()`.
- `lib/schemas/*`: `enums.ts` (`experienceLevel`, `onboardingStatus`, `DB_ENUM_COLUMNS` parity-tested), `parse.ts` (`parseWith`).
- `lib/services/current-user.ts`, `users.ts`, `ai-usage.ts`: fail-soft `{ ok }` result pattern, `createUserClient()` (Clerk token → RLS).
- `app/app/layout.tsx` (shell, `RequireSession` in `Suspense` because `cacheComponents: true`), `app/app/page.tsx`, `app/app/settings/page.tsx` + `components/settings/*` (page pattern: static frame, async section behind `Suspense`, `auth.protect()` inside), `lib/app-shell/nav-items.ts` (live `href` union), `proxy.ts` (bare `clerkMiddleware`; each page protects itself).
- `app/globals.css`: `.btn*`, `.card`, `stack-*`, `container-*`, semantic tokens. **No form-field primitives exist.**
- `tests/`: Vitest; `tests/ai/fake-db.ts`, `tests/db/helpers.ts` + `rls-isolation.test.ts` + `schema-parity.test.ts` (pglite runs the real migrations). No component tests, no Playwright.

## Decisions / Assumptions

1. **One new table, `creator_strategies`** (1 row per creator, `unique (user_id)`): the schema has no home for the non-pillar strategy fields. Pillars stay in the existing `content_pillars` table (the blueprint's model). Strategy is stored as typed columns for the short text fields and `jsonb` for `audience_profile`, `format_strategy`, `voice_profile`, `thirty_day_plan`, validated by Zod on write and read. `version integer` increments on every regeneration; no history table yet (follow-up, will matter when diagnosis proposes strategy changes).
2. **Atomic write via one Postgres function** `public.save_creator_strategy(...)`, `security invoker` (RLS still applies, the creator can only touch their own rows), `set search_path = ''`. It upserts the strategy and replaces pillars in one transaction so a failure never leaves a strategy without pillars. Pillar replacement is **retire-and-insert**: existing pillars get `is_active = false`, new ones are inserted at positions 0..n. Rows are never deleted because `content_ideas.pillar_id` / `content_items.pillar_id` reference them (those FKs are `on delete set null`, but history should keep its pillar).
3. **Strategy generation is whole-artifact in Phase 2.** Section-level regeneration (§9) needs the studio-style editing UI and is deferred. To keep the cost of "Regenerate" visible, the button states it replaces the current strategy and uses one generation from the daily allowance.
4. **Onboarding completion = profile and brand voice saved**, not "strategy generated". If the model fails, the creator is not trapped: they land on `/app/strategy`, which shows the failure and a "Try again" button. `onboarding_status`: `in_progress` after the profile step, `completed` after the brand step.
5. **Soft gate, not a redirect loop.** `/app` and `/app/strategy` show an honest "Finish setup" card linking to `/onboarding` if onboarding is not completed. I do **not** add a hard redirect in `app/app/layout.tsx` (it runs inside `Suspense`, so redirects there are unreliable under Cache Components). New sign-ups are sent to `/onboarding` through Clerk's `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`, documented in `.env.example`.
6. **`/onboarding` lives outside the `/app` shell** (own minimal layout: logo, step indicator, no sidebar), matches the route map in §15, and is re-enterable with saved values prefilled (it doubles as "Edit profile"). No separate `/app/brand` route in this phase.
7. **Closed vocabularies live in the app, not the DB.** `platforms` and `goals` columns are unconstrained `text[]`; a Zod enum in `lib/schemas/creator.ts` restricts input (`youtube, tiktok, instagram, linkedin, x, other`; goals: `grow_audience, build_authority, monetize, get_ugc_clients, stay_consistent`). No `check` constraint, so adding a platform needs no migration.
8. **AI kind `creator_strategy`**, tier `quality`, `maxOutputTokens: 8_000` (reasoning included), prompt `lib/ai/prompts/creator_strategy/v1.ts`. Output has a model-facing strict schema (all fields present, `.nullable()` where needed) and an app schema that validates stricter rules (3–5 pillars, unique pillar names, 30-day plan covers weeks 1–4).
9. **Untrusted input.** Free-text from the creator (niche, audience, do/don't lists, sample text) goes into the prompt inside clearly delimited blocks with an instruction to treat it as data, never as instructions. Length caps are enforced by Zod before anything reaches the model. The system prompt refuses impersonation of named real people, deceptive engagement tactics, spam and prohibited content (§9 Safety) and tells the model to say so in a `notes` field rather than comply. No names, emails or Clerk ids are sent.
10. **The context builder is read-only and scoped.** `buildCreatorContext(client, userId, { include })` returns a typed object; Phase 2 populates `profile`, `brand`, `pillars`, `strategy`; `recentContent`, `performance`, `insights` are queried from their existing tables (empty today) so later phases only start filling tables, not rewrite the builder. Callers choose sections, so an agent receives only what it needs (§6). A pure `renderContextForPrompt(context)` turns it into prompt text so agents share one formatting.
11. **Cost controls:** the existing rolling 24-hour cap and metering in `runStructured` apply unchanged. Additionally the action refuses a second generation while one is in flight for the same creator (see Implementation 6). No new limits table.
12. **No fake data.** Nothing in the strategy cites trends or statistics. The prompt forbids invented numbers, follower counts and "viral" claims; the 30-day plan is labelled as a starting hypothesis to be revised with real performance.
13. `database.types.ts` is hand-updated for the new table and function (a linked Supabase project is not guaranteed); `pnpm db:types` can regenerate it later and the schema-parity test guards drift.
14. **Applying the migration** to the hosted Supabase project is a manual step for the developer (listed in Manual Test Procedure). I will not run it against a remote database.

## Files Likely to Change

| File | Change |
|---|---|
| `supabase/migrations/20261012000100_creator_strategies.sql` (new) | Table, trigger, `save_creator_strategy()` |
| `supabase/migrations/20261012000200_creator_strategies_rls.sql` (new) | RLS, grants for the new table and function |
| `lib/supabase/database.types.ts` | New table + function types |
| `lib/schemas/creator.ts` (new) | Profile, brand, platform/goal enums, form input schemas, strategy schemas (app + model-facing) |
| `lib/schemas/enums.ts`, `lib/schemas/index.ts` | Export new schemas; `DB_ENUM_COLUMNS` unchanged unless a `check` is added |
| `lib/ai/prompts/creator_strategy/v1.ts` (new), `lib/ai/prompts/registry.ts`, `lib/ai/models.ts` | Prompt, registry entry, route |
| `lib/services/creator-profile.ts` (new) | Load/save profile + brand, onboarding status transitions |
| `lib/services/creator-context.ts` (new) | `buildCreatorContext`, `renderContextForPrompt` |
| `lib/services/creator-strategy.ts` (new) | `generateCreatorStrategy()`, `getCreatorStrategy()` |
| `app/onboarding/layout.tsx`, `page.tsx`, `actions.ts` (new) | Route and server actions |
| `components/onboarding/*` (new) | Step form (client), field primitives |
| `app/app/strategy/page.tsx`, `actions.ts` (new), `components/strategy/*` (new) | Strategy view, regenerate |
| `app/app/page.tsx` | "Finish setup" / strategy summary card |
| `lib/app-shell/nav-items.ts` | Strategy becomes live (`href` union widened) |
| `app/globals.css` | Small form primitives (`.field`, `.input`, `.chip`) using existing tokens |
| `.env.example` | Clerk post-sign-up redirect |
| `tests/**` (new) | See Checks |
| `PHASES.md` | Tick Phase 2 items |

## Database Changes

**Table `public.creator_strategies`**

| column | type | notes |
|---|---|---|
| `id` | uuid pk default `gen_random_uuid()` | |
| `user_id` | text not null **unique** references `users(id)` on delete cascade | one strategy per creator |
| `positioning` | text not null check (`<> ''`) | |
| `audience_profile` | jsonb not null | `{ summary, pain_points[], desires[], where_they_are[] }` |
| `format_strategy` | jsonb not null | `[{ platform, formats[], cadence, rationale }]` |
| `voice_profile` | jsonb not null | `{ summary, traits[], sounds_like[], avoid[] }` |
| `growth_objective` | text not null | |
| `monetization_objective` | text not null | |
| `thirty_day_plan` | jsonb not null | `[{ week, theme, focus, actions[] }]` |
| `notes` | text | model caveats (e.g. refused element); shown to the creator |
| `version` | integer not null default 1 check (`> 0`) | |
| `prompt_version` | text | `ai_generations.prompt_version` copy |
| `ai_generation_id` | uuid | provenance; **no FK** to `ai_generations` (that table is server-owned and generations may be pruned) |
| `created_at`, `updated_at` | timestamptz | `set_updated_at` trigger |

**Function `public.save_creator_strategy(p_strategy jsonb, p_pillars jsonb)`**: `security invoker`, `set search_path = ''`, `returns integer` (the new version). Derives `user_id` from `(select auth.jwt() ->> 'sub')`, raising if null, and **never trusts a user id argument**. Upserts the strategy (`version = old + 1`), sets existing pillars `is_active = false`, inserts the new pillars. `grant execute … to authenticated`, revoked from `anon`/`public`.

**RLS:** enabled and forced; `select/insert/update` own-row policies (`user_id = (select auth.jwt() ->> 'sub')`); `delete` own-row (needed for creator data deletion later). `service_role` all. `anon` nothing. Same style as the existing policies.

Existing tables are unchanged. Index: the `unique (user_id)` constraint serves all lookups.

## Implementation Requirements

1. **Schemas (`lib/schemas/creator.ts`).** `platform`, `creatorGoal` enums; `creatorProfileInput` (niche 2–120 chars, audience 10–600, 1–3 goals, ≥1 platform, posting capacity 1–30 per week, experience level); `brandProfileInput` (tone ≤ 200, 0–8 voice traits ≤ 40 chars each, do/don't lists ≤ 8 items ≤ 160 chars, sample text ≤ 2,000, all trimmed); `strategyOutput` (app) and `strategyModelSchema` (strict, no optionals). Pillars: 3–5, name ≤ 60, description ≤ 300, unique names (case-insensitive). 30-day plan: exactly 4 weeks, 2–5 actions each, each action ≤ 200 chars. Format strategy only for platforms the creator selected.
2. **Profile service.** `getCreatorProfile`, `saveCreatorProfile`, `getBrandProfile`, `saveBrandProfile` take a `UserSupabaseClient` and the verified `userId`, upsert on `user_id`, and return `{ ok: true, … } | { ok: false, code }`; never throw; log through `logEvent` with stable event names and no content. Saving the profile sets `in_progress` (never downgrades `completed`); saving the brand voice sets `completed` only if a profile row exists.
3. **Onboarding (`/onboarding`).** Two steps in one client component with a step indicator: **1 About you** (niche, audience, goals, platforms, weekly posting capacity, experience) and **2 Your voice** (tone, traits as chips from a suggestion list plus custom, do/don't lists, optional sample text). Each step submits to a server action via `useActionState`; field errors render under each field and focus moves to the first error. Back navigation keeps entered values. Step 2's primary button is "Save and build my strategy": it saves the voice, marks onboarding completed, runs `generateCreatorStrategy`, and redirects to `/app/strategy` whether or not generation succeeded (the strategy page owns the failure UI). Prefill from saved data on revisit.
4. **Server actions (`app/onboarding/actions.ts`, `app/app/strategy/actions.ts`).** Each: `const { userId } = await auth.protect()`; parse `FormData` with the Zod input schema (reject unknown platform/goal values); call the service; return a serialisable state `{ ok, fieldErrors?, message? }`. No user id from the form.
5. **Context builder.** `buildCreatorContext(client, userId, { include: ["profile","brand","pillars","strategy","recentContent","performance","insights"] })`. Reads only the requested sections, only active pillars and active insights, the 10 most recent content items, and the 30 most recent analytics snapshots; returns `{ ok: true, context } | { ok: false }`. Contains **no** email, name or Clerk id. Reports `completeness` (which sections are empty) so prompts can say what is missing instead of guessing. `renderContextForPrompt` emits stable labelled text with delimited user-authored blocks and omits empty sections.
6. **`generateCreatorStrategy(client, userId)`.** (a) Build context with `profile`, `brand`; if either is missing return `{ ok: false, code: "missing_context" }` without calling AI. (b) Reject if a `creator_strategy` generation is already `pending` for this creator in the last 2 minutes (read via the user client from `ai_generations`, RLS-scoped). (c) Call `runStructured({ kind: "creator_strategy", schema: strategyModelSchema, validate: strategyOutput })`. (d) On success call `save_creator_strategy` with the validated output; if the save fails, log and return `persistence_error` (the generation is already metered; the creator can retry). (e) Map every `AiErrorCode` to a creator-facing message and `retryable` flag using `AI_ERRORS`. (f) `revalidatePath("/app/strategy")` and `/app` in the action, not the service.
7. **`/app/strategy`.** Static frame, async section behind `Suspense`, `auth.protect()` inside. Four states: **not onboarded** (Finish setup card), **onboarded, no strategy** (explains and offers "Generate my strategy"), **has strategy** (below), **load error** (inline message, rest of page renders). Strategy view sections in order: Positioning (hero statement), Audience (summary, pain points, desires), Content pillars (3–5 cards), Format strategy (per platform), Voice, Objectives (growth, monetization), 30-day plan (4 week blocks), model `notes` if present, and a footer line "Version N · generated <date> · a starting hypothesis, we'll refine it as your content performs". Actions: "Regenerate strategy" (confirm step stating it replaces the current strategy and uses one AI generation) and "Edit profile" (links to `/onboarding`). Every section ends with a next action where one exists today; the Opportunities link is **not shown** because that route does not exist yet.
8. **Dashboard (`/app`).** Replace the placeholder card with: not onboarded → "Finish setting up" card linking to `/onboarding`; strategy exists → card with the positioning sentence and week-1 theme linking to `/app/strategy`. Nothing about opportunities or performance yet.
9. **Nav.** Widen `NavItem` live `href` to include `"/app/strategy"`; Strategy becomes live.
10. **Observability.** Stable `logEvent` names (`strategy_generation_failed`, `strategy_save_failed`, `profile_save_failed`, `context_build_failed`) with code/stage only, never creator text.

## AI Behavior

- **Input context:** `renderContextForPrompt` over `profile` + `brand` only (no history exists yet). Delimited blocks: `<creator_input>…</creator_input>` with the instruction that content inside is data.
- **Prompt (v1, versioned, in `lib/ai/prompts/creator_strategy/v1.ts`):** role = creator strategist for early-stage creators; produce positioning, audience profile, 3–5 pillars, format strategy for the selected platforms only, voice profile consistent with the brand input, growth and monetization objectives sized to the stated posting capacity and experience level, and a realistic 4-week plan. Rules: no invented statistics, follower projections or "viral" claims; no scraping or fake-engagement tactics; honour the creator's don't-list; if the request asks for impersonation or deceptive growth, omit it and explain in `notes`; write in plain language for a beginner.
- **Model:** quality tier through the existing router (overridable by `AI_MODEL_QUALITY`). No provider call outside `runStructured`.
- **Structured output:** `strategyModelSchema` (strict). Validation: `strategyOutput` via `parseWith` (pillar count, unique names, 4 weeks, platforms ⊆ selected platforms, string limits).
- **Errors:** every `AiErrorCode` yields a recoverable result; the UI never throws. `invalid_output` shows "The strategy didn't come out right — try again" and counts against the cap as today.
- **Persistence:** result stored via `save_creator_strategy`; prompt text and raw model output are **not** stored (consistent with the Settings page privacy statement); `prompt_version` and `ai_generation_id` are.
- **Usage controls:** existing 24-hour cap + `usage_events` metering; in-flight guard; whole-artifact regeneration needs an explicit confirm.

## Security Requirements

- `auth.protect()` in `/onboarding`, `/app/strategy` and inside every server action; user id only from Clerk's server session.
- All reads/writes use `createUserClient()` (RLS as the creator). The service-role client is used **only** inside `runStructured`, as today.
- `save_creator_strategy` is `security invoker` and derives the user from the JWT; EXECUTE revoked from `anon`/`public`.
- Input validated by Zod server-side; enum values and lengths enforced; no HTML rendered from user or model text (React escaping only; no `dangerouslySetInnerHTML`).
- Prompt-injection: user text is delimited and declared data; model output is schema-validated and rendered as text only; no tool access.
- No secrets in client code; the new client component imports only types and server actions.
- Only profile and brand data are sent to OpenAI, with `store: false`. The Settings privacy copy already says creator data is sent to OpenAI; I will re-read `components/settings/privacy-section.tsx` and update it only if a statement becomes untrue.
- Data deletion: all new rows cascade from `users`.

## Acceptance Criteria

1. Migrations apply cleanly on pglite and the schema-parity test passes with the new table.
2. RLS: creator A cannot read, insert, update or delete creator B's `creator_strategies` row or pillars via the function or direct queries; `anon` gets nothing; calling `save_creator_strategy` without a JWT raises.
3. Signed in, a creator with no profile can complete `/onboarding`, see validation errors for bad input, and land on `/app/strategy`.
4. With a valid `OPENAI_API_KEY`, a strategy is generated, validated, stored, and displayed with 3–5 pillars and a 4-week plan; reloading shows the same stored strategy (no new AI call).
5. Regenerate replaces the strategy, increments `version`, retires old pillars (`is_active = false`) and inserts new ones, all in one transaction; a forced save failure leaves the previous strategy and pillars intact.
6. AI disabled, key missing, cap reached, provider failure and invalid output each show a specific recoverable message on `/app/strategy` and never crash the page.
7. A creator who has not finished onboarding sees the "Finish setup" card on `/app` and `/app/strategy`; no dead buttons anywhere.
8. `buildCreatorContext` returns only requested sections, contains no email, name or Clerk id, and `renderContextForPrompt` omits empty sections.
9. Strategy nav item is a working, highlighted link; nothing links to routes that don't exist.
10. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` pass.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build   # required: new routes, server actions, nav change
```

New offline tests:
- `tests/schemas/creator.test.ts`: input bounds, enum rejection, trimming, pillar count/uniqueness, 4-week plan, format strategy platforms ⊆ selected, strict model schema has no optional keys (extend `strict-schema.test.ts` pattern).
- `tests/db/creator-strategies.test.ts` (pglite): upsert + version increment, pillar retire-and-insert, rollback on invalid input, cross-creator isolation for select/update/delete/function, `anon` denied, no-JWT call raises. Extend `schema-parity.test.ts` for the new table.
- `tests/ai/prompts.test.ts`: `creator_strategy` registered, versioned, route exists, prompt text contains the data-delimiter and no-invented-statistics rules, builder output includes delimiters and no name/email.
- `tests/services/creator-context.test.ts`: section selection, completeness flags, no PII keys, active-only filtering.
- `tests/services/creator-profile.test.ts`: status transitions (never downgrades `completed`), db error → `{ ok: false }` without throwing.
- `tests/services/creator-strategy.test.ts`: missing context short-circuits before AI, in-flight guard, success persists, invalid output not persisted, save failure surfaces `persistence_error`, each `AiErrorCode` mapped to a message.
- `tests/ai/live.test.ts` (opt-in `pnpm test:live`): one real `creator_strategy` call validates against `strategyOutput`.

Server actions and pages are not covered by automated tests (no component-test setup, no Playwright; adding them is outside this phase). They are covered by the manual procedure.

## Manual Test Procedure

1. Apply the two new migrations to your Supabase project (SQL editor, in order, or `supabase db push`). Confirm `creator_strategies` exists and RLS is on.
2. Set `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/onboarding` in `.env.local` (see `.env.example`), ensure `OPENAI_API_KEY` is set, `pnpm dev`.
3. Sign up with a new account → you land on `/onboarding`. Submit step 1 empty: errors appear under each field and focus moves to the first. Fill it in, continue.
4. Step 2: add traits, a don't-list item and a short sample; click "Save and build my strategy". Wait for the redirect to `/app/strategy` (up to about a minute). Confirm 3–5 pillars, 4 week blocks, and that the formats only mention your selected platforms.
5. Reload: the same strategy appears and Settings → AI usage shows exactly one more generation.
6. In Supabase: `select version, prompt_version from creator_strategies;` → version 1. Click **Regenerate strategy**, confirm → version 2; `select name, is_active from content_pillars order by created_at;` shows the old pillars inactive and the new ones active.
7. Failure paths: set `AI_ENABLED=false` → regenerate shows the paused message and no row changes; unset `OPENAI_API_KEY` → "not configured" message; set `AI_DAILY_GENERATION_LIMIT=1` → limit message. Restore the env afterwards.
8. Sign in as a second account: you see only your own strategy; `/app/strategy` for a brand-new account shows the Finish setup card.
9. Click "Edit profile": `/onboarding` opens prefilled; saving changes does not erase the strategy.
10. Phone width (~375px): onboarding and strategy have no sideways scroll, tap targets ≥ 44px. Toggle light/dark OS theme. Tab through everything and confirm visible focus rings.

## UI

- **Visual interpretation:** the same flat, outlined, calm style as the dashboard and settings. Onboarding is a focused two-step form (like a guided setup, not a long form wall); the strategy page reads like a brief the creator can act on. No charts, no fake scores, no decorative graphics.
- **Layout:** `/onboarding`: centered `container-narrow` column on the page background, logo top-left, step indicator ("Step 1 of 2 · About you") above one `.card` containing the fields. `/app/strategy`: inside the shell `<main>`; `h1` + `.lead`, then the Positioning statement as a larger `.card` (`text-heading`), followed by `grid-auto-fit` cards for pillars, a single-column list for audience/format/voice/objectives, and a four-block week list for the 30-day plan. Content max width ~`max-w-3xl` except the pillar grid.
- **Typography:** existing scale only. `h1` display, section `h2` at `text-heading`, labels medium weight, helper text `text-muted-foreground`. Positioning statement one step larger than body.
- **Spacing:** existing `stack-sm/md/lg`; fields separated by `stack-md`; no custom pixel values.
- **Component behaviour:**
  - New small primitives in `globals.css`: `.field` (label + control + helper + error stack), `.input`/`.textarea`/`.select` (border token, 44px min height, `ring` focus outline), `.chip` (toggle button for platforms/goals/traits with `aria-pressed`, checked state also marked with a check icon, not colour alone).
  - Platforms and goals are chip groups backed by real checkboxes in a `fieldset`/`legend` for native keyboard and form behaviour. Posting capacity is a number input with a "posts per week" suffix.
  - Primary button shows a pending label ("Building your strategy…") and is disabled while the action runs; secondary "Back" never loses values.
  - Regenerate opens an inline confirm panel (not a modal): "This replaces your current strategy and uses 1 of your AI generations." with Cancel / Regenerate.
- **Loading:** onboarding final step shows an in-button pending state plus a polite `aria-live` message; `/app/strategy` async section uses a card-shaped skeleton in `Suspense`; the heading renders immediately.
- **Empty:** not onboarded → Finish setup card ("Tell us about your content so we can build your plan" + button). Onboarded without strategy → short explanation and "Generate my strategy".
- **Error:** field-level errors for validation; inline `role="alert"` banner above the form for action failures; on the strategy page, a banner with the specific message and a "Try again" button (hidden when not retryable, replaced by what to do instead, e.g. "Your allowance frees up as generations age past 24 hours").
- **Responsive and mobile:** single column at all widths; pillar cards 1 → 2 → 3 columns; step buttons stack full-width below 480px; works at 320px; the step indicator is text, not a wide stepper.
- **Dark mode:** semantic tokens only.
- **Accessibility:** one `h1` per page, sections labelled by headings, all inputs have programmatic labels and `aria-describedby` for helper/error text, `aria-invalid` on error, focus moves to the first error / to the heading on step change, chips are real form controls.

## Known Limitations / Follow-ups

- Whole-strategy regeneration only; section-level regeneration and hand-editing of pillars come with the Studio editing patterns.
- No strategy version history (only the current version and `version` counter).
- Strategy is a hypothesis from self-reported input; it does not use research signals, competitors or performance yet. Those enter through `buildCreatorContext` in Phases 3 and 5.
- Onboarding does not collect competitors or connect any platform account (no integration exists).
- No automated component or end-to-end tests (no setup in the repo).
- A weekly strategy refresh job is Phase 7 (background jobs).
- Creator data export/deletion (§22) is still an open gap from Phase 1; the new table cascades from `users` so it will be covered by that work.
