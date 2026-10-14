# Daily recommendation and dashboard (Phase 3, part 4)

Last slice of Phase 3 (Opportunity Engine) in `PHASES.md`: the **Daily recommendations** and **Dashboard: "What should I do today?"** items. When both are done, Phase 3 is `✅ DONE`.

## Goal

Make `/app` answer *"What should I do today?"* in one glance (AGENTS.md §14), using what the creator already has: their calendar, saved and new ideas, posting capacity and strategy.

- One **primary recommendation** for today, with a plain-language reason and a working next action.
- The **top idea** worth acting on, with its evidence.
- The strategy card showing **this week's** focus from the 30-day plan (today it always shows Week 1).
- A one-line **AI usage** summary.
- Clearly labelled **"Coming soon"** cards for performance and "What AI learned" (Phase 5), with no fake data.

Loop step served: *Content Plan → Creation* (turn what's planned into today's action).

**No AI is used** (user's choice). The recommendation is computed from the creator's own data with fixed, tested rules, so it is free, instant and every reason traces back to a fact.

## Skills Read

- `clerk-nextjs-patterns` (`auth.protect()` in each session-bound component).
- Next.js docs `connection.md` and the Cache Components rule: anything that reads the current time sits behind `Suspense` and calls `await connection()` first (the bug fixed on Research in `a681cfc`).
- `supabase` (no schema change; reads through the creator's RLS client only).

## Existing Code Inspected

- `app/app/page.tsx`: heading, Clerk greeting, `DashboardStrategyCard` behind `Suspense`.
- `components/strategy/dashboard-strategy-card.tsx`: finish-setup / build-strategy / positioning states. **Bug:** always shows `thirty_day_plan[0]` ("Week 1 focus").
- `lib/services/weekly-plan.ts`: private `planWeekNumber(strategySavedAt, targetWeek, tz)`, the same week-of-plan logic the card needs.
- `lib/services/calendar.ts`: `getCalendarSetup()` (onboarded, hasStrategy, timezone, capacity) and `listWeek()` (validated week items with local `date`/`time`, plus saved ideas).
- `lib/calendar/dates.ts`: `todayIn`, `weekStart`, `shiftWeek`, `formatDay`, `formatTime`.
- `lib/schemas/opportunities.ts`: `storedOpportunity`, `EVIDENCE_KIND_LABELS`; `lib/schemas/enums.ts`: `signalLevel`, `difficulty`, `experienceLevel`.
- `lib/services/ai-usage.ts` (`getAiUsage`) and `components/settings/ai-usage-section.tsx` (`isAiEnabled`, `readDailyGenerationLimit`, `connection()`).
- `components/calendar/schedule-idea-form.tsx`: reusable inline Schedule form (date, time, toast).
- `app/app/calendar/actions.ts` and `app/app/opportunities/actions.ts`: their `revalidatePath` calls (neither revalidates `/app`).
- Tests: `tests/services/fake-supabase.ts`, `tests/services/calendar.test.ts`, `tests/services/weekly-plan.test.ts`.
- **Not present:** no background job runner (Phase 7), so nothing can run "each morning"; no Studio (Phase 4), so "make this" can't open a content package; no analytics or insights (Phase 5).

## Decisions / Assumptions

1. **Computed on page load, never stored.** No table, no migration, no cron. The same data always gives the same recommendation.
2. **No AI calls**, so no generation, metering or provider failure on the dashboard.
3. **Rules, first match wins** (the creator gets one clear action, not a list):

   | # | Kind | When | Action shown |
   |---|---|---|---|
   | 0a | `finish_setup` | onboarding not completed | Existing Finish setup card |
   | 0b | `build_strategy` | no strategy or no active pillars | Link to `/app/strategy` |
   | 0c | `confirm_timezone` | no valid timezone ("today" is unknown) | Link to `/app/calendar` (the confirm card lives there) |
   | 1 | `make_today` | 1+ items scheduled today (creator's zone) | "Make *title* today", with time, platform · format and hook; "and N more today" when there are several; link to the calendar |
   | 2 | `schedule_saved` | this week has room (scheduled < capacity) and there are unscheduled saved ideas | "Put *topic* on your calendar": the top-ranked saved idea with its evidence and the inline **Schedule** form; secondary link "Or let AI suggest your week" → `/app/calendar` |
   | 3 | `review_new` | 1+ `new` ideas waiting | "Review your N new ideas": the top-ranked new idea with its evidence; link to `/app/opportunities` |
   | 4 | `plan_next_week` | week is full and there are unscheduled saved ideas | "This week is planned. Plan next week": link to `/app/calendar?week=<next Monday>` |
   | 5 | `generate_ideas` | anything else | "Find your next ideas": link to `/app/opportunities` (no generation is triggered from the dashboard) |

   Rule 1 picks the first item today that hasn't passed yet, or the last one if all have passed ("Date passed" shown).
   For rules 2 and 3 with "room this week": if `posting_capacity_per_week` is missing, any week counts as having room.
4. **Ranking the top idea** (rules 2 and 3, and the secondary card) is deterministic, compared in this order, then newest first:
   1. its pillar has nothing scheduled this week (pillar balance);
   2. evidence strength: high > medium > low > none;
   3. audience fit: high > medium > low > none (shown as "AI judgment", as on Opportunities);
   4. difficulty fits experience: `beginner` prefers easy, then medium, then hard; `growing` prefers easy and medium equally over hard; `established` has no preference.

   No number or "score" is shown (AGENTS.md §8: no speculative scores). The card lists the **reasons that applied**, for example "Your *Fuel* pillar has nothing planned this week", "High evidence: 2 signals", "Easy to make". At most 3 reasons; the first matching factors in the order above.
5. **Secondary "Next idea" card**: shown when the primary action isn't already about an idea (rules 1, 4, 5) and a candidate exists (saved unscheduled first, else new). Same ranking and reasons; one link: "Schedule it" → `/app/calendar` for saved, "Review it" → `/app/opportunities` for new.
6. **Week-of-plan logic moves to `lib/calendar/plan-week.ts`** (`planWeekNumber`), used by both the weekly planner and the strategy card. Behaviour unchanged: counted from the Monday of the week the strategy was last saved, in the creator's zone (UTC when no timezone is saved).
7. **Strategy card states:** week 1 to 4 → "Week N focus: *theme*. *focus*"; after week 4 → "Your 30-day plan has finished. Rebuild your strategy for a fresh plan." with a link to `/app/strategy`. No other change.
8. **AI usage line** reuses `getAiUsage` with the same limit and wording as Settings: "3 of 25 AI generations used in the last 24 hours · Details" (link to `/app/settings`). AI paused → "AI features are paused right now." Read failure → the line is omitted (it's secondary; the error is logged).
9. **"Coming soon" cards** (AGENTS.md §14: a feature that isn't available must say so): **Performance** ("See how each post does against your own usual numbers, once you add your results.") and **What AI learned** ("Patterns from your results, like which hooks and formats work for you."). Each has a "Coming soon" badge, no buttons, no numbers, no sample charts.
10. **Freshness:** scheduling, moving, removing, accepting a plan, saving or dismissing an idea, and saving a timezone also revalidate `/app`.
11. **Dashboard is unchanged when not set up**: rule 0a/0b render the existing cards, and the usage line and Coming soon cards still render, since they don't depend on setup.

## Files Likely to Change

| File | Change |
|---|---|
| `lib/calendar/plan-week.ts` (new) | `planWeekNumber()` moved from `weekly-plan.ts` |
| `lib/services/weekly-plan.ts` | Import `planWeekNumber` (no behaviour change) |
| `lib/services/calendar.ts` | `listWeek(…, unscheduledLimit)`: `0` skips the saved-ideas query |
| `lib/services/daily-recommendation.ts` (new) | `getDailyRecommendation()`, `rankIdeas()`, reason builders, types |
| `components/dashboard/today-card.tsx` (new) | Primary recommendation, one variant per kind |
| `components/dashboard/idea-summary.tsx` (new) | Shared idea block: pillar, platform · format, topic, hook, reasons, evidence list |
| `components/dashboard/next-idea-card.tsx` (new) | Secondary card |
| `components/dashboard/ai-usage-line.tsx` (new) | Usage line behind `Suspense` |
| `components/dashboard/coming-soon-cards.tsx` (new) | Performance and What AI learned |
| `components/strategy/dashboard-strategy-card.tsx` | Current plan week; plan-finished state |
| `app/app/page.tsx` | New layout and `Suspense` boundaries |
| `app/app/calendar/actions.ts`, `app/app/opportunities/actions.ts` | Also `revalidatePath("/app")` |
| `PHASES.md` | Tick both items; Phase 3 → `✅ DONE` |
| `tests/**` | See Checks |

## Database Changes

None. No tables, columns, indexes, RPCs or RLS changes. All reads go through `createUserClient()` (RLS), filtered by `user_id`.

## Implementation Requirements

1. **`getDailyRecommendation(client, userId, now = Date.now())`** in `lib/services/daily-recommendation.ts`. Never throws; logs codes only.
   - Reads in parallel: `getCalendarSetup()`; `creator_profiles.experience_level`; candidate ideas: `content_ideas` with `status in ('saved','new')`, newest first, limit 70, with the same columns as Opportunities (evidence, strength, fit, difficulty, pillar name). Re-validated with `storedOpportunity`; invalid rows skipped and logged.
   - With a timezone: `listWeek(client, userId, thisWeek, tz, now, 0)` for this week's items; today's items are those whose `date` equals `todayIn(tz, now)`.
   - Applies the rules in Decisions §3 and ranking in §4.
   - Returns `{ ok: true, today: string | null, recommendation: Recommendation, nextIdea: RankedIdea | null }` or `{ ok: false }`.
   - `Recommendation` is a discriminated union on `kind` carrying only what its card needs (for example `make_today`: `item`, `moreToday`; `schedule_saved`: `idea`, `room`; `review_new`: `idea`, `count`; `plan_next_week`: `nextWeek`).
   - `RankedIdea` is the stored idea plus `reasons: string[]` (≤ 3).
   - Saved ideas count as unscheduled by status alone: a scheduled idea is `planned`, never `saved`.
2. **`rankIdeas(ideas, { experience, plannedPillars })`** is exported and pure, so the ordering is unit-tested directly.
3. **Page `/app`**: static `h1` "Dashboard" and the greeting (unchanged). Then, each behind its own `Suspense` and calling `auth.protect()`:
   - **Today** (`TodayCard` + `NextIdeaCard`), calling `await connection()` first;
   - **Strategy card** (fixed);
   - **AI usage line**, calling `await connection()` first;
   - **Coming soon cards** are static (no `Suspense` needed).
4. **Today card**: heading "What should I do today?", date line "Wednesday, Oct 14" (creator's zone; omitted without a timezone), the action sentence as `h3`, a one-line "why" built from the rule (for example "It's on your calendar for 9:00 AM today", "You have room for 2 more this week"), the content (idea block or item), and the next action. Exactly one primary button per card.
5. **Idea block**: pillar chip (single line, truncated, full name in `title`), "Platform · Format", topic, hook (quote style, 2-line clamp), "Why this one" reasons as a short list, and a collapsed "Evidence" `details` listing each evidence item with its source link, as on Opportunities.
6. **Strategy card** fix as in Decisions §7, using `planWeekNumber` with the creator's timezone (one extra `getTimezone` read).
7. **Revalidation** as in Decisions §10.

## AI Behavior

None. No prompt, model call, generation or usage event is added. The dashboard never triggers a generation. Its links lead to pages where the creator chooses to spend one.

## Security Requirements

- `auth.protect()` in every session-bound component; identity only from Clerk's session; every query uses the creator's RLS client and filters by `user_id`.
- No new inputs except the reused Schedule form, which goes through the existing validated `scheduleIdeaAction` (ownership and `saved` status checked in the database).
- Creator and model text render as text only; evidence links keep `rel="noopener noreferrer"`.
- No new data is stored and nothing new reaches OpenAI, so the privacy copy is unchanged.

## Acceptance Criteria

1. Each rule in Decisions §3 is reachable and its precedence is as listed (unit-tested).
2. "Today" follows the creator's timezone: an item at 23:30 UTC counts as tomorrow in `Africa/Lagos` and as today in `UTC`.
3. The top idea follows the ranking in §4, shows at most 3 true reasons, and shows no score.
4. Scheduling from the dashboard creates the item, the dashboard updates to the next recommendation, and the calendar and Opportunities reflect it.
5. The strategy card shows the current plan week, or the plan-finished state after week 4.
6. The usage line matches Settings; with `AI_ENABLED=false` it says AI is paused.
7. The Coming soon cards show no numbers or controls.
8. The dashboard makes no AI call and writes nothing on load.
9. The weekly planner behaves as before (its tests still pass unchanged).
10. `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` pass, and `pnpm dev` shows no prerender error on `/app`.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build   # page and component structure changes
```

New and changed tests:
- `tests/calendar/plan-week.test.ts`: week 1 to 4, after week 4 → null, timezone near a week boundary, invalid input → null.
- `tests/services/daily-recommendation.test.ts`:
  - every rule and its precedence, including `confirm_timezone`;
  - `make_today` choice (next upcoming, else the last passed) and "N more today";
  - timezone boundaries for "today";
  - room calculation, including a missing capacity;
  - ranking order (each factor, then recency), reasons and the 3-reason cap;
  - `nextIdea` only when the primary isn't idea-based;
  - invalid rows skipped; read error → `{ ok: false }`;
  - no writes and no RPCs.
- `tests/services/calendar.test.ts`: `listWeek` with limit `0` skips the ideas query.
- `tests/services/weekly-plan.test.ts`: unchanged, still green.

## Manual Test Procedure

1. `pnpm dev`, sign in with your creator (strategy, timezone, some saved and new ideas).
2. With an item scheduled today, `/app` says "Make … today" with its time and a calendar link.
3. Remove today's items on the calendar. With room in the week and saved ideas, `/app` shows "Put … on your calendar" with reasons and evidence. Schedule it from the dashboard: a toast appears and the card moves on to the next recommendation.
4. Fill the week to capacity: with new ideas waiting it says "Review your N new ideas"; with none, "This week is planned. Plan next week" linking to next week.
5. With no saved or new ideas: "Find your next ideas".
6. The strategy card shows the current plan week (not always Week 1). To check the finished state, set `creator_strategies.updated_at` to more than 4 weeks ago in the SQL editor and reload.
7. The usage line matches Settings → AI usage. With `AI_ENABLED=false` it says AI is paused.
8. Performance and What AI learned show "Coming soon" with no numbers or buttons.
9. Confirm Settings → AI usage didn't change after loading the dashboard.
10. 375px width, dark mode, keyboard only: everything reachable, visible focus, no overflow.

## UI

- **Visual interpretation:** a calm "start here" page. One clear action at the top, one idea worth acting on, then the steadier context (strategy, usage) and what's coming. Same flat cards as the rest of the app.
- **Layout (top to bottom, `max-w-3xl`):**
  1. `h1` and greeting;
  2. **Today card** (`card card-offset`, the visual anchor);
  3. **Next idea card** (when shown);
  4. **Strategy card**;
  5. **AI usage line** (`field-help`, one line);
  6. **Coming soon** cards: side by side from `md`, stacked below.
- **Typography:** card heading `text-heading`; action sentence `text-lg` bold (`h3`); reasons and meta `field-help`; hook in the existing quote style.
- **Spacing:** `stack-lg` between sections, `stack-sm` inside cards.
- **Component behaviour:** links styled as buttons where they are the primary action; the reused Schedule form keeps its pending text ("Scheduling…") and toast; Evidence is a `details` disclosure.
- **Loading:** a skeleton card for Today and for Strategy; the usage line falls back to an empty line of the same height.
- **Empty states:** covered by rules 0a to 5. There is never a blank dashboard.
- **Error:** Today shows "We couldn't load today's plan. Refresh the page to try again." Other sections fail independently.
- **Responsive and mobile:** single column; buttons full-width below 480px; controls ≥ 44px; long titles wrap at word boundaries.
- **Accessibility:** one `h1`; each card is a `section` labelled by its heading; "Coming soon" is text, not colour; reasons are a real list; focus visible on every control.

## Known Limitations / Follow-ups

- Recomputed on every load, not pushed each morning: no email or notification digest until the job runner exists (Phase 7).
- "Make this today" can't open a content package until Studio exists (Phase 4). It links to the calendar.
- Ranking uses no performance data yet. Phase 5's learning loop should feed it (for example, favour pillars and formats that work for this creator).
- Performance and What AI learned are placeholders until Phase 5.
- Upcoming items beyond today aren't listed on the dashboard (left out by choice). The calendar shows them.
