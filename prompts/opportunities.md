# Opportunities (Phase 3, part 1)

First slice of Phase 3 (Opportunity Engine) in `PHASES.md`: the **Opportunities** item. It covers generating, storing, reviewing and triaging content opportunities at `/app/opportunities`.

## Goal

Give the creator a short list of **actionable content opportunities**, each answering (AGENTS.md §8 "Opportunity Agent"):

- What should I make? (topic, format, platform)
- Who is it for, and what do they need? (audience need)
- What angle and hook should I use?
- Why does it fit me? (rationale tied to my strategy and pillar)
- What's the evidence, and how strong is it?
- What should I do next? (CTA, plus Save / Dismiss)

Loop step served: *Opportunity Detection* (Creator Profile → Audience Understanding → **Opportunity Detection** → Content Plan…).

### Phase 3 split (for context, not in this prompt)

| Part | Scope |
|---|---|
| **1 (this)** | Opportunities: generate, persist, list, save/dismiss |
| 2 | Evidence/signals: `research_signals` from a supported source, cited in opportunities |
| 3 | Calendar (`/app/calendar`) + weekly planning (`generateWeeklyPlan()`) |
| 4 | Daily recommendation + dashboard "What should I do today?" |

## Skills Read

- `supabase`, `supabase-postgres-best-practices` (additive migration, index for the list query, RLS unchanged since `content_ideas` already has own-row CRUD).
- `ai-sdk` (structured output through the existing `runStructured`; per-request schema).
- `clerk-nextjs-patterns` (`auth.protect()` in the page and in every server action).
- Next.js docs `07-mutating-data.md` (server actions, `revalidatePath`) and the Cache Components rule that request data sits behind `Suspense`.

## Existing Code Inspected

- `supabase/migrations/20261009000100_core_schema.sql`: `content_ideas` already has `topic`, `audience_need`, `angle`, `hook`, `format`, `evidence jsonb`, `difficulty`, `audience_fit`, `evidence_strength`, `trend_signal`, `content_gap`, `cta`, `status` (`new|saved|planned|in_production|used|dismissed`), `source` (`ai|user`), `pillar_id` (composite FK to the creator's own pillar). Index `(user_id, status)`. RLS: full own-row CRUD for `authenticated`.
- **Missing for this feature:** a platform column, a "why it fits" rationale, and provenance (`ai_generation_id`). `research_signals` exists but is empty; nothing populates it yet.
- `lib/schemas/opportunities.ts`: `evidenceItem` (`kind`: `research_signal | creator_history | audience_comment | competitor | trend | creator_input`, `summary`, optional `source`, `source_url`, `observed_at`), `ideaEvidence` (max 20). `enums.ts`: `difficulty`, `signalLevel`, `ideaStatus`, `authorSource`.
- `lib/services/creator-context.ts`: `buildCreatorContext` already loads `pillars`, `strategy`, `recentContent`, `performance`, `insights` (the last three are empty today) and `renderContextForPrompt`.
- `lib/services/creator-strategy.ts`: the pattern to follow (missing-context short-circuit, in-flight guard, `runStructured` with `validate`, error table, never throws). `lib/ai/*`: registry, routes, `AI_ERRORS`.
- `components/strategy/*`, `components/ui/toaster.tsx` (Sonner), `app/globals.css` (`.card`, `.btn*`, `.chip`, `.alert`, `stack-*`, `grid-auto-fit`), `lib/app-shell/nav-items.ts` (Opportunities is `soon`).
- `tests/services/fake-supabase.ts`, `tests/db/helpers.ts` + `rls-isolation.test.ts` (already cover `content_ideas`).

## Decisions / Assumptions

1. **Evidence is limited to what we actually have.** There is no research source yet (part 2), so an opportunity may cite only:
   - `creator_input`: what the creator told us (profile, audience, strategy, pillars).
   - `creator_history`: their own performance, **only when analytics rows exist** (none today).

   The model-facing schema is built per request so other kinds can't be produced at all. `trend`, `competitor`, `audience_comment` and `research_signal` become possible in part 2.
2. **No fabricated signal levels.**
   - `trend_signal` and `content_gap` are stored as **null**: they need external research, so we claim nothing.
   - `evidence_strength` is computed **server-side, not by the model**: `low` when the only evidence is `creator_input`, `medium` when `creator_history` is cited. `high` is reserved for corroborated research in part 2.
   - `audience_fit` (`low|medium|high`) is the model's qualitative judgment against the creator's stated audience, labelled as such in the UI.
   - No scores, no "viral" language (AGENTS.md §8).
3. **Opportunities require a strategy.** Ideas must map to an active pillar, so no strategy means `missing_context`, and the page links to `/app/strategy`. The model returns `pillar_name`; the server maps it to the creator's active pillar id. Names outside the active pillars fail validation.
4. **Batch size 5** per generation (one AI generation). `quality` tier, `maxOutputTokens: 6_000`.
5. **Duplicate control.**
   - The prompt receives the topics of the creator's last 40 non-dismissed ideas and the last 20 dismissed ones, marked "don't repeat".
   - After generation, the server also drops any idea whose normalised topic (lowercased, whitespace-collapsed) matches an existing idea.
   - If every idea is dropped, the result is `invalid_output` and nothing is stored. A partial batch is stored with the count the creator actually got.
6. **Backlog cap as a cost control.** If the creator has **20 or more `new` (untriaged) ideas**, generation is refused (`backlog_full`): "Review your current ideas first: save or dismiss some, then generate more." This is on top of the existing daily cap and in-flight guard (2 minutes, same as strategy).
7. **Schema change (additive):** `content_ideas.platform text`, `content_ideas.rationale text`, `content_ideas.ai_generation_id uuid` (provenance, no FK, same reasoning as `creator_strategies`), plus index `(user_id, created_at desc)` for the list. No RLS changes: the existing own-row policies cover the new columns.
8. **Triage only in this part.** Statuses used: `new`, `saved`, `dismissed`; transitions `new→saved`, `new→dismissed`, `saved→dismissed`, `saved→new` ("Unsave"), `dismissed→new` ("Restore"). `planned`, `in_production` and `used` belong to calendar and studio and can't be set from this page. Status changes go through a server action with an allow-listed transition table.
9. **No dead next steps.** There is no "Create in Studio" or "Add to calendar" button until those routes exist. The card's next action is the CTA text plus Save.
10. **Insert via the creator's RLS-scoped client** in one `insert([...])` call (a single statement, so atomic). No new database function is needed.
11. **Success feedback:** a Sonner toast "5 new ideas added" (or the real count), shown by the client control when the action returns `ok`, while the list re-renders via `revalidatePath`. No redirect is needed (same page). Errors stay inline.
12. **Views via `?view=new|saved|dismissed`** (default `new`), read on the server behind `Suspense`. Invalid values fall back to `new`.

## Files Likely to Change

| File | Change |
|---|---|
| `supabase/migrations/20261013000100_content_ideas_opportunity_fields.sql` (new) | Columns + index |
| `lib/supabase/database.types.ts` | New columns |
| `lib/schemas/opportunities.ts` | Model schema factory, app validation, `OpportunityView` type, status transition table |
| `lib/ai/prompts/content_opportunities/v1.ts` (new), `registry.ts`, `models.ts` | Prompt, registry, route |
| `lib/services/opportunities.ts` (new) | `generateContentOpportunities()`, `listOpportunities()`, `updateOpportunityStatus()` |
| `app/app/opportunities/page.tsx`, `actions.ts` (new) | Route + server actions |
| `components/opportunities/*` (new) | List, card, generate control, view tabs, empty states |
| `lib/app-shell/nav-items.ts` | Opportunities becomes live |
| `components/settings/privacy-section.tsx` | Mention opportunities in what's stored (re-check copy stays true) |
| `tests/**` | See Checks |
| `PHASES.md` | Tick "Opportunities" |

## Database Changes

```sql
alter table public.content_ideas
  add column platform text,
  add column rationale text,
  add column ai_generation_id uuid;

create index content_ideas_user_id_created_at_idx
  on public.content_ideas (user_id, created_at desc);
```

- `platform` is unconstrained text, validated by the app's `platform` enum (same reasoning as `creator_profiles.platforms`).
- No new check constraints, so `DB_ENUM_COLUMNS` and the schema-parity test are unchanged.
- RLS and grants are unchanged (column additions inherit the table grants).
- Rows cascade from `users` as before.

## Implementation Requirements

1. **Schemas (`lib/schemas/opportunities.ts`)**
   - `opportunityModelSchemaFor(allowedEvidenceKinds)`: `{ opportunities: [{ topic, audience_need, angle, hook, format, platform, pillar_name, rationale, cta, difficulty, audience_fit, evidence: [{ kind, summary }] }] }`. All keys required (strict mode); `kind` is an enum of only the allowed kinds.
   - `opportunityOutputFor({ pillarNames, platforms, allowedEvidenceKinds })`, the app validation:
     - Exactly 5 opportunities, with unique topics (case-insensitive).
     - Lengths: topic ≤ 120, audience_need ≤ 300, angle ≤ 300, hook ≤ 200, format ≤ 60, rationale ≤ 400, cta ≤ 200.
     - `platform` must be one of the creator's platforms, and `pillar_name` one of the active pillar names (case-insensitive match).
     - 1–3 evidence items each, summary ≤ 300.
   - `IDEA_STATUS_TRANSITIONS` and `canTransition(from, to)`.
2. **Prompt (`content_opportunities/v1`)**
   - Role: opportunity strategist for early-stage creators. Input is the rendered context (profile, brand, pillars, strategy, recent content, performance, insights) plus the "don't repeat" topic list (delimited as data).
   - Rules:
     - Each idea fits a pillar and a selected platform, and is realistic for the creator's experience level and capacity.
     - The hook is in the creator's voice and honours the never-do list.
     - Evidence cites only the allowed kinds, and must say plainly when it comes from the creator's own description.
     - No invented statistics, trends, competitor claims or "viral" language.
     - No engagement bait, deception or impersonation.
     - Spread ideas across pillars and difficulty levels.
3. **Service (`lib/services/opportunities.ts`)**, following `creator-strategy.ts` conventions (never throws; logs codes only):
   - `generateContentOpportunities(client, userId, deps)`:
     1. Build context. No strategy or no active pillars → `missing_context`.
     2. Backlog check: count `new` ideas; ≥ 20 → `backlog_full`.
     3. In-flight guard: a pending `content_opportunities` generation in the last 2 minutes → `in_progress`.
     4. Load the "don't repeat" topics.
     5. `run` with the per-request schemas.
     6. Drop duplicates against existing topics.
     7. Map `pillar_name` to `pillar_id`; compute `evidence_strength`; set `trend_signal` and `content_gap` to null, `source: 'ai'`, `status: 'new'`, `ai_generation_id`.
     8. Insert all rows in one call. Return `{ ok: true, created: n }`.
   - `listOpportunities(client, userId, view)`: rows for the view, newest first, limit 50, joined with the pillar name. Evidence re-validated with `ideaEvidence`; rows that fail are skipped and logged, not crash the page.
   - `updateOpportunityStatus(client, userId, ideaId, to)`: reads the current status (RLS-scoped), checks `canTransition`, updates with `.eq("id").eq("user_id")`. Returns `not_found` / `invalid_transition` / `db_error`.
   - Error table `OPPORTUNITY_ERRORS` = `AI_ERRORS` plus `missing_context`, `backlog_full`, `in_progress`, with creator-facing messages.
4. **Server actions (`app/app/opportunities/actions.ts`)**:
   - `generateOpportunitiesAction()` returns `{ status, message, retryable, created }` and revalidates `/app/opportunities`.
   - `updateOpportunityStatusAction(formData)` validates `id` as a uuid and `status` against `ideaStatus`, calls the service, and revalidates.
   - Both start with `auth.protect()` and never take a user id from the client.
5. **Page `/app/opportunities`**: static header; session-bound content behind `Suspense`.
   - States:
     - no strategy: card linking to `/app/strategy` (or `/onboarding` when onboarding is incomplete);
     - empty view: a view-specific message, with a Generate button on `new`;
     - list;
     - load error.
   - Generate control (button + inline error + pending text "Finding ideas… this can take up to a minute") sits in the header area of the `new` view.
   - Backlog count is shown ("12 ideas waiting for review").
6. **Nav**: Opportunities becomes live (`href` union widened).

## AI Behavior

- **Input:** `renderContextForPrompt` with `profile, brand, pillars, strategy, recentContent, performance, insights`, plus the delimited "don't repeat" topic list and the selected platforms. No name, email or ids.
- **Model:** `content_opportunities` kind, `quality` tier, via `runStructured` (daily cap, metering, `store: false`).
- **Output:** strict per-request schema, then app validation (above), then server-side dedupe and signal computation.
- **Failure:** every `AiErrorCode` plus the new codes map to messages; nothing is stored on failure; an insert failure after a successful generation returns `persistence_error` (generation already metered; retry allowed).
- **Persistence:** rows in `content_ideas` with `prompt_version` recoverable via `ai_generation_id → ai_generations`. Prompt text and raw output are not stored.
- **Usage controls:** daily cap, in-flight guard, 20-idea backlog cap, 5 ideas per call.

## Security Requirements

- `auth.protect()` in the page and both actions. All reads and writes use `createUserClient()` (RLS); the composite FK prevents pointing an idea at another creator's pillar.
- The status action validates the uuid and status, checks ownership via an RLS-scoped read, and allow-lists transitions.
- Creator and model text is rendered as text only. `view` is allow-listed.
- No secrets client-side.

## Acceptance Criteria

1. The migration applies on pglite; the existing RLS isolation tests still pass for `content_ideas`, and new columns are covered by an owner insert/read test.
2. With a strategy, **Generate** stores 5 ideas (fewer only after dedupe), each with a pillar from the active pillars, a selected platform, 1–3 evidence items of allowed kinds, `evidence_strength = 'low'` (no analytics yet), and `trend_signal`/`content_gap` null. A toast reports the real count.
3. A second click while one is running returns "already finding ideas"; with 20 untriaged ideas, Generate is refused with the backlog message and no AI call.
4. Save / Dismiss / Unsave / Restore move ideas between views; disallowed transitions (for example `dismissed→saved`, anything to `planned`) are rejected server-side.
5. Without a strategy, the page explains why and links to it; no AI call.
6. Cards never show a trend, virality or numeric score; evidence shows its kind label ("From your profile").
7. AI disabled / not configured / cap reached / provider failure each show an inline recoverable message.
8. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` pass.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build   # new route, actions, migration types
```

New tests:
- `tests/schemas/opportunities.test.ts`: model schema per evidence kind set (disallowed kinds rejected), no optional keys, app validation (count, unique topics, pillar and platform membership, lengths), transition table.
- `tests/services/opportunities.test.ts`: missing context, backlog cap, in-flight guard (no AI call in each), dedupe (partial and all-duplicate), pillar mapping, server-computed signals (`low` vs `medium`, null trend/gap), single insert payload shape, AI error mapping, insert failure, status transitions (`not_found`, `invalid_transition`, success), list skips invalid evidence rows.
- `tests/db/opportunity-fields.test.ts` (pglite): new columns exist, owner can insert/read them, another creator can't read them (RLS), index exists.
- `tests/ai/prompts.test.ts`: `content_opportunities` registered with data-delimiter and no-fabrication rules.
- `tests/ai/live.test.ts`: opt-in live call validates.

## Manual Test Procedure

1. Apply the new migration in Supabase (SQL editor or `supabase db push`).
2. `pnpm dev`, sign in with an account that has a strategy. The sidebar shows **Opportunities** as a link.
3. Open it: empty state with **Generate ideas**. Click it: pending text, then a toast "5 new ideas added" and 5 cards. Check that each card's pillar is one of your pillars, the platform is one you picked, and evidence reads "From your profile".
4. Expand a card: audience need, angle, hook, CTA, why it fits, evidence. No trend or score anywhere.
5. Save one, dismiss one. Switch views via the tabs: they appear under Saved / Dismissed. Unsave and Restore move them back.
6. Generate again: no repeated topics. Settings → AI usage goes up by 1 per batch.
7. In SQL, mark 20 ideas `new` (or generate 4 batches): Generate is refused with the backlog message.
8. With an account without a strategy: the page links to the strategy page; no generation.
9. Failure paths: `AI_ENABLED=false`, missing key, `AI_DAILY_GENERATION_LIMIT=1`: inline messages, no toast.
10. 375px width, dark mode, keyboard: tabs, expand, Save/Dismiss reachable with visible focus.

## UI

- **Visual interpretation:** a review queue, not a feed. Calm cards in the existing flat style; each card is a decision ("make this or not").
- **Layout:**
  - `h1` "Opportunities" with a lead line ("Ideas that fit your strategy. Save the ones you'll make.").
  - Below it, a row with the view tabs (New · Saved · Dismissed, with counts) and, on New, the Generate button aligned right (stacks under the tabs on mobile).
  - A one-line honesty note: "Ideas are based on your profile, strategy and (once connected) your performance. Trend research isn't connected yet."
  - Cards in a single column (max ~`max-w-3xl`) for readability.
- **Card:**
  - Top row: pillar chip, platform · format, difficulty.
  - Topic as `h3`, then the hook in a quote-styled line.
  - "Audience fit: High (AI judgment)" and "Evidence: Low · from your profile" as small labelled text, not coloured badges alone.
  - A `<details>` "Why this idea" with audience need, angle, rationale, CTA and evidence list (each with its kind label).
  - Actions: Save (primary small) and Dismiss (ghost); on Saved: Unsave and Dismiss; on Dismissed: Restore.
- **Typography:** existing scale; topic at `text-lg` bold; hook in `font-accent` italic, the brand serif already used for accent words.
- **Spacing:** `stack-md` between cards, `stack-sm` inside.
- **Behaviour:** status buttons are small forms posting to the action. Pending state disables that card's buttons, and the card fades while pending. Tabs are links (`aria-current="page"` on the active one).
- **Loading:** list skeleton (three card-shaped blocks) behind `Suspense`.
- **Empty:**
  - New: "No ideas waiting. Generate a batch based on your strategy."
  - Saved: "Ideas you save will show up here."
  - Dismissed: "Nothing dismissed."
- **Error:** inline `role="alert"` for generation and status failures; page-level load error card.
- **Responsive and mobile:** single column; card actions full-width stacked below 480px; tabs scroll horizontally if needed without page overflow.
- **Accessibility:** one `h1`; tabs are a `nav` with `aria-label="Opportunity views"`; signal labels are text; `<details>`/`<summary>` for disclosure; buttons ≥ 44px.

## Known Limitations / Follow-ups

- Evidence is self-reported only until part 2 (research signals) and Phase 5 (analytics); `evidence_strength` stays `low`.
- No manual "add my own idea" (`source: 'user'`) yet.
- No "Create in Studio" / "Add to calendar" until those routes exist (parts 3 and Phase 4).
- No scheduled daily generation (part 4 / Phase 7 jobs).
- Opportunities aren't regenerated when the strategy changes; old ideas keep their (possibly retired) pillar.
