# Research signals (Phase 3, part 2)

Second slice of Phase 3 (Opportunity Engine) in `PHASES.md`: **Evidence / signals (`research_signals`)**. It gives opportunities real, citable evidence beyond what the creator typed into onboarding.

## Goal

Let a creator build a small, sourced pool of **research signals** and have the Opportunity Agent cite them, so each idea can say *where* its support came from (AGENTS.md §8 Research Agent, §12).

Two signal sources, delivered in two steps inside this one prompt:

| Step | Source | Notes |
|---|---|---|
| **A** | **Creator-provided signals** | The creator pastes audience comments, competitor observations or their own notes. No API, no keys. |
| **B** | **YouTube Data API** | Official API. An on-demand "Refresh from YouTube" fetches recent, well-performing videos for the creator's niche and caches them for 7 days. |

Both write to the existing `research_signals` table. Step A must be fully working and tested before Step B starts; Step B can then be dropped or deferred without affecting A.

Loop step served: *Audience Understanding → Opportunity Detection* (evidence behind each recommendation).

### Phase 3 split (context, not in this prompt)

| Part | Scope |
|---|---|
| 1 | Opportunities: generate, persist, list, save/dismiss (done) |
| **2 (this)** | Research signals: store, add, refresh (YouTube), cite in opportunities |
| 3 | Calendar (`/app/calendar`) + weekly planning (`generateWeeklyPlan()`) |
| 4 | Daily recommendation + dashboard "What should I do today?" |

## Skills Read

- `supabase`, `supabase-postgres-best-practices` (RLS on `research_signals` already exists; index for the list/context queries).
- `ai-sdk` (per-request structured schema through the existing `runStructured`; new prompt version).
- `clerk-nextjs-patterns` (`auth.protect()` in the page and every server action).
- Next.js docs `07-mutating-data.md` (server actions, `revalidatePath`) and the Cache Components rule that request data sits behind `Suspense`.

## Existing Code Inspected

- `supabase/migrations/20261009000100_core_schema.sql`: `research_signals` already has `user_id`, `source text`, `external_id text`, `source_url text`, `signal_type text`, `title text`, `payload jsonb`, `fetched_at`, `expires_at`, `created_at`, `unique (user_id, source, external_id)` and index `(user_id, fetched_at)`. `source` and `signal_type` are **unconstrained text**, validated in the app.
- `supabase/migrations/20261009000200_rls_policies.sql`: full own-row CRUD for `authenticated` on `research_signals` (select/insert/update/delete by `user_id = auth.jwt()->>'sub'`). Nothing to change.
- `usage_events`: `event_type` is unconstrained text; server-owned (written with the service-role client, readable by the owner). Usable to meter YouTube quota with no migration.
- `lib/schemas/json.ts`: `researchSignalPayload` is currently a loose object, "tighten when its feature defines it". This feature defines it.
- `lib/schemas/opportunities.ts`: `evidenceKind` already includes `research_signal`, `audience_comment`, `competitor`, `trend`; `evidenceItem` already has optional `source`, `source_url`, `observed_at`; `EVIDENCE_KIND_LABELS` exists; `opportunityModelSchemaFor(allowedEvidenceKinds)` / `opportunityOutputFor(...)`.
- `lib/services/opportunities.ts`: `generateContentOpportunities()` computes `allowedEvidenceKinds` (`creator_input` + `creator_history` when analytics exist) and `evidenceStrengthFor()` (`low` / `medium`; `high` reserved "for corroborated research"). `trend_signal` / `content_gap` are stored null.
- `lib/services/creator-context.ts`: section loaders and `renderContextForPrompt`; `<creator_input>` delimiter cleaning.
- `lib/ai/prompts/content_opportunities/v1.ts`, `registry.ts`, `models.ts`: v1 prompt is published, so changes go in a new `v2.ts` (prompts are never edited in place).
- `lib/ai/env.ts`: lazy env reading, results name failing variables and never values. Pattern for the YouTube config.
- `components/opportunities/*`, `app/app/opportunities/*`, `components/strategy/*`, `components/ui/toaster.tsx`, `lib/app-shell/nav-items.ts`: conventions to follow.
- `lib/observability/log.ts`: `logEvent` accepts only `kind, model, code, latency_ms, db_code, stage, name, variables`.
- `tests/services/fake-supabase.ts`, `tests/db/helpers.ts`, `tests/db/rls-isolation.test.ts` (already covers `research_signals`).
- **Not present:** no research code, no YouTube client, no `YOUTUBE_API_KEY`, no `/app/research` route, no job runner. `competitors` table exists but has no UI and is out of scope here.

## Decisions / Assumptions

1. **Signals are untrusted data, not truth** (AGENTS.md §6, §12). Every signal keeps its source and is cited as "a comment you pasted says…" or "a YouTube video titled…", never restated as a fact about the market.
2. **Two kinds of source, four signal types.**

   | `source` | `signal_type` | Evidence `kind` it maps to |
   |---|---|---|
   | `manual` | `audience_comment` | `audience_comment` |
   | `manual` | `competitor_note` | `competitor` |
   | `manual` | `creator_note` | `creator_input` |
   | `youtube` | `video` | `research_signal` |

   `trend` stays **unused**: nothing here measures a trend, so we don't claim one.
3. **The model cites signals by a short ref, never by id or URL.** Each signal in the prompt gets a ref `S1…S12`. The model returns `signal_ref` per evidence item. The server resolves the ref to the real row and **fills `source`, `source_url` and `observed_at` itself**, so the model cannot invent a source or a link. Unknown refs fail validation.
4. **Ref rules** (enforced in app validation): kinds `research_signal`, `audience_comment`, `competitor` **require** a ref whose signal type maps to that kind; `creator_input` and `creator_history` **forbid** a ref. A `creator_note` signal is cited with kind `creator_input` and a ref.
5. **`evidence_strength` stays server-computed:**
   - `low`: only `creator_input` evidence;
   - `medium`: cites `creator_history`, **or** cites exactly one distinct external-or-pasted signal;
   - `high`: cites **two or more distinct signals from two or more different `source`/`signal_type` combinations** (for example a YouTube video plus a pasted audience comment). One source repeated is never `high`.

   `trend_signal` and `content_gap` **remain null**: a defensible method for them is a later decision, and the cards already don't show them.
6. **Signals in the prompt are capped and curated:** at most **12** non-expired signals, newest first, at most **6** per `source`. Only `title`, a short excerpt/summary and a few safe facts are sent (see Implementation). No URLs, no creator ids, no emails.
7. **Manual signal limits (cost and abuse control):** text ≤ 1,000 characters; optional label ≤ 120; optional source URL must be `https`; at most **100 manual signals per creator** (adding more is refused with a clear message). Duplicate text for the same creator is rejected via a content-hash `external_id`.
8. **Manual signals do not expire** (the creator owns them and can delete them). **YouTube signals expire after 7 days** (`expires_at`), and expired rows are ignored by reads and deleted at the next refresh. This keeps well inside YouTube's rule that stored API data must be refreshed or deleted (the Developer Policies limit is 30 days; **re-verify the current YouTube API Services Terms and Developer Policies before shipping**, including required attribution).
9. **YouTube quota is real and small** (default 10,000 units/day for the whole app; `search.list` costs 100, `videos.list` costs 1). So a refresh is deliberately cheap and tightly capped:
   - one `search.list` (100 units) + one `videos.list` (1 unit) = **101 units** per refresh;
   - **one refresh per creator per 24 hours** (cache);
   - an **app-wide daily budget** `YOUTUBE_DAILY_UNIT_BUDGET` (default 3,000 units ≈ 29 refreshes/day) checked before every call using `usage_events` (`event_type = 'youtube_api'`, `quantity` = units) over the last 24 hours. When the budget is spent, refresh is refused with a friendly message and no API call.
10. **YouTube refresh only for creators who use YouTube** (`youtube` in their platforms) **and** when `YOUTUBE_API_KEY` is configured. Otherwise the button is not shown, with one line explaining why. No fake button (AGENTS.md §14).
11. **Search query** is built deterministically from the creator's `niche` plus the name of one active pillar (the pillar least recently used, chosen by rotating through `position` by days since the last refresh). No AI call is made for this step, so refresh costs **no AI generations**. Parameters: `type=video`, `order=viewCount`, `publishedAfter` = 90 days ago, `maxResults=10`, `relevanceLanguage=en`, `safeSearch=moderate`.
12. **On-demand refresh with cache** (user's choice). No background jobs: the job runner isn't set up. A scheduled refresh is a follow-up under Phase 7.
13. **Opportunity generation is not blocked by missing signals.** With no signals, behaviour is unchanged from part 1 (evidence limited to `creator_input` / `creator_history`). With signals, the allowed kinds expand to those present.
14. **Prompt versioning:** `content_opportunities` moves to **`v2`** (`v1.ts` stays untouched). Existing stored ideas and their evidence are unchanged.
15. **New route `/app/research`** (it is in the product map) holds all signal management. Opportunities gets a link to it and an updated honesty note. Nav item "Research" becomes live.
16. **Third-party personal data:** pasted comments may name real people. The form tells the creator to remove names and handles, the text is rendered as text only, and the privacy copy is updated (signals are stored and a trimmed excerpt is sent to OpenAI for opportunity generation).
17. **Competitors table stays unused.** Competitor handles/URLs as first-class records belong to `/app/competitors` later; here a competitor observation is just a pasted note.

## Files Likely to Change

| File | Change |
|---|---|
| `lib/schemas/research.ts` (new) | `signalSource`, `signalType`, payload schemas per type, manual input schema, kind mapping, ref helpers |
| `lib/schemas/json.ts` | `researchSignalPayload` now re-exported from / replaced by the typed schema |
| `lib/schemas/opportunities.ts` | `signal_ref` in model schema, ref rules in app validation, resolved evidence, strength rule |
| `lib/ai/prompts/content_opportunities/v2.ts` (new), `registry.ts` | New prompt version, registry points to it |
| `lib/services/research-signals.ts` (new) | list/add/delete manual signals, load signals for context, cache/expiry helpers |
| `lib/research/youtube.ts` (new) | YouTube Data API adapter (fetch injected, never throws), quota accounting |
| `lib/research/env.ts` (new) | Lazy `YOUTUBE_API_KEY` / `YOUTUBE_DAILY_UNIT_BUDGET` reading |
| `lib/services/youtube-refresh.ts` (new) | Orchestration: eligibility, 24h cache, budget, query, upsert, expiry cleanup |
| `lib/services/opportunities.ts` | Load signals, expand allowed kinds, resolve refs, strength rule |
| `lib/services/creator-context.ts` | (only if needed) shared delimiter cleaning for signal text |
| `app/app/research/page.tsx`, `actions.ts` (new) | Route and server actions |
| `components/research/*` (new) | Add form, signal list/card, refresh control, empty states |
| `components/opportunities/opportunity-card.tsx`, `opportunities-content.tsx`, `app/app/opportunities/page.tsx` | Show source links for cited signals, link to Research, update note |
| `lib/app-shell/nav-items.ts` | Research becomes live |
| `components/settings/privacy-section.tsx` | Mention stored research signals and what is sent |
| `.env.example`, `README.md` | Document `YOUTUBE_API_KEY`, `YOUTUBE_DAILY_UNIT_BUDGET` (if file edits are permitted) |
| `PHASES.md` | Tick "Evidence / signals" |
| `tests/**` | See Checks |

## Database Changes

**None required.** `research_signals` already fits (including `external_id` for dedupe, `expires_at` for cache, `payload` for typed data), RLS and grants already cover creator CRUD, and `usage_events.event_type` is free text.

One optional, additive index, **only if** the context query plan needs it (decide during implementation, justify in the report):

```sql
create index research_signals_user_id_source_expires_idx
  on public.research_signals (user_id, source, expires_at);
```

If added: a new migration file `2026101x…_research_signals_index.sql`, no RLS change, and `DB_ENUM_COLUMNS` / schema-parity tests unchanged (no check constraints). The `database.types.ts` types need no change.

## Implementation Requirements

### Step A: creator-provided signals

1. **Schemas (`lib/schemas/research.ts`)**
   - `signalSource = "manual" | "youtube"`; `signalType = "audience_comment" | "competitor_note" | "creator_note" | "video"`.
   - `SIGNAL_EVIDENCE_KIND: Record<signalType, EvidenceKind>` (table in Decision 2).
   - Manual payload: `{ text: string (1-1000, trimmed), label: string | null (≤120), note: string | null }`. YouTube payload: `{ video_id, channel_title, published_at, view_count: number | null, like_count: number | null, comment_count: number | null, query }`. Both validated on write **and re-validated on read**; a row that fails is skipped and logged.
   - `manualSignalInput`: `type` (one of the three manual types), `text` (1-1000), `label` (optional ≤120), `source_url` (optional, `https` only, ≤500).
   - Content hash helper (`sha256` of normalised text, truncated) used as `external_id` for manual rows.
2. **Service (`lib/services/research-signals.ts`)**, following `opportunities.ts` conventions (never throws; logs codes only):
   - `addManualSignal(client, userId, input)`: enforces the 100-signal cap (count query), inserts via the creator's RLS-scoped client with `source = 'manual'`, `external_id = hash`, `expires_at = null`. Duplicate hash (unique violation `23505`) returns `duplicate`.
   - `deleteSignal(client, userId, id)`: `.eq("id").eq("user_id")`; returns `not_found` / `db_error`.
   - `listSignals(client, userId)`: non-expired rows, newest first, limit 100, payload re-validated.
   - `loadSignalsForPrompt(client, userId)`: the Decision 6 curated set, returned with refs `S1…` and a ready-to-send excerpt (see AI Behavior).
   - Error table `SIGNAL_ERRORS` with creator-facing messages.
3. **Server actions (`app/app/research/actions.ts`)**: `addSignalAction`, `deleteSignalAction`. Each starts with `auth.protect()`, validates with Zod, takes no user id from the client, and `revalidatePath("/app/research")` and `"/app/opportunities"`.
4. **Page `/app/research`**: static header; session-bound content behind `Suspense`.
   - Header: `h1` "Research", lead "Real signals your ideas can be based on." and a honesty line: "Signals are inputs, not facts. We show where each one came from."
   - **Add a signal** card: type select (Audience comment / Competitor observation / My own note), textarea (counter, 1,000), optional label, optional source link, helper text "Remove names and handles before you paste." Submit "Add signal", inline errors, toast "Signal added".
   - **Your signals** list: source badge ("Pasted by you" / "YouTube"), type, label or title, excerpt, date, source link (opens in new tab with `rel="noopener noreferrer"`), expiry for YouTube rows, **Delete** (with confirmation).
   - Empty state: "No signals yet. Paste a comment, a competitor observation or a note, and your ideas can cite it."
   - Link: "Generate ideas" → `/app/opportunities`.
5. **Opportunities integration**
   - `generateContentOpportunities` loads `loadSignalsForPrompt` (failure to load signals **degrades to no signals**, logged, never blocks generation).
   - `allowedEvidenceKinds` = base kinds + the evidence kinds of the loaded signals.
   - Model schema (`opportunityModelSchemaFor(allowedKinds, refs)`): evidence item = `{ kind, summary, signal_ref }` where `signal_ref` is `z.enum(refs).nullable()` (or `z.null()` when there are no refs). All keys required.
   - App validation (`opportunityOutputFor`) enforces Decision 4. Mismatched kind/ref pairs fail validation.
   - After validation, the service **resolves each ref** to `{ source, source_url, observed_at }` from the loaded row (`observed_at` = `fetched_at` for YouTube, `created_at` for manual) and stores evidence items as `{ kind, summary, source, source_url?, observed_at }`, matching the existing `evidenceItem` schema (no new column).
   - `evidenceStrengthFor` implements Decision 5.
6. **Card changes:** each evidence item that has a `source_url` renders the source as a link ("YouTube · Video title" or "Pasted comment"); items without one show the kind label as today. A line for strength explains why ("High · 2 independent signals"). `Audience fit` stays labelled "AI judgment".

### Step B: YouTube adapter

7. **Config (`lib/research/env.ts`):** `readYouTubeConfig(source)` returns `{ ok: true, apiKey, dailyUnitBudget }` or `{ ok: false, variables }` (names only). Blank budget means default 3,000. Read lazily (builds and tests run without a key).
8. **Adapter (`lib/research/youtube.ts`)**
   - `searchTopVideos({ apiKey, query, now, fetch })` calls `GET https://www.googleapis.com/youtube/v3/search` then `videos` (`part=snippet,statistics`, up to 10 ids). Returns a typed `YouTubeVideo[]` or an error code (`quota_exceeded`, `invalid_key`, `rate_limited`, `timeout`, `api_error`, `invalid_response`).
   - `fetch` is injected, with a 10s `AbortSignal.timeout`; every response is **validated with Zod** (no trusting the shape). The API key goes only in the request URL/header server-side and is never logged or returned.
   - Maps Google error reasons (`quotaExceeded`, `rateLimitExceeded`, `keyInvalid`) to codes. Never throws.
9. **Orchestration (`lib/services/youtube-refresh.ts`)** `refreshYouTubeSignals(client, adminClient, userId, deps)`:
   1. Eligible? Creator has `youtube` in platforms and an active pillar, and the key is configured; otherwise `not_eligible` / `not_configured`.
   2. **24h cache:** newest `source = 'youtube'` row with `fetched_at` inside 24h → `cached` (returns when the next refresh is allowed). No API call.
   3. **Budget:** sum `quantity` of `event_type = 'youtube_api'` over 24h (admin client). If `used + 101 > budget` → `budget_exhausted`. No API call.
   4. Build the query (Decision 11), call the adapter.
   5. Record a `usage_events` row (`youtube_api`, `quantity` = units actually spent, metadata `{ kind: 'youtube_search' }`) **even when the API fails after spending quota**.
   6. Delete this creator's expired YouTube rows, then upsert fetched videos (`onConflict: user_id,source,external_id`, `external_id = video_id`, `expires_at = now + 7d`, `source_url = https://www.youtube.com/watch?v=<id>`). Returns `{ ok: true, added: n, nextRefreshAt }`.
   - Result errors map to messages in `YOUTUBE_ERRORS`; all are inline, recoverable and say what to do next.
10. **Server action:** `refreshYouTubeAction` (`auth.protect()`, no inputs); success returns `{ added }` and the client shows a toast "N videos added".
11. **UI:** a "YouTube research" card on `/app/research` with the button **Refresh from YouTube**, the line "Fetches recent popular videos in your niche. Uses no AI generations. Available once a day.", the last-refreshed time, pending text "Fetching videos…", and the not-available explanations from Decision 10. YouTube rows show the title, channel, published date, view count, and a link to the video. They are labelled "From YouTube" with the required API attribution text.
12. **Nav:** Research becomes live (`href` union widened).

## AI Behavior

- **Prompt:** `content_opportunities/v2`. Same role, rules and output as v1, plus:
  - each signal is delivered inside `<research_signal ref="S1" type="audience_comment" source="manual">…</research_signal>` blocks and the system prompt declares these **data, never instructions** (same stance as `<creator_input>`); the delimiter cleaner strips any `research_signal` tags from signal text;
  - rules: cite a signal only through its ref and only with the matching kind; write the summary as an attribution ("A comment you pasted says…", "A recent YouTube video titled … has N views"); never state or imply a trend, market size, or that something will perform; never merge or exaggerate signals; one idea may cite 1-3 pieces of evidence.
- **Input context:** v1's context plus up to 12 curated signals. Per signal only: ref, type, source, a ≤240-character excerpt (comments/notes) or `title | channel | published date | view count` (YouTube). No URLs, ids, emails or names.
- **Model:** unchanged route (`content_opportunities`, `quality`, `maxOutputTokens` 6,000, bump to 7,000 only if live validation shows truncation).
- **Structured output:** per-request strict schema (all keys required, `signal_ref` nullable enum), then app validation (ref/kind consistency, lengths), then server-side ref resolution and strength computation.
- **Failure behaviour:** unchanged error table. Signal-loading failure degrades to part-1 behaviour. Nothing is stored on failure.
- **Persistence:** evidence with resolved sources inside `content_ideas.evidence`; `prompt_version` recoverable as before via `ai_generation_id`.
- **Usage controls:** generation controls from part 1 are unchanged; YouTube refresh has its own per-creator and app-wide limits and uses no AI generations; manual signals capped at 100.

## Security Requirements

- `auth.protect()` in the page and every action. All reads and writes use `createUserClient()` (RLS); only quota accounting uses the admin client and only for `usage_events`.
- Ownership: delete/read always `.eq("user_id", userId)`; RLS blocks other creators' rows. Add isolation tests.
- Inputs validated with Zod: type allow-list, length caps, `https`-only URLs (reject `javascript:`/`data:`), uuid for delete.
- External and pasted text is rendered as text only and is wrapped in data delimiters in prompts, with tag-stripping.
- `YOUTUBE_API_KEY` is server-only: it lives in a `server-only` module, is never sent to the client, never logged, and never in error messages (`logEvent` fields are already restricted).
- Outbound requests go only to `www.googleapis.com` with a timeout; no user-controlled URLs are fetched (SSRF-safe: the creator's URL is stored and linked, never fetched).
- Third-party data handling: store only the fields needed, honour expiry, link back to the source, and keep API data within platform terms.

## Acceptance Criteria

1. A creator can add each of the three manual signal types, see them on `/app/research`, and delete them. Duplicates and the 100-signal cap are refused with clear messages; non-`https` links are rejected.
2. One creator can never read, list, delete or cite another creator's signals (tested at service and database level).
3. With no signals, opportunity generation behaves exactly as in part 1.
4. With signals, a generated batch can cite them. Every stored cited evidence item has a `source` and `observed_at` filled **by the server**, and a `source_url` when the row has one. A ref that doesn't exist, or a kind that doesn't match the signal's type, fails validation and stores nothing.
5. `evidence_strength` is `high` only with ≥2 distinct signals from different `source`/`signal_type` combinations; `medium` with one signal or `creator_history`; `low` otherwise. `trend_signal` and `content_gap` remain null.
6. Cards show cited sources as links where a URL exists and explain the strength in words; no scores, no "trend"/"viral" language.
7. **Refresh from YouTube**, when a key is configured and the creator uses YouTube: stores up to 10 validated videos with a 7-day expiry, spends at most 101 units, writes a `youtube_api` usage event, and shows a toast. A second click within 24h returns the cached message with no API call. When the app-wide budget is spent, it is refused with no API call.
8. Without `YOUTUBE_API_KEY`, or for a creator not on YouTube, no refresh button is shown and the reason is explained. The app builds and tests run without any key.
9. YouTube failures (invalid key, quota, rate limit, timeout, malformed response) show an inline recoverable message, never crash the page, and never leak the key.
10. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` pass.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build   # new route, actions
```

New and changed tests:
- `tests/schemas/research.test.ts`: payload schemas, manual input bounds, `https`-only URLs, kind mapping, content-hash stability and case/whitespace insensitivity.
- `tests/schemas/opportunities.test.ts`: `signal_ref` is a required nullable enum (no optional keys), ref/kind consistency rules, unknown refs rejected, v1 behaviour preserved when there are no refs.
- `tests/services/research-signals.test.ts`: add (cap, duplicate, success payload shape), delete (`not_found`, scoped filters), list (expired filtered, invalid payload rows skipped and logged), prompt loading (cap 12, ≤6 per source, refs sequential, excerpts trimmed, nothing sensitive).
- `tests/services/opportunities.test.ts`: signals expand allowed kinds, ref resolution fills `source`/`source_url`/`observed_at` server-side, mismatched kind/ref stores nothing, strength `low`/`medium`/`high` cases, signal-load failure degrades to part-1 behaviour.
- `tests/research/youtube.test.ts`: request shape (params, key placement), Zod-validated responses, each error reason mapped, timeout, malformed JSON, key never in error output.
- `tests/services/youtube-refresh.test.ts`: not eligible, not configured, 24h cache (no fetch), budget exhausted (no fetch), query building and pillar rotation, usage event recorded even on API failure, upsert payload, expiry cleanup.
- `tests/db/research-signals.test.ts` (pglite): owner CRUD, unique `(user_id, source, external_id)` behaviour, another creator can't read or write, `expires_at` filtering query, index (if added).
- `tests/ai/prompts.test.ts`: `content_opportunities` v2 is registered, declares `<research_signal>` as data, forbids unattributed claims and invented trends; user message contains refs and excerpts but no URLs; tag-stripping.
- `tests/ai/live.test.ts`: extend the opt-in live opportunities test with two sample signals and assert validation passes.

## Manual Test Procedure

1. Apply any new migration in Supabase (only if the optional index was added). Add `YOUTUBE_API_KEY` to `.env.local` for Step B (YouTube Data API v3 enabled in Google Cloud). Restart `pnpm dev`.
2. Sign in with a creator who has a strategy and YouTube selected. The sidebar shows **Research** as a link.
3. Open **Research**: empty state. Add an audience comment, a competitor observation and a note (with a valid `https` link on one). Each appears with its type, source badge and date; try a `javascript:` link, a duplicate, and an empty text: all refused inline.
4. Delete one signal after confirming. It disappears from the list and is not used in the next generation.
5. Open **Opportunities** and Generate. Expand "Why this idea": some evidence items cite your pasted signals with links; strength text matches the rule (a single signal is Medium; two different sources High; none Low). Verify in SQL that `content_ideas.evidence` items carry `source` and `observed_at` and that no stored URL differs from the signal's URL.
6. Back on **Research**, click **Refresh from YouTube**: pending text, then a toast "N videos added" and the videos listed with channel, date, views and a link. In SQL, `research_signals` has rows with `source = 'youtube'` and `expires_at` about 7 days out, and `usage_events` has one `youtube_api` row with `quantity` 101. Click again: the cached message appears and nothing new is stored.
7. Generate again: ideas can now cite YouTube videos ("A recent YouTube video titled … has N views") with a working link.
8. Failure paths: remove the key (the button disappears with an explanation); set a bad key (inline "couldn't reach YouTube" message, a usage event is still recorded); set `YOUTUBE_DAILY_UNIT_BUDGET=50` (refresh refused, no call).
9. With a second account, confirm none of the first account's signals or ideas are visible.
10. 375px width, dark mode, keyboard: the form, type select, delete confirmation, refresh button and source links are reachable with visible focus.

## UI

- **Visual interpretation:** a calm research shelf, not a feed. The page feels like a notebook you add evidence to; opportunities then point back to it. Same flat card style as Strategy and Opportunities.
- **Layout:**
  - `h1` "Research", lead line, and the one-line honesty note.
  - A two-part stack (max `max-w-3xl`): **Add a signal** card, then **YouTube research** card, then **Your signals** list.
  - Signals are single-column cards.
- **Signal card:** top row with a source badge ("Pasted by you" or "From YouTube") and the type; the title or label as `h3`; the excerpt in muted text; a meta row with the date (and the view count / channel for YouTube); actions row with **View source** (if a link exists) and **Delete**.
- **Typography:** existing scale; titles `text-lg` bold; excerpts normal weight; helper and meta lines `field-help`.
- **Spacing:** `stack-md` between cards, `stack-sm` inside.
- **Behaviour:** the add form is a server action with a pending state and an inline `role="alert"` error; success clears the form and toasts. Delete asks "Delete this signal? Ideas that already cite it keep their copy of the evidence." before submitting. The refresh control disables while pending and always shows when the next refresh is allowed.
- **Loading:** a list skeleton (three card-shaped blocks) behind `Suspense`.
- **Empty:** as in Implementation 4. YouTube card variants: "Available once a day", "Add YouTube as a platform in your profile to use this", "YouTube research isn't set up yet" (no key).
- **Error:** inline `role="alert"` for form, delete and refresh failures; a page-level load-error card.
- **Responsive and mobile:** single column; buttons full-width below 480px; long titles and URLs wrap (no horizontal overflow); the type select and textarea are full width.
- **Accessibility:** one `h1`; labelled form fields with errors tied via `aria-describedby`; source links have meaningful text and open in a new tab with `rel="noopener noreferrer"`; badges are text, not colour alone; buttons ≥ 44px.

## Known Limitations / Follow-ups

- Signals are only added by hand or by one on-demand YouTube query per day; there is no scheduled refresh (Phase 7 jobs).
- YouTube search is a coarse niche query, not competitor tracking. Competitor handles/URLs as records and channel monitoring belong to `/app/competitors`.
- No Reddit, search-trend or comment-import sources yet; each needs its own terms review.
- `trend_signal` and `content_gap` stay empty until there is a defensible way to compute them from several signals over time.
- Existing ideas keep their part-1 evidence; they are not re-evaluated against new signals.
- Signals are not embedded or vector-searched; selection is recency-based and capped.
- The YouTube terms (storage period, attribution, quota) need a final review before public launch.
