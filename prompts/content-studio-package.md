# Content Studio: package generation (Phase 4, part 1)

First slice of Phase 4 (Content Studio) in `PHASES.md`. It turns a saved or scheduled idea into a full **content package** the creator can film or write from, at `/app/studio` and `/app/studio/[id]`.

### Phase 4 split (user's choice)

| Part | Scope |
|---|---|
| **1 (this)** | Studio routes; `generateContentPackage()` producing hooks, script, shot list, caption, CTA, titles, thumbnail concept and repurposing in one generation; stored as an AI version; whole-package regeneration; scheduling a Studio draft |
| 2 | Editing; creator-saved versions and history/restore; section-level regeneration; copy-all / export; discarding drafts |

Entry points are **ideas only** (user's choice). Every package starts from an opportunity, so it carries the idea's angle, audience need and evidence. There's no free-form "start from my own topic" form.

Loop step served: *Content Plan → **Creation***.

## Goal

From an idea the creator has already chosen, produce production material that sounds like them and fits the platform. The creator gets:

- 3 title options and 3 hook options, each with a short "why it works";
- a structured script in beats (what to say, plus what to show for video);
- a shot list for video formats;
- a platform caption with a few hashtags;
- one CTA;
- a thumbnail or cover concept, when the format has one;
- 0 to 3 repurposing suggestions for the creator's other platforms or formats.

Each section has a **Copy** button. The next action is always clear: schedule it if it isn't scheduled, or open the calendar if it is.

## Skills Read

- `ai-sdk`: structured output through the existing `runStructured` (strict mode: every key required, `nullable()` instead of `optional()`).
- `supabase` and `supabase-postgres-best-practices`: additive migration, `security invoker` functions with the owner from the JWT, row locking.
- `clerk-nextjs-patterns`: `auth.protect()` in each session-bound component and in every server action.
- Next.js docs `dynamic-routes.md` (`params` is a Promise), `07-mutating-data.md` (`redirect`, `revalidatePath`), and the Cache Components rule: request data and the current time stay behind `Suspense`, with `await connection()` where time is read.

## Existing Code Inspected

- **Schema** (`20261009000100_core_schema.sql`):
  - `content_items`: `idea_id`, `pillar_id`, `title`, `platform`, `format`, `status` (`draft|ready|scheduled|published|archived`), `scheduled_for`, composite owner FKs.
  - `content_versions`: append-only, with `version_no` unique per item, `content jsonb`, `source` (`user|ai`) and `note`.
  - RLS: own-row CRUD on `content_items`; `content_versions` allows select and insert only.
- **Calendar functions** (`20261014000100_calendar.sql`):
  - `schedule_content_ideas` only accepts `saved` ideas: it creates a `scheduled` item and moves the idea to `planned`.
  - `unschedule_content_item` keeps an item as a `draft` when it has `content_versions`; otherwise it deletes the item and moves the idea back to `saved`.
- **AI layer:**
  - `lib/ai/prompts/registry.ts`, `models.ts` (routes) and `run-structured.ts`: daily cap, `ai_generations` row, metering.
  - `content_opportunities/v2.ts` is the prompt style to follow: data blocks and an injection guard.
- **Services:**
  - `creator-context.ts`: `buildCreatorContext` and `renderContextForPrompt`.
  - `opportunities.ts`: the in-flight guard, error table and never-throws pattern; `listOpportunities` joins `items:content_items(status, scheduled_for)`.
  - `calendar.ts`: `instantInWindow`, `getTimezone`, `CALENDAR_ERRORS`.
- **Schemas:** `lib/schemas/opportunities.ts` (`VIEW_STATUSES`: Saved = `saved, planned`; `IDEA_STATUS_TRANSITIONS`, where `in_production` is "studio's"), `lib/schemas/creator.ts` (`platform`, `PLATFORM_LABELS`).
- **UI:**
  - `components/opportunities/opportunity-card.tsx` (planned shows "View in calendar");
  - `components/calendar/calendar-item-card.tsx` and `calendar-content.tsx` (unscheduled saved ideas with the Schedule form);
  - `components/dashboard/today-card.tsx` (`make_today` links to the calendar; the follow-up was "open the package once Studio exists");
  - `lib/app-shell/nav-items.ts` (Studio is `soon`);
  - `components/settings/privacy-section.tsx` (what is sent to OpenAI).
- **Tests:** `tests/services/fake-supabase.ts`, the `tests/ai/*` prompt and route tests, and `tests/db/*` (rls-isolation and schema-parity).
- **Not present:** any Studio route, service or prompt; any way to schedule an existing draft item.

## Decisions / Assumptions

1. **A Studio item is a `content_items` row.** The route is `/app/studio/[id]`, where the id is the content item's id. No new table.
2. **Starting Studio:**
   - From a **scheduled** item (calendar, dashboard): open `/app/studio/[itemId]` directly. Nothing is written.
   - From an **unscheduled saved idea** (Opportunities Saved view, the calendar's unscheduled list): a "Create in Studio" form calls the new `start_studio_item(p_idea_id)` function, then redirects to the item. In one transaction, the function:
     - locks the idea;
     - if the idea is `saved`: inserts a `draft` item (title = topic, plus the idea's platform, format and pillar) and moves the idea to `in_production`;
     - if the idea is `planned` or `in_production`: returns that idea's existing non-archived item, newest first (idempotent, so a double click doesn't create two items);
     - otherwise: raises `idea_not_available`.
3. **Scheduling a draft.** An `in_production` idea is no longer `saved`, so the calendar can't schedule it. The item page therefore shows the existing date/time fields for `draft` items. They call the new `schedule_content_item(p_item_id, p_scheduled_for)` function, which in one transaction:
   - sets the item to `scheduled` (only from `draft`, same 1-hour-past to 180-day window);
   - moves its idea from `in_production` to `planned`, so unscheduling later behaves exactly as it does today.
4. **Generation is explicit.** Opening an item never calls AI. The empty state has a **Create package** button. Once a package exists, **Regenerate package** makes a new AI version; the previous one stays stored. The copy says only that ("Your current package is kept."). History and restore are Part 2, and nothing in the UI promises them.
5. **One generation produces the whole package** (`content_package` kind, `quality` tier, `maxOutputTokens: 8_000`). Section-level regeneration is Part 2.
6. **Package shape (v1):** see AI Behavior. It's stored in `content_versions.content` as `{ "schema_version": 1, "package": { … } }` with `source = 'ai'`, `note = 'Generated package'`, and the new `ai_generation_id`.
7. **Platform awareness** is handled by the prompt and validation:
   - written formats (LinkedIn or X posts, threads, carousels) may return an empty shot list and a null thumbnail;
   - video formats must return at least 3 shots;
   - a thumbnail is required for YouTube long-form;
   - repurposing may only target the creator's own platforms.
8. **Usage controls** (on top of the existing daily cap and metering in `runStructured`):
   - In-flight guard: one pending `content_package` generation per creator inside 2 minutes (`in_progress`).
   - Per-item cap: at most **5 AI versions per item in 24 hours** (`item_limit`), counted from `content_versions` (`source = 'ai'`).
   - A **5,000-character cap on the rendered context**: the oldest recent-content lines are dropped first.
9. **Opportunities Saved view** now also lists `in_production` ideas (`VIEW_STATUSES.saved = saved, planned, in_production`). Their card shows "In Studio" and **Open in Studio**; `listOpportunities` returns the item id for that link. The transition table is unchanged, so `in_production` ideas can't be unsaved or dismissed from the card.
10. **The dashboard's `make_today`** primary button becomes **Open in Studio** (`/app/studio/[itemId]`), with the calendar as a secondary text link.
11. **The Studio list** (`/app/studio`) shows items with status `draft`, `ready` or `scheduled`:
    - scheduled items first, by date (soonest first; past dates included, marked "Date passed");
    - then drafts, newest first;
    - limit 50.

    Each row shows the title, platform · format, pillar, the date or "Not scheduled", and "Package ready" or "No package yet".
12. **Item status doesn't change on generation.** `ready` and `published` stay unused until Part 2 and Phase 5. Archived and published items get a "can't be generated" message, but the list never shows them.

## Files Likely to Change

| File | Change |
|---|---|
| `supabase/migrations/20261015000100_content_studio.sql` (new) | `content_versions.ai_generation_id`, `start_studio_item`, `schedule_content_item`, grants |
| `lib/supabase/database.types.ts` | New column and functions |
| `lib/schemas/studio.ts` (new) | Model schema, app validation, stored-version parser, error codes |
| `lib/ai/prompts/content_package/v1.ts` (new), `registry.ts`, `models.ts` | Prompt, registry entry, route |
| `lib/services/studio.ts` (new) | `startStudioItem`, `listStudioItems`, `getStudioItem`, `generateContentPackage`, `scheduleStudioItem` |
| `app/app/studio/page.tsx`, `app/app/studio/[id]/page.tsx`, `app/app/studio/actions.ts` (new) | Routes and server actions |
| `components/studio/*` (new) | List, item header, package sections, copy button, generate control, schedule form, empty, loading and error states |
| `lib/schemas/opportunities.ts`, `lib/services/opportunities.ts`, `components/opportunities/opportunity-card.tsx` | Saved view includes `in_production`; "Create in Studio" / "Open in Studio" |
| `components/calendar/calendar-item-card.tsx`, `calendar-content.tsx` | "Open in Studio" on items; "Create in Studio" on unscheduled ideas |
| `components/dashboard/today-card.tsx` | `make_today` opens Studio |
| `lib/app-shell/nav-items.ts` | Studio becomes live |
| `components/settings/privacy-section.tsx` | What a package sends to OpenAI and what's stored |
| `app/app/calendar/actions.ts`, `app/app/opportunities/actions.ts` | Also revalidate `/app/studio` |
| `PHASES.md` | Tick the items in Decisions §13 |
| `tests/**` | See Checks |

13. **PHASES.md items ticked by this part:** content package generation, hooks, scripts, shot lists, captions, CTAs, titles, thumbnail concepts, repurposing suggestions and Studio routes. Still open: section-level regeneration and save / edit / version (Part 2). Phase 4 stays `⬜ Not done`.

## Database Changes

```sql
-- Provenance for AI versions (no FK, same as content_ideas / creator_strategies).
alter table public.content_versions add column ai_generation_id uuid;

-- start_studio_item(p_idea_id uuid) returns uuid           (security invoker)
-- schedule_content_item(p_item_id uuid, p_scheduled_for timestamptz) returns void   (security invoker)
```

- Both functions take the owner from `auth.jwt() ->> 'sub'`, never from an argument. They use `set search_path = ''`, lock rows `for update`, and raise stable tokens: `idea_not_found`, `idea_not_available`, `item_not_found`, `item_not_draft`, `scheduled_for_out_of_range`.
- `execute` is revoked from `public, anon` and granted to `authenticated, service_role`, as for the calendar functions.
- RLS is unchanged. The new column inherits the `content_versions` grants (select and insert; still append-only).
- There are no new check constraints, so `DB_ENUM_COLUMNS` and schema parity are unchanged.
- Versions are inserted by the service through the creator's RLS client. `version_no` = current max + 1. A unique-violation race returns `in_progress`.

## Implementation Requirements

1. **`lib/schemas/studio.ts`**
   - `contentPackageModelSchemaFor(platforms)`: strict, every key present.
   - `contentPackageOutputFor({ platforms, primaryPlatform, format })`: app validation of bounds, platforms and the video/thumbnail rules in Decisions §7. Hashtags are normalised: leading `#` stripped, deduplicated, spaces removed.
   - `storedPackage`: parses `content_versions.content`. An unknown `schema_version` or invalid content means "unreadable version": the UI shows an error state with Regenerate, never a crash.
   - `STUDIO_ERRORS`: creator-facing messages for every code.
2. **`content_package/v1` prompt**
   - Role: production assistant for early-stage creators, writing in the creator's voice.
   - User message blocks:
     - `<creator_input>`: the rendered context (profile, brand voice, pillars, strategy, recent content, performance, insights);
     - `<idea>`: topic, audience need, angle, hook, rationale, CTA, platform, format, pillar, and evidence summaries;
     - the creator's platform list for repurposing.
   - Everything in the blocks is data, with the same injection guard as `content_opportunities`.
   - Rules:
     - honour "Always do" and "Never do";
     - match the platform's conventions and the creator's experience level;
     - keep the idea's angle (the hooks may improve on the idea's hook);
     - no invented statistics, testimonials or claims about the creator's results;
     - no engagement bait, deception, impersonation or fake urgency;
     - no "viral" promises;
     - `why` lines explain the craft, not predicted performance.
3. **`generateContentPackage(client, userId, itemId, deps)`** never throws. Steps:
   1. Validate `itemId` (uuid).
   2. Read the item, its idea and pillar (scoped by `user_id`). Missing → `not_found`. Status not in `draft|ready|scheduled` → `not_editable`.
   3. Missing profile or strategy → `missing_context`.
   4. Per-item cap, then in-flight guard.
   5. `buildCreatorContext` with the 5,000-character cap, then `deps.run({ kind: "content_package", … })`.
   6. Insert the version. Return `{ ok: true, versionNo }`.
   - Errors are logged with codes only (`content_package_failed`, with a `stage`).
4. **`startStudioItem`, `scheduleStudioItem`**
   - Validate input (uuid; date and time against the creator's saved timezone, through `instantInWindow`), then call the functions.
   - Map the DB tokens to `STUDIO_ERRORS` and `CALENDAR_ERRORS`.
5. **`listStudioItems(client, userId, now)`** and **`getStudioItem(client, userId, itemId, tz)`**
   - Validated reads. The latest version is the one with the highest `version_no`.
   - The list's "Package ready" flag comes from a `content_versions(version_no)` existence join.
6. **Server actions** (`app/app/studio/actions.ts`): `startStudioItemAction` (then redirect), `generatePackageAction`, `scheduleStudioItemAction`.
   - Each one runs `auth.protect()`, validates with Zod, calls the service, then revalidates `/app`, `/app/studio`, `/app/studio/[id]`, `/app/calendar` and `/app/opportunities` as relevant.
7. **Pages**
   - Static `h1` ("Studio", or "Content package" on the item page). The session-bound content sits behind `Suspense` and calls `auth.protect()`.
   - `params` is awaited inside the Suspense boundary.
   - The item page calls `await connection()` (it shows past/upcoming dates).
   - An invalid or another creator's id → `notFound()`.
8. **Nav, privacy and revalidation** as in Files Likely to Change.

## AI Behavior

- **Input:** the creator context (as above, capped), the idea, and the platforms. No names or emails; nothing from other creators.
- **Model output** (strict; validated limits in brackets):
  - `titles`: 3 × `{ text [≤100], why [≤160] }`
  - `hooks`: 3 × `{ text [≤200], why [≤160] }`
  - `script`: `{ beats: 3–12 × { label [≤60], say [≤1,200], show [≤300] | null } }`
  - `shot_list`: 0–15 × `{ shot [≤200], notes [≤200] | null }` (≥3 for video formats)
  - `caption`: text [≤2,200]; `hashtags`: 0–8 [each ≤40]
  - `cta`: [≤200]
  - `thumbnail`: `{ concept [≤300], overlay_text [≤40] | null } | null` (required for YouTube long-form)
  - `repurposing`: 0–3 × `{ platform (one of the creator's), format [≤60], adaptation [≤300] }`
- **Validation:** the model schema in strict mode, plus `contentPackageOutputFor`. A failure → `invalid_output` (counts against the daily cap, as today). Nothing is stored on failure.
- **Errors** map to `STUDIO_ERRORS`, which extends `AI_ERRORS` with `not_found`, `not_editable`, `missing_context`, `item_limit`, `in_progress` and `persistence_error`. The UI shows the message inline, plus Try again when the error is retryable.
- **Persistence:** one `content_versions` row per successful generation. `ai_generations` and `usage_events` are recorded by `runStructured`.
- **Usage controls:** as in Decisions §8.

## Security Requirements

- Identity only from Clerk (`auth.protect()`) in pages and actions. No ids from the browser are trusted except as lookup keys, which are re-checked against `user_id` in queries and against the JWT in the functions.
- All reads and writes use `createUserClient()` (RLS). The only service-role use is the existing `runStructured` metering.
- The functions are `security invoker`, owner from the JWT, with execute revoked from `anon`.
- Model and creator text render as text only. No `dangerouslySetInnerHTML`. Copy uses the Clipboard API on plain text.
- Nothing new reaches the browser except the creator's own package. The OpenAI key stays server-only (`lib/ai` is `server-only`).
- The privacy copy states what a package sends to OpenAI (context, idea, evidence summaries) and that packages are stored until the item is deleted.

## Acceptance Criteria

1. "Create in Studio" on a saved idea creates exactly one draft (even on a double submit), moves the idea to `in_production`, and lands on `/app/studio/[id]`.
2. "Open in Studio" from the calendar and the dashboard opens the scheduled item without writing anything.
3. **Create package** stores version 1, and the page shows all sections. **Regenerate** stores version N+1 and shows it. A failed generation stores nothing and shows a recoverable message.
4. Output that breaks any bound, platform rule or video/thumbnail rule is rejected (unit-tested).
5. The per-item cap (5 in 24 hours), the in-flight guard and the daily cap each block generation, with their own messages.
6. Scheduling a draft from Studio puts it on the calendar and moves the idea to `planned`. Unscheduling it afterwards keeps it as a draft, because it has a package.
7. The Opportunities Saved view shows `in_production` ideas with Open in Studio, and no Unsave or Dismiss.
8. Another creator's item id → 404. The functions refuse other creators' rows (DB test).
9. Opening Studio pages never calls AI.
10. `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

New and changed tests:

- `tests/schemas/studio.test.ts`: model and app schemas (bounds, platform list, video ⇒ ≥3 shots, YouTube long-form ⇒ thumbnail, hashtag normalisation), `storedPackage` with unknown or invalid content.
- `tests/ai/prompts.test.ts` and `models.test.ts`: `content_package` registered and routed; data blocks are escaped and stripped.
- `tests/services/studio.test.ts`:
  - each generation step and error code;
  - per-item cap and in-flight guard (no AI call when either blocks);
  - context cap;
  - version numbering and the unique-violation race;
  - nothing stored on failure;
  - start and schedule token mapping;
  - list ordering;
  - unreadable version.
- `tests/services/opportunities.test.ts`: Saved view includes `in_production` and returns the item id.
- `tests/db/studio.test.ts` (runs where the existing DB tests run):
  - `start_studio_item`: idempotent; refuses other creators' ideas and non-saved/planned ideas;
  - `schedule_content_item`: draft only, window, moves the idea to `planned`, refuses other creators' items;
  - `unschedule_content_item` on a packaged item keeps the draft.
- `tests/db/schema-parity.test.ts` still green.

## Manual Test Procedure

1. Apply the migration (`supabase db push` or the SQL editor), then `pnpm dev` and sign in with a creator who has a strategy and saved ideas.
2. **Opportunities → Saved:** click **Create in Studio** on an idea. You land on its Studio page with "No package yet". Go back: the card says "In Studio" with **Open in Studio**.
3. Click **Create package**. You see a pending state, then titles, hooks, script, shot list (for video), caption and hashtags, CTA, thumbnail (when relevant) and repurposing. **Copy** on each section copies plain text and shows a toast.
4. Click **Regenerate package**: a new package appears. In the SQL editor, `content_versions` has version 2 for the item, `source = 'ai'`, with `ai_generation_id` set.
5. Regenerate until the per-item cap: the 6th attempt in 24 hours shows the item limit message, and Settings → AI usage doesn't increase for the blocked attempt.
6. On the draft, schedule it for tomorrow. It appears on the calendar, and the idea shows as scheduled on Opportunities. Remove it from the calendar: it stays in Studio as a draft (Not scheduled).
7. **Calendar:** **Open in Studio** on a scheduled item opens its page. **Dashboard:** with an item today, **Open in Studio** opens it.
8. `/app/studio` lists scheduled items first by date, then drafts. With none, it shows the empty state linking to saved ideas.
9. Visit `/app/studio/<random uuid>` and `/app/studio/not-a-uuid`: both show the 404 page.
10. With `AI_ENABLED=false`, Create package shows "AI features are paused" and nothing is stored.
11. 375px width, dark mode, keyboard only: everything reachable, visible focus, no horizontal scroll, long titles and scripts wrap.

## UI

- **Visual interpretation:** a working "production sheet". The top of the page tells the creator what this piece is and when it's due. Below that are the sections in the order they'll use them: pick a title and a hook, follow the script, shoot from the shot list, post with the caption and CTA.
- **Layout (`max-w-3xl`, single column):**
  1. **Header card:**
     - eyebrow "Content package";
     - title (`h2`);
     - pillar chip and "Platform · Format";
     - "Scheduled for Wed, Oct 14, 9:00 AM" or "Not scheduled";
     - a collapsed "About this idea" `details` (audience need, angle, evidence list with source links as on Opportunities).
  2. **Next action row:**
     - draft: the schedule date and time fields with **Schedule**;
     - scheduled: a **View in calendar** link.
  3. **Package:**
     - no version: an empty-state card ("Turn this idea into a script, shot list and caption in your voice.") with **Create package** and the note "Uses 1 AI generation";
     - with a version: one `section.card` per part, in this order: Titles, Hooks, Script, Shot list, Caption, Call to action, Thumbnail, Repurposing.
     - Each section has an `h3` and a **Copy** button (secondary, small) in the heading row. Sections with no content (an empty shot list, a null thumbnail) are left out, with no empty card.
     - **Regenerate package** (secondary) at the bottom, with "Your current package is kept. Uses 1 AI generation."
- **Section details:**
  - titles and hooks are numbered lists with the text in bold and `why` in `field-help`;
  - script beats are an ordered list: label (bold), "Say" paragraph, and "Show" paragraph (muted) when present;
  - the shot list is an ordered list;
  - hashtags render as plain text chips (`#tag`).
- **Studio list:** cards linking to the item. The title is the link, with the meta line, a date line and a "Package ready" / "No package yet" text label (not colour alone).
- **Typography:** `text-heading` for card headings, `text-lg font-bold` for the item title on the list, scripts in body size with `whitespace-pre-line`, and `break-words` everywhere creator or model text appears.
- **Spacing:** `stack-lg` between cards, `stack-sm` inside them.
- **Loading:**
  - skeleton cards for the list and the item page;
  - generation shows "Creating your package…" with the button disabled and `aria-busy`, which may take up to a minute. The copy says "This can take up to a minute."
- **Empty states:**
  - the list: "Nothing in Studio yet. Pick a saved idea to start." with a link to Opportunities → Saved;
  - the item: as above.
- **Errors:**
  - an inline `alert` with the service message and Try again when retryable;
  - a page read failure: "We couldn't load this right now. Refresh the page to try again.";
  - an unreadable stored version: "This package couldn't be shown. Regenerate it to continue."
- **Responsive and mobile:** single column; buttons full-width below 480px; the Copy button stays in the heading row and wraps under the heading on narrow screens; controls ≥ 44px.
- **Accessibility:**
  - one `h1`; each section is a `section` labelled by its heading;
  - Copy buttons have accessible names ("Copy script");
  - toasts are announced (Sonner);
  - lists are real lists;
  - focus is visible on every control.

## Known Limitations / Follow-ups

- No editing, creator-saved versions, history, restore, section-level regeneration, copy-all or export until Part 2.
- A draft can't be discarded until Part 2. Its idea stays `in_production` until then.
- No thumbnail image generation: the concept is text only.
- No publishing integration. Packages are for the creator to post themselves.
- Packages don't use performance data yet beyond what the context already includes. Phase 5 learning should feed hooks and formats that work for this creator.
