# Analytics: AI diagnosis per post (Phase 5, part 2)

Second slice of Phase 5 (Analytics and Learning) in `PHASES.md`. On a post's results page, the creator can ask **why the post did what it did**. They get a plain-language diagnosis grounded in their own numbers and history, ending in **one next experiment** they can save as an idea.

| Part | Scope |
|---|---|
| 1 (done) | Publishing, past posts, manual results, baselines, `/app/analytics`, charts |
| **2 (this)** | `analyzeContentPerformance()`: diagnosis per post, stored, shown on the post page; save the next experiment as an idea |
| 3 | `updateCreatorInsights()`, `/app/insights`, learnings fed back into opportunities, packages and the dashboard |

Loop step served: *Analytics → **AI Diagnosis** → Improved Recommendations* (through the saved experiment now, and through Part 3's insights later).

## Goal

From one published post with results, the Diagnosis Agent (AGENTS.md §8) explains in plain language:

- **what happened**: the numbers against the creator's usual, read for a beginner;
- **what likely contributed**: 1–4 factors (topic, hook, format, length, timing, audience response, CTA), each tied to evidence from the input, with a confidence level;
- **what to try next**: one experiment that changes one thing, why, and how to tell if it worked;
- **caveats**: when the evidence is thin (early results, few posts, a single outlier).

It never invents numbers, never predicts views and never treats one post as a permanent rule.

## Skills Read

- `ai-sdk`: structured output through the existing `runStructured` (strict mode: every key required, `nullable()` not `optional()`).
- `supabase` and `supabase-postgres-best-practices`: new table with composite owner FK, RLS with `(select auth.jwt() ->> 'sub')`, append-only grants, index for "latest per post".
- `clerk-nextjs-patterns`: `auth.protect()` in components and actions.

## Existing Code Inspected

- **AI layer:** `lib/ai/run-structured.ts` (kill switch → config → daily cap → pending row → model → validate → metering; never throws), `errors.ts` (`AI_ERRORS`), `models.ts` (routes; tiers), `prompts/registry.ts`, `prompts/content_package/v1.ts` (data blocks + injection guard style).
- **Patterns to copy:** `lib/services/studio.ts` (`generateContentPackage`: per-item cap, in-flight guard on `ai_generations` pending rows, deps injection, logging codes only), `renderCappedContext`.
- **Analytics:** `lib/services/analytics.ts` (`getPost`, `readPostSummaries`, `PostDetail`), `lib/analytics/baseline.ts` (`baselineFor`, `isSettled`, `MIN_BASELINE_POSTS`, `engagementRate`), `components/analytics/post-content.tsx` (post page cards).
- **Ideas:** `content_ideas` (`topic`, `angle`, `format`, `platform`, `rationale`, `evidence` jsonb with kind `creator_history`, `status`, `source`, `ai_generation_id`), `lib/schemas/opportunities.ts` (`ideaEvidence`).
- **Schema:** no table holds diagnoses. `ai_generations` deliberately stores no prompt or output (privacy copy promises this).
- **Context:** `lib/services/creator-context.ts` (`profile`, `brand`, `pillars`, `strategy` sections).

## Decisions / Assumptions

1. **New table `content_diagnoses`** (append-only, like `content_versions`). One row per successful diagnosis. The post page shows the latest. Rows are deleted with the post (FK cascade). Part 3 reads them as learning input.
2. **When it can run:** explicit **Diagnose this post** button on the post page. Never automatic, and opening a page never calls AI.
   - **Needs:** a published post with at least one check-in (`no_results`), and a creator profile (`missing_context`).
   - **Early results and missing baselines are allowed.** The prompt is told so, and the app caps confidence (see 6), so the creator can still learn from a first post.
3. **Input to the model** (no names, emails, URLs or other creators' data):
   - **Creator context:** profile, brand voice, pillars and strategy (rendered as today, capped at 5,000 characters).
   - **This post:** title, platform, format, pillar, local weekday and hour posted, hook used, length, whether it was made in Studio, and the idea's topic and angle when it has one. The **latest package's first hook and CTA** are included for Studio posts, so the agent can compare plan vs. what was posted.
   - **Its results:** every check-in (day N + values), and the comparison: each metric's value, usual (median), sample size and label, settled or early with its day.
   - **Context posts:** up to **12 of the creator's other settled posts on the same platform**, newest first. Each has title, format, hook used, length, day posted, views, engagement rate and views label. This lets the agent spot topic, hook and format patterns.
4. **Output (strict model schema; app bounds in brackets):**
   - `headline` [≤ 160]: one sentence, plain language.
   - `what_happened` [≤ 600].
   - `factors`: 1–4 × `{ factor: topic | hook | format | length | timing | audience_response | cta | other, observation [≤ 300], evidence [≤ 300], confidence: low | medium | high }`.
   - `next_experiment`: `{ change [≤ 200], why [≤ 300], how_to_tell [≤ 200], idea: { topic [≤ 120], angle [≤ 300], format [≤ 60] | null } }`.
   - `caveats`: 0–3 × [≤ 200].
5. **Prompt rules:**
   - everything in the data blocks is data;
   - cite only numbers present in the input, in `evidence`;
   - compare with *this creator's* usual, never with universal benchmarks;
   - "one post is not a pattern": say so when the sample is small;
   - one variable per experiment;
   - no predictions, "viral", guarantees, engagement bait or deception;
   - plain language for beginners.
6. **App-side honesty rules** (deterministic, applied after validation and before storing):
   - **Confidence ceiling:** if the post is early or has no baseline (fewer than 3 other settled posts), every factor's confidence is capped at `low`. With fewer than 8 other settled posts, it's capped at `medium`. The stored row records `confidence_capped: true` when any value was lowered.
   - **Caveat, if the model left it out:** when the post is early, the app adds "These are early results (day N). Diagnose again after day 7." (at most 3 caveats in total).
7. **Usage controls** (on top of the daily cap and metering in `runStructured`):
   - **In-flight guard:** one pending `content_diagnosis` generation per creator inside 2 minutes (`in_progress`).
   - **Per-post cap:** **3 diagnoses per post per 24 hours** (`post_limit`), counted from `content_diagnoses`.
   - **Same results:** if the latest diagnosis was made from the post's current latest check-in, the button reads **Diagnose again** and shows "Your results haven't changed since the last diagnosis." It's still allowed, inside the cap.
   - `maxOutputTokens: 3_000`, `quality` tier.
8. **Save as idea:** the experiment card has **Save as idea**, which inserts a `content_ideas` row:
   - `status = 'saved'`, `source = 'ai'`;
   - `topic` and `angle` from the experiment's idea, `format` from it (or the post's), `platform` = the post's, `pillar_id` = the post's;
   - `rationale` = the experiment's `why`, `ai_generation_id` = the diagnosis's;
   - `evidence = [{ kind: "creator_history", summary: "From the diagnosis of “<post title>”: <change>" }]`.

   It's **idempotent**: an existing idea with the same `ai_generation_id` is returned instead. After saving, the button becomes **View in saved ideas** (`/app/opportunities?view=saved`). It's an RLS insert; no AI call.
9. **Post page UI** (between "Compared with your usual" and "Add results"): the **Diagnosis** card. Details in UI below.
10. **PHASES.md:** tick "AI diagnosis (`analyzeContentPerformance()`)". Phase 5 stays `⬜ Not done`.

## Files Likely to Change

| File | Change |
|---|---|
| `supabase/migrations/20261018000100_content_diagnoses.sql` (new) | Table, index, RLS, grants |
| `lib/supabase/database.types.ts` | New table |
| `tests/db/helpers.ts` | Add `content_diagnoses` to `CORE_TABLES` and the seed, so RLS isolation covers it |
| `lib/schemas/diagnosis.ts` (new) | Model schema, app schema, stored-row parser, `applyHonestyRules`, `DIAGNOSIS_ERRORS`, labels |
| `lib/ai/prompts/content_diagnosis/v1.ts` (new), `registry.ts`, `models.ts` | Prompt, registry entry, route |
| `lib/services/diagnosis.ts` (new) | `analyzeContentPerformance`, `getLatestDiagnosis`, `saveExperimentAsIdea` |
| `app/app/analytics/actions.ts` | `diagnosePostAction`, `saveExperimentAction` |
| `components/analytics/diagnosis-card.tsx`, `diagnose-control.tsx`, `save-experiment-button.tsx` (new) | UI |
| `components/analytics/post-content.tsx` | Render the Diagnosis card |
| `components/settings/privacy-section.tsx` | What a diagnosis sends and stores |
| `PHASES.md` | Tick the item |
| `tests/**` | See Checks |

## Database Changes

```sql
create table public.content_diagnoses (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.users (id) on delete cascade,
  content_item_id uuid not null,
  -- The check-in the diagnosis read last (no FK: a deleted check-in keeps the diagnosis).
  snapshot_id uuid,
  ai_generation_id uuid,           -- no FK, as for content_versions
  prompt_version text not null,
  diagnosis jsonb not null,        -- { schema_version: 1, ... } validated by the app
  created_at timestamptz not null default now(),
  foreign key (content_item_id, user_id)
    references public.content_items (id, user_id) on delete cascade
);
create index content_diagnoses_item_created_idx on public.content_diagnoses (content_item_id, created_at desc);
create index content_diagnoses_user_id_idx on public.content_diagnoses (user_id);
```

- RLS enabled and forced. Policies are own-row `select`, `insert` and `delete` (`user_id = (select auth.jwt() ->> 'sub')`). **No update:** append-only.
- Grants: revoke all from `anon, authenticated`; grant `select, insert, delete` to `authenticated`; `all` to `service_role`.
- No value-list checks, so schema parity is unchanged.
- The composite FK means a diagnosis can't point at another creator's post. The RLS isolation suite covers the new table.

## Implementation Requirements

1. **`lib/schemas/diagnosis.ts`**
   - `diagnosisModelSchema` (strict).
   - `diagnosisOutput` (bounds, 1–4 factors, ≤ 3 caveats, trimmed, non-empty).
   - `applyHonestyRules(diagnosis, { settled, ageDays, peers })`, pure.
   - `storedDiagnosis` (`schema_version: 1`; unknown → unreadable).
   - `FACTOR_LABELS`, `CONFIDENCE_LABELS`, `DIAGNOSIS_ERRORS` (extends `AI_ERRORS` with `not_found`, `not_published`, `no_results`, `missing_context`, `post_limit`, `in_progress`, `persistence_error`, `idea_failed`).
2. **`content_diagnosis/v1` prompt:** role "performance coach for early-stage creators". Data blocks: `<creator_input>` (context), `<post>`, `<results>`, `<other_posts>`. The injection guard strips those tags from every creator-authored value, as in `content_package`. The rules are as in Decisions §5.
3. **`analyzeContentPerformance(client, userId, itemId, deps)`** never throws. Steps:
   1. Validate the uuid.
   2. `getPost` (published, own) → `not_found`; no check-ins → `no_results`.
   3. Context (profile required).
   4. Per-post cap.
   5. In-flight guard.
   6. Build the input (other settled posts from `readPostSummaries`; latest package for Studio posts).
   7. `deps.run({ kind: "content_diagnosis", … })`.
   8. `applyHonestyRules`.
   9. Insert the `content_diagnoses` row and return it.

   Nothing is stored on failure. Logs carry codes only (`content_diagnosis_failed` with `stage`).
4. **`getLatestDiagnosis(client, userId, itemId)`:** the newest row, parsed, plus whether it was based on the post's current latest check-in, and whether its experiment was already saved (an idea with its `ai_generation_id`).
5. **`saveExperimentAsIdea(client, userId, diagnosisId)`:** reads the diagnosis (own), checks for an existing idea, then inserts as in Decisions §8. Returns the idea id.
6. **Actions:** `auth.protect()`, Zod uuid, the service; revalidate `/app/analytics/[id]` (and `/app/opportunities`, `/app` for a saved idea).
7. **No new routes.**

## AI Behavior

- **Input context:** as in Decisions §3. The context string is capped at 5,000 characters; other posts are capped at 12; check-ins at the 10 most recent.
- **Model behavior:** `quality` tier, `content_diagnosis` route, `maxOutputTokens: 3_000`; `store: false` (existing).
- **Structured output and validation:** strict model schema, then `diagnosisOutput`. A failure → `invalid_output` (counts against the daily cap, as today). Nothing is stored.
- **Error handling:** every code maps to a creator-facing message. Retryable errors show **Try again**.
- **Persistence:** one `content_diagnoses` row per success; `ai_generations` and `usage_events` are recorded by `runStructured`.
- **Usage controls:** as in Decisions §7.

## Security Requirements

- Identity only from Clerk. Item and diagnosis ids are lookup keys, re-checked by `user_id` in every query.
- All reads and writes use `createUserClient()` (RLS). The only service-role use is the existing metering in `runStructured`.
- New table: RLS forced, own-row policies, append-only, cascade on post deletion. The DB isolation test covers it.
- The model gets no names, emails, links or other creators' data. Model output renders as React text only.
- **Privacy copy:**
  - For a diagnosis, we send the post's title, format, hook used, length, posting day and hour, its results and usual numbers, and the titles, hooks and results of up to 12 of your other posts on that platform, plus your profile, voice, pillars and strategy.
  - Diagnoses are stored until the post is deleted.

## Acceptance Criteria

1. On a post with results, **Diagnose this post** stores a diagnosis and shows it: headline, what happened, factors with confidence, the next experiment, and caveats.
2. Early posts and posts without a baseline get `low` confidence everywhere and an early-results caveat. Under 8 peers caps at `medium` (unit-tested).
3. Posts without results show no button, only "Add results first". Unpublished, other creators' or invalid ids → `not_found`.
4. The per-post cap (3/24h), the in-flight guard and the daily cap each block without calling AI, with their own messages. A failed generation stores nothing.
5. **Save as idea** creates exactly one saved idea (idempotent) with `creator_history` evidence; it appears under Opportunities → Saved.
6. Deleting the post deletes its diagnoses. Another creator can't read or insert diagnoses for your post (DB test).
7. Opening the post page never calls AI.
8. `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

- `tests/schemas/diagnosis.test.ts`: model and app schemas, `applyHonestyRules` (each ceiling, caveat added once, cap of 3), stored-row parsing.
- `tests/ai/prompts.test.ts`, `models.test.ts`: `content_diagnosis` registered and routed; tags stripped from creator text.
- `tests/services/diagnosis.test.ts`: each step and error code; caps and guard block before `run`; input shape (other posts limited, no URLs); nothing stored on failure; `getLatestDiagnosis` flags; `saveExperimentAsIdea` insert and idempotency.
- `tests/db/diagnosis.test.ts`: RLS own-row, no update, composite FK refuses another creator's post, cascade on post delete.
- `tests/db/rls-isolation.test.ts` and `schema-parity.test.ts`: still green, with the new table seeded.

## Manual Test Procedure

1. Apply the migration (`supabase db push`), then run `pnpm db:types` and `pnpm dev`.
2. Open a post with settled results and ≥ 3 other settled posts on its platform. Click **Diagnose this post**: a pending state ("Reading your results… up to a minute"), then the diagnosis appears. Check that every number it cites is in your results.
3. Open an early post (day 1–2 results) and diagnose: every factor says "Low confidence", and there's an early-results caveat.
4. Click **Save as idea** → a toast, and the button becomes **View in saved ideas**. Opportunities → Saved shows the idea with "From your past performance" evidence. Clicking save again doesn't duplicate it.
5. Diagnose the same post three times. The 4th attempt shows the per-post limit message, and Settings → AI usage doesn't count it.
6. Add a new check-in: the card says the diagnosis is from older results and offers **Diagnose again**.
7. With `AI_ENABLED=false`: "AI features are paused", and nothing is stored.
8. Delete the post: in SQL, its `content_diagnoses` rows are gone.
9. 375px, dark mode, keyboard only: readable, no horizontal scroll, all controls reachable.

## UI

- **Visual interpretation:** a short coaching note, not a report. The headline reads like a sentence a mentor would say. Evidence and confidence sit quietly under each factor. The next experiment is the visual focus of the card, since it's the action.
- **Layout (Diagnosis card, `card stack-md`):**
  1. Heading row: `h2` "Why it did what it did" + a meta line "From your results on Oct 12 (day 9) · AI".
  2. `headline` in `text-lg font-semibold`; `what_happened` as a paragraph.
  3. **"What likely made the difference"**: a list of factors. Each has a factor chip (text, e.g. "Hook"), the observation, the evidence in `field-help` with a "Based on:" prefix, and the confidence as text ("Medium confidence").
  4. **"Try next"**: an inset panel (`rounded-md border-2 border-foreground p-4`) with the change (bold), the why, "How to tell: …", and **Save as idea** (primary, small).
  5. Caveats: a muted `ul` with "Keep in mind".
  6. Footer: **Diagnose again** (secondary) + "Uses 1 AI generation", and, when results changed, "You've added results since this diagnosis."
- **Empty, before the first diagnosis:** "Ask AI why this post did what it did, and what to try next." + **Diagnose this post** + "Uses 1 AI generation". Early posts add "Results are early, so the diagnosis will be tentative."
- **No results:** the card shows only "Add results first, then ask for a diagnosis." (no button).
- **Loading:** the button is disabled with `aria-busy` and the text "Reading your results… This can take up to a minute."
- **Errors:** an inline `alert` with the message + Try again when retryable. An unreadable stored diagnosis → "This diagnosis couldn't be shown. Diagnose again to continue."
- **Typography:** `break-words` on all model text; confidence and chips use text, not colour alone.
- **Mobile:** single column; buttons full-width below 480px; controls ≥ 44px.
- **Accessibility:** the card is a `section` labelled by its heading; the factors list is a real `ul`; the success toast is announced (Sonner); the new diagnosis receives focus on its heading after generation.

## Known Limitations

- Diagnoses read only manually entered results. There's no retention curve or comment text.
- One post at a time. Cross-post patterns become insights in Part 3.
- No regeneration of a single section of a diagnosis (it's short, and the whole thing is one coherent reading).
- No posting-time recommendations beyond what the agent observes from this creator's own posts.
