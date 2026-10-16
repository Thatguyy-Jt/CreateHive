# Analytics: publishing, results entry and baselines (Phase 5, part 1)

First slice of Phase 5 (Analytics and Learning) in `PHASES.md`. The creator records what they actually posted and how it did, and sees each post compared with **their own usual numbers**. There's no AI in this part: diagnosis and learning build on this data in Parts 2 and 3.

### Phase 5 split (user's choice)

| Part | Scope |
|---|---|
| **1 (this)** | Mark Studio items as published; add past posts made outside the app; manual results entry (multiple check-ins per post); performance snapshots; deterministic baseline per platform; `/app/analytics` and `/app/analytics/[id]`; dashboard Performance card |
| 2 | AI diagnosis per post (`analyzeContentPerformance()`), stored and shown on the post page, ending in a next experiment |
| 3 | Creator insights (`updateCreatorInsights()`), `/app/insights`, and feeding learnings back into opportunities, packages and the dashboard |

**Input is manual entry only** (user's choice). No platform API sync and no CSV import in Phase 5.
**Past posts are allowed** (user's choice), so a new creator can build a baseline on day one.

Loop step served: *Creation → Publishing → **Analytics***.

## Goal

After posting, the creator can:

1. mark the Studio item as published, with the date, link, the hook they actually used and the video length;
2. log posts they made before using the app (or outside it);
3. enter results for a post (views, likes, comments, shares, saves, follower change, and for video: average view duration and average % viewed), more than once as numbers grow;
4. see, for each post, whether it did above, around or below their usual on that platform, with the numbers and how many posts the "usual" is based on.

The next action is always clear: "Add results" on posts without any, "Update results" on posts with early results only, and "Log a past post" when there's no baseline yet.

## Skills Read

- `supabase` and `supabase-postgres-best-practices`: additive migration, `security invoker` function with the owner from the JWT, row locking, check constraints, index for the per-item snapshot read.
- `clerk-nextjs-patterns`: `auth.protect()` in each session-bound component and in every server action.
- Next.js docs `dynamic-routes.md` (`params` is a Promise), `07-mutating-data.md` (`redirect`, `revalidatePath`), and the Cache Components rule: request data and the current time stay behind `Suspense`, with `await connection()` where time is read.
- `ai-sdk`: not used (no AI in this part).

## Existing Code Inspected

- **Schema** (`20261009000100_core_schema.sql`, `..._rls_policies.sql`):
  - `content_items` already has `status` (`… 'published' …`), `published_at` and `published_url`. Nothing in the app sets them today.
  - `analytics_snapshots`: `content_item_id` (nullable, composite owner FK, cascade), `platform`, `captured_at`, `views`, `watch_time_seconds`, `avg_view_duration_seconds`, `retention_rate` (0–1), `likes`, `comments`, `shares`, `saves`, `follower_delta`, `source` (`manual|import|api`), `raw`. Own-row CRUD under RLS, already covered by `tests/db/rls-isolation.test.ts` (cross-creator item reference rejected).
  - `content_ideas.status` has `used`, which nothing sets today.
- **Functions:** `schedule_content_item`, `unschedule_content_item`, `start_studio_item`, `discard_studio_item` (pattern for the new function: JWT owner, `for update`, stable tokens, revoke from `anon`).
- **Services:**
  - `studio.ts`: `EDITABLE_STATUSES` (`draft|ready|scheduled`), `getStudioItem`, `listStudioItems` (published items aren't listed), `STUDIO_ERRORS`.
  - `calendar.ts`: `getTimezone`, `CALENDAR_ERRORS`, `listWeek` (only `scheduled` items, so a published item leaves the calendar).
  - `creator-context.ts`: the `performance` section already loads the 30 newest snapshots into opportunity and package prompts (unlinked to posts). Unchanged in this part; Part 3 reworks it.
  - `daily-recommendation.ts`: unaffected (published items leave `listWeek`).
- **Dates:** `lib/calendar/dates.ts` (`localToInstant`, `localDateKey`, `todayIn`, `addDays`, `formatDay`), `components/calendar/date-time-fields.tsx`.
- **Schemas:** `lib/schemas/enums.ts` (`analyticsSource`, `DB_ENUM_COLUMNS`), `lib/schemas/creator.ts` (`platform`, `PLATFORM_LABELS`), `lib/schemas/studio.ts` (`formatRulesFor` → `video`).
- **UI:**
  - `components/studio/studio-item-content.tsx` (`NextAction`: schedule form for drafts, "View in calendar" for scheduled; published items show "can't be generated");
  - `components/calendar/calendar-item-card.tsx` (Open in Studio, Move, Remove);
  - `components/dashboard/coming-soon-cards.tsx` (Performance and What AI learned placeholders);
  - `lib/app-shell/nav-items.ts` (Analytics and Insights are `soon`);
  - `components/settings/privacy-section.tsx`.
- **Tests:** `tests/db/helpers.ts` (PGlite + migrations), `tests/db/schema-parity.test.ts`, `tests/services/fake-supabase.ts`, `tests/db/studio.test.ts` (pattern for function tests).
- **Not present:** any analytics route, service, schema or form; any way to set `published`.

## Decisions / Assumptions

1. **A post is a `content_items` row with `status = 'published'`.** No new posts table. Two ways in:
   - **From Studio:** a `draft`, `ready` or `scheduled` item is marked published through the new `publish_content_item` function.
   - **Past post:** a new item inserted directly as `published`, with no idea, no pillar and no package.
2. **Publish details** stored on the item:
   - `published_at` (required): local date + time in the creator's timezone. For Studio items the default is the scheduled date/time if it has one, otherwise today at the current hour. Allowed range: up to 2 years ago, and not more than 1 hour in the future.
   - `published_url` (optional): `https://` only, ≤ 500 chars. Rendered as a link with `rel="noopener noreferrer"`. Never fetched by the server.
   - **New columns** `hook_used text` (≤ 300, optional: the opening line actually used) and `duration_seconds integer` (1–86,400, optional, shown for video formats only). Part 2's diagnosis needs both. For Studio items, the hook field is prefilled with the first hook of the latest package, if any; the creator can edit it.
3. **Publishing a Studio item** (`publish_content_item`) in one transaction:
   - only from `draft|ready|scheduled` (`item_not_publishable` otherwise);
   - sets `status = 'published'` and the details; keeps `scheduled_for` as it was (history);
   - moves its idea, if any, to `used` (from `planned` or `in_production`).
   The item leaves Studio's list and the calendar. The Studio item page for a published item shows a "Published" header line and **View results**, plus the package read-only, as today.
4. **Past posts:** title (2–200), platform (enum), format (optional, ≤ 60), published date + time, URL, hook used, duration. Inserted through the RLS client by the service, `status = 'published'`. Cap: **500 published items per creator** (`post_limit`), counted before insert.
5. **Editing and deleting posts:**
   - **Edit details** on the post page: the same fields (title and platform only for past posts; Studio items keep the title and platform from Studio). An RLS update through the service, scoped by `user_id` and `status = 'published'`.
   - **Delete post** on the post page, with a confirmation step: deletes the item, which cascades its results (and its package, for Studio items: the copy says so). The idea stays `used`.
   - There's no "unpublish". If it was marked by mistake, the creator deletes it or edits the date.
6. **Results entry** (a "check-in") inserts one `analytics_snapshots` row with `source = 'manual'`, `captured_at = now()`, `platform` copied from the item and `content_item_id` set:
   - fields: views, likes, comments, shares, saves (integers ≥ 0, ≤ 10¹²); follower change (integer, may be negative, |x| ≤ 10⁹); for video formats only, average view duration (seconds, ≤ 86,400, and ≤ `duration_seconds` when that's set) and average % viewed (0–100, stored as 0–1 in `retention_rate`);
   - every field is optional, but **at least one** must be filled (`empty_results`);
   - `likes + comments + shares + saves` above `views` is allowed (some platforms count differently); no cross-field rule beyond the duration one;
   - only for `published` items (`not_published`), and the check-in can't be dated before `published_at` (it's always `now()`, so this holds unless `published_at` is in the future: then `not_yet_published`);
   - cap: **50 check-ins per post** (`checkin_limit`);
   - a check-in can be deleted (to fix a typo) from the post page. No in-place edit.
   - `watch_time_seconds` and `raw` stay null for manual entries.
7. **Baselines are deterministic, per platform, from the creator's own posts** (`lib/analytics/baseline.ts`, pure):
   - A post's **latest** check-in represents it.
   - A post is **settled** when its latest check-in was captured **≥ 7 days after `published_at`**. Earlier results are "early" and are never compared: the post shows "Early results (day N). Update them after day 7 for a fair comparison." Past posts logged with current totals are usually settled immediately.
   - **Baseline** for a post = the **median** of each metric over the creator's *other* settled posts on the same platform with that metric filled. It needs **at least 3** such posts; otherwise "Not enough posts yet: N of 3 on YouTube".
   - Metrics compared: views, engagement rate (`(likes + comments + shares + saves) / views`, only when views > 0 and at least one of the four is filled), follower change, and for video: average % viewed.
   - **Label** per metric from `value / median`: ≥ 1.25 → "Above your usual", ≤ 0.8 → "Below your usual", otherwise "Around your usual". When the median is 0, a value > 0 is "Above" and 0 is "Around". Follower change uses the difference instead of the ratio (≥ median + max(1, |median| × 0.25) → above, symmetric for below).
   - The post's headline label is the **views** label (engagement rate if views is missing). No combined score, no percentile, no prediction.
   - The thresholds and the minimum sample are named constants, unit-tested.
8. **`/app/analytics`** (single column, `max-w-3xl`):
   - **Platform summary**: one card per platform with posts: "8 posts · 6 with settled results · Usual views 1,400 · Usual engagement 4.2%". If none has ≥ 3 settled posts: the "Not enough posts yet" line plus **Log a past post**.
   - **Needs results**: published posts with no check-in, or only early ones whose `published_at` is ≥ 7 days ago (oldest first, max 5), each with **Add results**.
   - **Posts**: published posts, newest `published_at` first, limit 50 ("Showing your 50 most recent posts"), each row: title (link to the post page), platform · format, published date, latest views, and the headline label as text.
   - **Log a past post**: a collapsed `details` form at the bottom; open by default when the creator has no posts.
9. **`/app/analytics/[id]`** (the post page; the item id): header (title, platform · format, pillar, published date, link, hook used, duration, "Made in Studio" link when it has an idea), the comparison table (metric · this post · your usual · label · "based on N posts"), the **Add results** form, the check-in history (date, day N, the numbers, Delete), **Edit details** and **Delete post**. A non-published, invalid or other creator's id → `notFound()`. Part 2 adds diagnosis here.
10. **Entry points into publishing:**
    - Studio item page (`draft|scheduled`): a **"Posted it? Mark as published"** card under the next-action card, with the publish form. On success: redirect to `/app/analytics/[id]`.
    - Calendar item card: a **Mark as published** link to `/app/studio/[id]#publish` (the card stays compact; no form in the card).
    - Dashboard: see 11.
11. **Dashboard:** the "Performance" placeholder becomes a real card: the most recent settled post with its headline label and views vs usual; otherwise the count of posts that need results with **Add results**; otherwise "No posts logged yet" with **Log a past post**. "What AI learned" stays a "Coming soon" placeholder (Part 3).
12. **Nav:** Analytics becomes live. Insights stays `soon`.
13. **AI context is unchanged.** The existing `performance` and `recentContent` sections now see real rows (snapshots and post titles), which already reach OpenAI for opportunities and packages. The privacy copy is corrected to say so for content ideas too (it currently only mentions it for packages). `hook_used`, `published_url` and `duration_seconds` are **not** added to any prompt in this part.
14. **Timezone:** publish and past-post forms need the creator's saved timezone. Without one they show the existing "Confirm your timezone on the calendar first" message.
15. **PHASES.md items ticked by this part:** "Analytics import / manual entry" and "Performance snapshots". "Analytics and insights routes" stays open until `/app/insights` exists (Part 3). Phase 5 stays `⬜ Not done`.

## Files Likely to Change

| File | Change |
|---|---|
| `supabase/migrations/20261017000100_analytics.sql` (new) | `content_items.hook_used`, `.duration_seconds` with checks; `publish_content_item`; index `analytics_snapshots (content_item_id, captured_at)` replacing the single-column one; grants |
| `lib/supabase/database.types.ts` | New columns and function |
| `lib/schemas/analytics.ts` (new) | Publish, past-post, edit and check-in input schemas; stored row schemas; `ANALYTICS_ERRORS`; metric labels |
| `lib/analytics/baseline.ts` (new) | Pure: settled rule, medians, labels, headline, engagement rate |
| `lib/services/analytics.ts` (new) | `publishStudioItem`, `logPastPost`, `updatePostDetails`, `deletePost`, `addResults`, `deleteResults`, `listPosts`, `getPost`, `getPerformanceSummary` |
| `app/app/analytics/page.tsx`, `app/app/analytics/[id]/page.tsx`, `app/app/analytics/actions.ts` (new) | Routes and server actions |
| `components/analytics/*` (new) | Platform summary, needs-results list, post list, past-post form, publish form, results form, comparison table, check-in history, edit/delete controls, skeletons, empty and error states |
| `components/studio/studio-item-content.tsx` | "Mark as published" card; published header + View results |
| `components/calendar/calendar-item-card.tsx` | Mark as published link |
| `components/dashboard/coming-soon-cards.tsx`, `components/dashboard/performance-card.tsx` (new), `app/app/page.tsx` | Real Performance card; What AI learned stays a placeholder |
| `lib/app-shell/nav-items.ts` | Analytics live |
| `components/settings/privacy-section.tsx` | Posts, links and results stored; what reaches OpenAI |
| `app/app/studio/actions.ts`, `app/app/calendar/actions.ts` | Also revalidate `/app/analytics` |
| `PHASES.md` | Tick the items in Decisions §15 |
| `tests/**` | See Checks |

## Database Changes

```sql
alter table public.content_items
  add column hook_used text check (char_length(hook_used) between 1 and 300),
  add column duration_seconds integer check (duration_seconds between 1 and 86400);

-- The post page and baseline read a post's check-ins in time order.
drop index public.analytics_snapshots_content_item_id_idx;
create index analytics_snapshots_content_item_id_captured_at_idx
  on public.analytics_snapshots (content_item_id, captured_at);

-- publish_content_item(p_item_id uuid, p_published_at timestamptz,
--   p_published_url text, p_hook_used text, p_duration_seconds integer) returns void
```

- `publish_content_item` is `security invoker`, owner from `auth.jwt() ->> 'sub'`, `set search_path = ''`, locks the item `for update`, and raises stable tokens: `item_not_found`, `item_not_publishable`, `published_at_out_of_range` (outside 2 years ago … now + 1 hour). It moves the idea from `planned|in_production` to `used`.
- `execute` revoked from `public, anon`, granted to `authenticated, service_role`.
- **RLS and grants are unchanged.** `content_items` and `analytics_snapshots` already have own-row CRUD; the new columns inherit it. Past posts, edits, deletes and check-ins go through the creator's RLS client.
- The new checks are range checks, not value lists, so `DB_ENUM_COLUMNS` and schema parity are unchanged.
- No backfill: existing rows get nulls.

## Implementation Requirements

1. **`lib/schemas/analytics.ts`**
   - `publishInputFor({ today, video })`, `pastPostInputFor({ today })`, `postDetailsInputFor(...)`: date/time keys, URL (`https:` only, trimmed, empty → null), hook (trimmed, empty → null), duration (`m:ss` or seconds; video only, else null).
   - `resultsInputFor({ video, durationSeconds })`: the bounds in Decisions §6; empty strings → null; percent → 0–1; at least one value.
   - Stored row schemas for posts and snapshots (numerics arrive as strings from PostgREST for `numeric` columns: coerce).
   - `ANALYTICS_ERRORS`: creator-facing message for every code (`invalid_input`, `not_found`, `not_publishable`, `not_published`, `not_yet_published`, `date_out_of_range`, `post_limit`, `checkin_limit`, `empty_results`, `missing_timezone`, `db_error`).
2. **`lib/analytics/baseline.ts`** (pure, no I/O): `latestCheckIn`, `isSettled(post, now?)`, `engagementRate`, `median`, `baselineFor(post, allPosts)`, `compare(value, median, metric)`, `headlineFor(...)`, `platformSummary(posts)`. Constants: `SETTLED_AFTER_DAYS = 7`, `MIN_BASELINE_POSTS = 3`, `ABOVE_RATIO = 1.25`, `BELOW_RATIO = 0.8`.
3. **`lib/services/analytics.ts`**: every function validates input, scopes every query by `user_id`, never throws, logs codes only (`analytics_write_failed` / `analytics_read_failed` with a `stage`).
   - `publishStudioItem`: timezone → `localToInstant` → RPC; maps DB tokens.
   - `logPastPost`: count published items (cap) → insert; returns the new id.
   - `updatePostDetails`, `deletePost`: `published` only.
   - `addResults`: reads the item (published, `published_at`, format, duration), counts check-ins (cap), inserts.
   - `deleteResults`: by snapshot id and `user_id`.
   - `listPosts(now)`: up to 50 published posts with their check-ins (one query, embedded `analytics_snapshots`, ordered). The **baseline** uses the creator's last **200** published posts (a second, narrower query, latest check-in per post computed in code), so a long history still counts.
   - `getPost(id, tz, now)`: the post, its pillar and idea flag, all its check-ins, and its comparison.
   - `getPerformanceSummary(now)`: what the dashboard card needs.
4. **Server actions** (`app/app/analytics/actions.ts`): `publishStudioItemAction` (then redirect to the post), `logPastPostAction` (then redirect), `updatePostDetailsAction`, `deletePostAction` (then redirect to `/app/analytics`), `addResultsAction`, `deleteResultsAction`. Each: `auth.protect()`, the timezone from the DB (never the browser), Zod, the service, then revalidate `/app`, `/app/analytics`, `/app/analytics/[id]`, `/app/studio` and `/app/calendar` as relevant.
5. **Pages**: static `h1` ("Analytics", or "Post results" on the post page); session-bound content behind `Suspense` calling `auth.protect()`; `params` awaited inside the boundary; `await connection()` where "now" is read (settled rule, day N, needs-results).
6. **Studio, calendar, dashboard, nav, privacy** as in Decisions §10–13.

## AI Behavior

None in this part. No AI call is added, and no prompt or context section changes. The existing context sections (`performance`, `recentContent`) start receiving real data, which the privacy copy now states.

## Security Requirements

- Identity only from Clerk (`auth.protect()`) in pages and actions. Item and snapshot ids from the browser are lookup keys only, re-checked against `user_id` in every query and against the JWT in the function.
- All reads and writes use `createUserClient()` (RLS). No service-role use in this part.
- `publish_content_item` is `security invoker`, owner from the JWT, execute revoked from `anon`. DB tests prove it refuses other creators' items.
- Snapshots can only reference the creator's own items (composite FK, already tested); the service also refuses non-published items.
- URLs: `https:` only, rendered as `<a href>` with `rel="noopener noreferrer" target="_blank"`, never fetched server-side. All creator text renders as text; no `dangerouslySetInnerHTML`.
- Privacy copy: we store published posts (title, platform, format, date, link, hook used, length) and the results entered, until the creator deletes the post; post titles and results are sent to OpenAI as part of the context for content ideas and packages; links and hooks used are not.

## Acceptance Criteria

1. Marking a Studio draft or scheduled item as published sets `published`, the details, and its idea to `used`; it leaves the calendar and the Studio list and lands on its post page.
2. A past post can be logged without any idea or package, and appears on `/app/analytics`.
3. Results can be added several times; each is a snapshot with `source = 'manual'`. Empty, out-of-bounds, non-published and over-cap submissions are refused with their own messages.
4. With fewer than 3 settled posts on a platform, no comparison is shown, and the page says how many more are needed. With 3 or more, each settled post shows above/around/below for each metric, with its number, the median and the sample size. Early posts are never labelled.
5. Baseline maths (settled rule, exclusion of the post itself, median, thresholds, zero medians, follower difference rule, engagement rate) is unit-tested.
6. Editing details and deleting a check-in or a post work, and deleting a post removes its check-ins.
7. Another creator's item or snapshot id → 404 / not found. `publish_content_item` refuses other creators' items (DB test).
8. The dashboard Performance card shows real data or a clear next step; nothing on it is fake.
9. No AI is called anywhere in this part.
10. `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

New and changed tests:

- `tests/analytics/baseline.test.ts`: every rule in Decisions §7.
- `tests/schemas/analytics.test.ts`: publish, past-post, details and results input (bounds, URL scheme, at least one value, percent conversion, duration parsing, video-only fields).
- `tests/services/analytics.test.ts` (fake Supabase): each function's validation, scoping, caps (no insert when a cap blocks), token mapping, non-published refusal, list ordering, needs-results selection, summary.
- `tests/db/analytics.test.ts` (PGlite):
  - `publish_content_item`: from draft and scheduled; refuses published/archived; date window; idea → `used`; refuses another creator's item; `anon` can't execute;
  - the new column checks;
  - deleting a published item cascades its snapshots.
- `tests/db/schema-parity.test.ts` and `rls-isolation.test.ts` still green.

## Manual Test Procedure

1. Apply the migration (`supabase db push` or the SQL editor), run `pnpm db:types` if the linked project is available, then `pnpm dev` and sign in with a creator who has a confirmed timezone and a Studio item.
2. **Studio** → a scheduled item → **Mark as published**: the hook is prefilled from the package. Submit with today's date. You land on its post page. The calendar no longer shows it; Studio's list no longer shows it; Opportunities no longer lists its idea as saved.
3. **Add results** with views 1200, likes 80: the check-in appears in history ("day 0"), with "Early results" and no label.
4. **Analytics → Log a past post** three times on the same platform, each dated over a week ago, each with views (e.g. 800, 1000, 1500). Each lands on its post page.
5. Back on `/app/analytics`: the platform card shows the usual views (median). Each past post now shows a label against the other two (needs 3 *others*: add a fourth past post to see labels on all of them). Check the numbers by hand.
6. Submit an empty results form → "Enter at least one number." Enter `-5` views → a field error. Enter average % viewed `120` → a field error.
7. Delete a check-in; delete a past post (confirm): both disappear and the baseline changes.
8. **Dashboard:** the Performance card shows the latest settled post or "N posts need results".
9. `/app/analytics/<random uuid>` and `/app/analytics/not-a-uuid` → 404. A Studio draft's id under `/app/analytics/` → 404.
10. 375px width, dark mode, keyboard only: everything reachable, visible focus, no horizontal scroll; the comparison table stays readable (stacked rows below 480px).

## UI

- **Visual interpretation:** a calm "results notebook". Numbers are shown plainly next to the creator's own usual; words, not colours, carry the meaning. No charts in this part (a list of check-ins is enough for a handful of numbers; charts can come once Part 3 has trends to show).
- **Layout:** single column, `max-w-3xl`, `stack-lg` between cards, `stack-sm` inside.
  - `/app/analytics`: `h1` "Analytics", lead "Log what you posted and see how each post compares with your own usual numbers.", `field-help` "We don't connect to your accounts yet: you enter the numbers from each platform's insights." Then Platform summary → Needs results → Posts → Log a past post.
  - Post page: header card (`card-offset`) → comparison card → Add results card → History → Details (`details`: Edit details) → Delete post (ghost button with a confirm step, as Studio's Discard draft).
- **Typography:** `text-heading` for card headings; numbers in `tabular-nums`; `Intl.NumberFormat` for thousands (compact on the list, full on the post page); `break-words` on titles, hooks and URLs.
- **Labels:** text first ("Above your usual"), with an arrow glyph `↑ → ↓` marked `aria-hidden`; the pill uses the existing border styles, not colour alone.
- **Forms:** labelled native inputs; `inputmode="numeric"` for counts; video-only fields shown only for video formats; field-level errors under each input (`aria-describedby`), plus an inline `alert` for service errors. Pending: button disabled, "Saving…", `aria-busy`. Success: Sonner toast ("Results saved").
- **Loading:** skeleton cards (`SectionSkeleton`) for each Suspense boundary.
- **Empty states:**
  - no posts: "No posts yet. Mark a Studio item as published, or log a post you already made, to start your baseline." with the past-post form open;
  - a post with no check-ins: "No results yet. Add the numbers from the platform's insights.";
  - not enough posts: "Not enough posts yet: 2 of 3 on TikTok. Log a past post to compare sooner."
- **Errors:** inline `alert` with the service message; a page read failure: "We couldn't load your results right now. Refresh the page to try again."
- **Responsive and mobile:** buttons full-width below 480px; the comparison table becomes stacked definition rows below 480px (no horizontal scroll); controls ≥ 44px.
- **Accessibility:** one `h1`; sections labelled by their headings; the comparison is a real `table` with a caption ("How this post compares with your usual on YouTube") on wider screens; delete buttons have accessible names ("Delete results from Oct 12"); focus visible everywhere.

## Known Limitations / Follow-ups

- No platform API sync or CSV import (manual only, by choice). The page says so.
- No AI diagnosis (Part 2) and no learned insights or feedback into recommendations (Part 3).
- No charts or trends over time.
- Baselines compare a post's latest numbers with other posts' latest numbers. A post's age beyond the 7-day settled rule isn't normalised, so a 6-month-old past post may outperform a 2-week-old one. The 7-day rule and the median keep this roughly fair; Part 2's diagnosis should mention age when it matters.
- The prompt context still renders snapshots without linking them to posts; Part 3 changes this.
- No "unpublish": a mistaken publish is fixed by editing the date or deleting the post.
