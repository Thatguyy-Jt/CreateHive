# Creator insights and the learning loop (Phase 5, part 3)

Last slice of Phase 5 (Analytics and Learning) in `PHASES.md`. The **Learning Agent** looks across the creator's posts with week-old results (and their diagnoses) and stores a small set of **patterns** in `creator_insights`. Each pattern says what seems to work or not for this creator, how sure we are, which posts it rests on, and what to do with it. Those insights then feed back into opportunity and package generation and appear on the dashboard and a new `/app/insights` page.

| Part | Scope |
|---|---|
| 1 (done) | Publishing, past posts, manual results, baselines, `/app/analytics`, charts |
| 2 (done) | `analyzeContentPerformance()`: diagnosis per post, save the next experiment as an idea |
| **3 (this)** | `updateCreatorInsights()`, `/app/insights`, learnings fed back into opportunities, packages and the dashboard |

Loop step served: *Analytics → AI Diagnosis → **Learning → Improved Recommendations***.

## Goal

1. From the creator's settled posts, find **0–6 patterns** (topic, hook, format, duration, CTA, audience, underperformance), each backed by **at least 2 of their own posts**, with confidence the app caps by sample size, and **one next step** each.
2. Show them at `/app/insights`, where the creator can dismiss what doesn't ring true.
3. Feed active insights into opportunities and Content Studio packages with an explicit rule on how to weigh them, and replace the raw snapshot dump in the creator context with per-post results compared with their usual.
4. Replace the dashboard's "What AI learned — Coming soon" placeholder with the real thing.

It never treats one post as a pattern, never invents numbers and never predicts results (AGENTS.md §8 Learning Agent).

## Skills Read

- `ai-sdk`: structured output through the existing `runStructured` (strict mode: every key required, `nullable()` not `optional()`).
- `supabase` and `supabase-postgres-best-practices`: column additions, a `security invoker` RPC for the atomic replace, RLS unchanged (own-row CRUD already exists on `creator_insights`).
- `clerk-nextjs-patterns`: `auth.protect()` in components and actions.

## Existing Code Inspected

- **Schema:** `creator_insights` already exists (core migration): `insight_type` (`topic | hook | format | duration | cta | audience | underperformance | other`), `summary`, `evidence jsonb`, `confidence`, `sample_size`, `status` (`active | dismissed | superseded`), timestamps, own-row RLS for select/insert/update/delete, index `(user_id, status)`. Seeded in `tests/db/helpers.ts`; covered by `rls-isolation.test.ts`.
- `lib/schemas/insights.ts` (`insightEvidenceItem`: `observation`, `content_item_id?`, `metric?`, `value?`, `baseline?`), `lib/schemas/enums.ts` (`insightType`, `insightStatus`, `signalLevel`).
- `lib/services/creator-context.ts`: `insights` section already loads active insights (no limit) and renders a `learned_insights` block; `performance` renders the 30 newest raw snapshots with no post attached (Part 1 left a note that Part 3 reworks it).
- `lib/services/opportunities.ts` and `lib/services/studio.ts` already include `performance` and `insights`; `renderCappedContext` trims them.
- `lib/ai/prompts/content_opportunities/v2.ts`, `content_package/v1.ts`: mention insights only as citable `creator_history`; no rule on how to weigh them.
- `lib/services/diagnosis.ts` and `analytics.ts` (`readPostSummaries`, `PostSummary`), `lib/analytics/baseline.ts` (`baselineFor`, `isSettled`, `MIN_BASELINE_POSTS`, `METRICS`), `lib/analytics/format.ts`.
- `lib/ai/run-structured.ts`, `models.ts`, `prompts/registry.ts`, `limits.ts`.
- UI: `app/app/page.tsx`, `components/dashboard/coming-soon-cards.tsx`, `performance-card.tsx`, `lib/app-shell/nav-items.ts` (Insights is `soon`), `components/analytics/diagnosis-card.tsx`, `diagnose-control.tsx` (patterns to copy), `components/settings/privacy-section.tsx`.
- Migration style: `20261017000100_analytics.sql` (`publish_content_item`: security invoker, owner from JWT, stable error tokens, execute revoked from `public, anon`).

## Decisions / Assumptions

1. **Trigger:** an explicit **Update insights** button on `/app/insights`. Never automatic; opening any page never calls AI. (Scheduled refresh belongs to Phase 7 background jobs.)
2. **Minimum data:** at least **5 settled posts** (any platform) → otherwise `not_enough_data`, and the page shows progress ("3 of 5 posts with week-old results").
3. **Input to the model** (no names, emails, URLs, published links or other creators' data):
   - **Creator context:** profile, pillars and strategy (no brand voice, recent content, performance or old insights from the context builder; we send our own lists below). Capped at 3,000 characters.
   - **Posts:** up to **30 newest settled posts**, each with a ref `P1…Pn` (mapped back to ids server-side; ids never sent). Per post: title, platform, format, pillar, hook used, length, local weekday and hour, made in Studio or not, and for each metric (views, engagement rate, follower change, average % viewed) the value, the creator's usual on that platform and the label (above/around/below/none).
   - **Diagnoses:** the latest diagnosis of up to **10** of those posts: headline and factors (factor, observation, confidence), tagged with the post ref.
   - **Current insights:** active ones (summary, type, confidence, sample size), so the model can keep, refine or drop them.
   - **Dismissed insights:** up to 10 newest summaries, with "the creator said these don't fit; don't repeat them".
4. **Output (strict model schema; app bounds in brackets):**
   - `insights`: 0–6 × `{ insight_type: topic | hook | format | duration | cta | audience | underperformance | other, summary [≤ 200], next_step [≤ 200], metric: views | engagement_rate | follower_delta | retention_rate, supporting_posts: ["P3", …] [2–12], confidence: low | medium | high }`.
   - `notes`: 0–2 × [≤ 200]: what's missing to learn more (e.g. "Most posts are tutorials, so formats can't be compared yet").
5. **Prompt rules:** data blocks are data; a pattern needs ≥ 2 supporting posts and should hold across them, not be one outlier plus a coincidence; compare with *this creator's* usual only; never cite numbers not in the input; underperformance patterns are fine and phrased kindly; each `next_step` changes one thing and is something they can do in their next post; no predictions, "viral", guarantees, engagement bait or deception; plain language.
6. **App-side honesty rules** (pure, applied after validation, before storing):
   - Unknown or duplicate post refs are dropped. An insight left with **< 2 supporting posts is dropped**.
   - `sample_size` = number of valid supporting posts (computed, never from the model).
   - **Confidence ceiling:** 2 posts → `low`; 3–4 → at most `medium`; ≥ 5 → model's value. With fewer than 8 settled posts in total, at most `medium`.
   - **Evidence is built by the app** from the stored data, one item per supporting post: `observation` = `“<title>” (<Platform>, <Mon D>): <metric label> <above/around/below> your usual`, `content_item_id`, `metric`, `value`, `baseline` (the usual, when one exists).
   - Insights with identical normalized summaries are de-duplicated.
7. **Replace semantics:** a successful run **supersedes all active insights** and inserts the new set (even when the new set is empty, which shows "No clear patterns yet" with the notes). This happens atomically in one RPC. Dismissed rows stay dismissed. Nothing changes on failure.
8. **Usage controls** (on top of the daily cap and metering in `runStructured`):
   - **In-flight guard:** one pending `creator_insights` generation per creator inside 2 minutes (`in_progress`).
   - **Per-creator cap:** **3 updates per 24 hours** (`update_limit`), counted from `ai_generations` (kind `creator_insights`, status `succeeded`).
   - **Nothing new:** if no settled post's latest check-in is newer than the last successful update, the button reads **Update again** with "No new results since your last update." It's still allowed, inside the cap.
   - `maxOutputTokens: 4_000`, `quality` tier.
9. **Dismiss / Undo:** each insight has **Dismiss** (status → `dismissed`, RLS update, no AI). The toast offers **Undo** (back to `active`, only if the row is still `dismissed` and not from a superseded run: undo is allowed only for rows with the latest `ai_generation_id`).
10. **Learning feedback loop:**
    - **Context `insights` section:** loads active insights with `next_step`, limited to **8**, high confidence first; renders `[type, confidence, n=…] summary — Next: next_step`.
    - **Context `performance` section reworked:** instead of raw snapshots, up to **15 newest posts with results**: `title | platform | format | posted date | views (label vs usual) | engagement rate (label)`; early posts say `early, day N`. Built from `readPostSummaries` + `baselineFor`. Title passes through `clean()`.
    - **Prompt versions:** `content_opportunities/v3` and `content_package/v2` (copies of the active versions; schema unchanged) add a "Learned insights" rule: *these are patterns from this creator's own results; lean on high and medium confidence ones; treat low confidence ones as something to test, not a rule; never let an insight override the pillars, voice or never-do list; when an idea builds on one, cite it as `creator_history` evidence naming the pattern*. The registry points at the new versions.
    - Diagnosis, strategy and weekly plan are unchanged.
11. **No ranking changes** in `getDailyRecommendation()`: insights are free text, and matching them to ideas without AI would be guesswork. Ideas built on insights already carry `creator_history` evidence, which the ranking counts as evidence.
12. **PHASES.md:** tick "Creator insights", "Learning feedback loop into recommendations" and "Analytics and insights routes"; Phase 5 → `✅ DONE` and the overview table updated.

## Files Likely to Change

| File | Change |
|---|---|
| `supabase/migrations/20261019000100_creator_insights_learning.sql` (new) | Columns, index, `replace_creator_insights` RPC |
| `lib/supabase/database.types.ts` | New columns and function |
| `lib/schemas/insights.ts` | Model schema, app schema, `applyInsightRules`, stored-row parser, `INSIGHT_ERRORS`, labels |
| `lib/ai/prompts/creator_insights/v1.ts` (new), `content_opportunities/v3.ts` (new), `content_package/v2.ts` (new), `registry.ts`, `models.ts` | Prompts, registry, route |
| `lib/services/insights.ts` (new) | `updateCreatorInsights`, `getInsightsOverview`, `getTopInsights`, `setInsightStatus` |
| `lib/services/creator-context.ts` | `insights` limit/order/`next_step`; `performance` rework |
| `lib/services/studio.ts` | `renderCappedContext` unchanged in logic; type follows the new `PerformanceContext` |
| `app/app/insights/page.tsx`, `app/app/insights/actions.ts` (new) | Route and actions |
| `components/insights/*` (new) | Page content, insight card, update control, dismiss button, readiness |
| `components/dashboard/learned-card.tsx` (new), delete `coming-soon-cards.tsx`, `app/app/page.tsx` | Dashboard card |
| `lib/app-shell/nav-items.ts` | Insights live |
| `components/settings/privacy-section.tsx` | What an insights update sends and stores |
| `PHASES.md` | Ticks, Phase 5 done |
| `tests/**` | See Checks |

## Database Changes

```sql
alter table public.creator_insights
  add column ai_generation_id uuid,     -- no FK, as for content_versions / content_diagnoses
  add column next_step text check (next_step is null or char_length(next_step) between 1 and 300);

create index creator_insights_user_generation_idx on public.creator_insights (user_id, ai_generation_id);

-- Atomically supersedes the caller's active insights and inserts the new set.
create function public.replace_creator_insights(p_generation_id uuid, p_insights jsonb)
returns integer   -- rows inserted
language plpgsql security invoker set search_path = '' ...
```

- Owner from `auth.jwt() ->> 'sub'`, never an argument; raises `42501` without one.
- `p_insights` must be a JSON array of ≤ 6 objects; each is inserted with `insight_type`, `summary`, `next_step`, `evidence`, `confidence`, `sample_size`, `status = 'active'`, `ai_generation_id = p_generation_id`. Existing checks validate values; a bad element aborts the whole call (`invalid_insights`, `22023`).
- `update … set status = 'superseded' where user_id = v_user_id and status = 'active'` runs first, in the same transaction.
- Execute revoked from `public, anon`; granted to `authenticated, service_role`.
- RLS, grants and value-list checks on the table are unchanged, so schema parity only gains the two columns.

## Implementation Requirements

1. **`lib/schemas/insights.ts`** (keeps `insightEvidence*`):
   - `insightsModelSchema` (strict) and `insightsOutput` (bounds, trimmed, non-empty, ref format `P\d+`).
   - `applyInsightRules(output, { posts: Map<ref, PostFacts>, settledTotal })`, pure: Decisions §6. Returns the rows to store.
   - `storedInsight` parser for reads (unknown evidence shape → evidence `[]`, row still shown).
   - `INSIGHT_TYPE_LABELS` ("Topic", "Hook", "Format", "Length", "Call to action", "Audience", "What's holding posts back", "Other"), `CONFIDENCE_LABELS`, `INSIGHT_ERRORS` (extends `AI_ERRORS` with `not_enough_data`, `missing_context`, `update_limit`, `in_progress`, `persistence_error`, `not_found`).
2. **`creator_insights/v1` prompt:** role "learning coach who spots patterns in one creator's own results". Data blocks `<creator_input>`, `<posts>`, `<diagnoses>`, `<current_insights>`, `<dismissed_insights>`; the injection guard strips those tags from every creator-authored value. Rules as in Decisions §5.
3. **`updateCreatorInsights(client, userId, tz, deps)`** never throws. Steps:
   1. Context (profile required → `missing_context`).
   2. `readPostSummaries`; settled posts < 5 → `not_enough_data`.
   3. Per-creator cap, then in-flight guard.
   4. Build input: 30 newest settled posts with refs and comparisons (`baselineFor` over all posts), extra columns (`hook_used`, `duration_seconds`) in one narrow read, latest diagnosis per post (one read, newest first, first per item), active and dismissed insights.
   5. `deps.run({ kind: "creator_insights", … })`.
   6. `applyInsightRules`.
   7. `replace_creator_insights` RPC. Return `{ ok: true, count, notes }`.

   Logs carry codes only (`creator_insights_failed` with `stage`). `notes` are returned to the UI only, not stored.
4. **`getInsightsOverview(client, userId, now)`:** active insights (high → low confidence, then sample size), readiness (`settled`, `needed: 5`), last successful update time, whether new results arrived since, updates used in the last 24h, and the latest generation id (for Undo). Never throws.
5. **`getTopInsights(client, userId)`:** up to 2 active insights + readiness for the dashboard; one light read.
6. **`setInsightStatus(client, userId, insightId, "dismissed" | "active")`:** uuid check; dismiss only from `active`; restore only from `dismissed` with the latest generation id → else `not_found`.
7. **Actions** (`app/app/insights/actions.ts`): `auth.protect()`, Zod, the service, `revalidatePath("/app/insights")` and `/app`.
8. **Context changes** as in Decisions §10, with explicit column lists. `buildCreatorContext` keeps its contract (never throws, `missing` list).

## AI Behavior

- **Input context:** Decisions §3; posts ≤ 30, diagnoses ≤ 10, dismissed ≤ 10, context ≤ 3,000 characters.
- **Model behavior:** `quality` tier, route `creator_insights`, `maxOutputTokens: 4_000`, `store: false` (existing).
- **Structured output and validation:** strict model schema, then `insightsOutput`, then `applyInsightRules`. A schema failure → `invalid_output` (counts against the daily cap, as today); nothing stored.
- **Error handling:** every code maps to a creator-facing message; retryable ones show **Try again**.
- **Persistence:** the RPC; `ai_generations` and `usage_events` by `runStructured`.
- **Downstream:** opportunities v3 and package v2 read the insights through the context (Decisions §10). Their output schemas and validation are unchanged.
- **Usage controls:** Decisions §8.

## Security Requirements

- Identity only from Clerk. Insight ids are lookup keys re-checked by `user_id`.
- All reads and writes use `createUserClient()` (RLS). The RPC is `security invoker` and takes the owner from the JWT.
- The model gets no names, emails, URLs, published links, post ids or other creators' data. Post refs are mapped server-side.
- Model output renders as React text only.
- **Privacy copy:** "To update your insights, we send the titles, formats, pillars, hooks, lengths, posting day and hour and results of up to 30 of your posts with week-old results, your usual numbers, short summaries of their diagnoses, your current and dismissed insights, and your profile, pillars and strategy. Insights are stored until you delete your account; dismissed ones are kept so they aren't suggested again. Active insights are included when we suggest ideas and write content packages."

## Acceptance Criteria

1. With ≥ 5 settled posts, **Update insights** stores 0–6 active insights, each with ≥ 2 supporting posts, a computed sample size, capped confidence, app-built evidence and a next step; previous active ones become `superseded`.
2. Fewer than 5 settled posts: no button, the readiness message instead. No profile: `missing_context`.
3. The per-creator cap (3/24h), the in-flight guard and the daily cap each block without calling AI. A failed generation changes nothing.
4. `applyInsightRules` drops single-post patterns and unknown refs, and caps confidence as specified (unit-tested).
5. Dismiss hides an insight, Undo restores it (latest run only). Dismissed summaries reach the next update's input.
6. Opportunity and package generation receive active insights (≤ 8, with next steps) and per-post performance lines; their prompts are `content_opportunities@v3` and `content_package@v2`.
7. The dashboard shows the top 2 insights, or the matching empty state; no AI call on any page load. Nav shows Insights as live.
8. Another creator can't call the RPC to touch your rows, or read/update your insights (DB test).
9. `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

- `tests/schemas/insights.test.ts`: model/app schemas; `applyInsightRules` (refs, < 2 dropped, each ceiling, total < 8 cap, evidence built from facts, de-dup); stored-row parsing.
- `tests/ai/prompts.test.ts`, `models.test.ts`: `creator_insights` registered and routed; new opportunities/package versions active; tags stripped from creator text; v3/v2 contain the insights rule.
- `tests/services/insights.test.ts`: each step and error code; caps and guard block before `run`; input shape (refs not ids, no URLs, limits); RPC called with app-built rows; nothing written on failure; overview flags; `setInsightStatus` rules.
- `tests/services/creator-context.test.ts`: insights limit/order/`next_step`; new performance lines (labels, early posts).
- `tests/db/insights.test.ts`: RPC supersedes and inserts atomically, rejects a bad element without changes, needs a JWT, only touches the caller's rows; anon can't execute.
- Existing `rls-isolation`, `schema-parity`, `opportunities`, `studio` tests updated and green.

## Manual Test Procedure

1. Apply the migration (`supabase db push`), `pnpm db:types`, `pnpm dev`.
2. With fewer than 5 settled posts, open `/app/insights`: readiness "N of 5 posts with week-old results" and a link to Analytics; no button. Dashboard card shows the same.
3. Log past posts with results captured ≥ 7 days after publishing until you have ≥ 5 (vary hooks and formats). Click **Update insights**: pending state, then insights appear. Check each "Based on N posts" lists real posts whose numbers match Analytics, and that 2-post insights say "Low confidence".
4. Click **Dismiss** on one → it disappears; **Undo** in the toast brings it back. Dismiss again, update again: the same pattern isn't suggested.
5. Update three times; the 4th shows the limit message and Settings → AI usage doesn't count it.
6. Generate opportunities: at least one idea may cite "From your past performance" evidence naming a learned pattern. In `ai_generations`, `prompt_version` is `v3` for opportunities and `v2` for packages.
7. Dashboard: "What AI learned" shows the top 2 insights with **See all insights**.
8. `AI_ENABLED=false`: "AI features are paused", nothing changes.
9. 375px, dark mode, keyboard only: readable, no horizontal scroll, controls reachable.

## UI

- **Visual interpretation:** a short notebook of "what we've noticed about your posts". Each insight is a plain sentence, then what to do about it, then quietly how sure we are and why. Words carry the meaning, not colours or scores.
- **`/app/insights` layout:** `h1` "Insights", lead "Patterns from your own results: what seems to work for you, and what to try next.", `field-help` "Based only on the numbers you've entered. Insights get more reliable as you add results."
  1. **Update panel** (`card stack-sm`): last updated ("Updated Oct 14 · from 9 posts") or "Not updated yet"; the new-results hint; **Update insights** / **Update again** (primary) + "Uses 1 AI generation · N of 3 updates left today".
  2. **Insight list** (`ul`, `stack-md`): one `card` per insight:
     - type chip (text, e.g. "Hook") + confidence text ("Medium confidence") on one row;
     - `summary` in `text-lg font-semibold break-words`;
     - "Try next: `next_step`" in an inset (`rounded-md border-2 border-foreground p-3`), with **Turn into idea →** linking to `/app/opportunities` (no AI call; the next generation already sees the insight);
     - `<details>` "Based on N posts": evidence lines, each linking to `/app/analytics/[id]`;
     - **Dismiss** (ghost, small).
  3. Notes from the latest run (when returned in this request) as a muted "Keep in mind" list.
- **Empty states:** not ready → readiness card with a progress line and **Go to Analytics**; ready but never updated → "Ready to look for patterns in your N posts." + the button; updated with 0 insights → "No clear patterns yet. Keep posting and add results; patterns need at least two posts that agree."
- **Loading:** route `loading.tsx` skeleton; the button is disabled with `aria-busy`: "Looking for patterns… This can take up to a minute."
- **Errors:** load failure uses the existing load-error pattern; action errors are an inline `alert` with **Try again** when retryable.
- **Dashboard card** (replaces `ComingSoonCards`, same grid slot): `h2` "What AI learned"; up to 2 insights (summary + confidence text); **See all insights**. Empty: readiness line + **Add results**; ready but none: "Ready to look for patterns." + **Open Insights**.
- **Typography / spacing:** existing tokens (`card`, `stack-*`, `text-heading`, `field-help`); `break-words` on model text.
- **Mobile:** single column; buttons full-width below 480px; controls ≥ 44px.
- **Accessibility:** each card is an `article` labelled by its summary; the list is a real `ul`; toasts announced (Sonner); after an update, focus moves to the list heading.

## Known Limitations

- Insights read only manually entered results; no retention curves or comment text.
- Updates are manual; no scheduled refresh until Phase 7 background jobs.
- No vector storage yet: insights reach prompts as text through the context builder.
- The daily recommendation ranking doesn't use insights directly (Decisions §11).
- An empty successful run supersedes earlier insights by design (they're kept as `superseded`, not deleted).
