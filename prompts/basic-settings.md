# Basic Settings Page

Phase 1 (Foundation), item "Basic settings page" in `PHASES.md`.

## Goal

Add `/app/settings` and make the "Settings" sidebar item real. The page gives a creator three honest things that exist today:

1. **Account:** who they are signed in as, and a working way to manage their account.
2. **AI usage:** how many AI generations they have used in the last 24 hours against their daily allowance (AGENTS.md §14 "Usage information", §19).
3. **Data and privacy:** plain-language statements of what we store and where data goes, including what is not yet available.

It adds no new setting that can be changed, because nothing in the product has a preference yet. Every control on the page works (AGENTS.md §14).

## Skills Read

- `clerk` and `clerk-nextjs-patterns` (`auth.protect()` in each page, server-side reads) and `clerk-react-patterns` (`useClerk().openUserProfile()`).
- `supabase` and `supabase-postgres-best-practices`: re-read for the user-client read path under RLS.
- `ai-sdk`: not applicable.

## Existing Code Inspected

- Both `AGENTS.md` files: §11 (server-side identity), §14 (no fake UI, usage information, useful empty/loading/error states), §15 (`/app/settings` is in the route map), §19, §22.
- `app/app/layout.tsx`: shell with `RequireSession` in `Suspense` (required by `cacheComponents: true`), skip link, sidebar and header.
- `app/app/page.tsx`: the pattern to follow: `metadata`, `auth.protect()` inside a component wrapped in `Suspense`, `stack-lg` / `stack-sm`, `.card`, `.lead`, `text-muted-foreground`.
- `lib/app-shell/nav-items.ts` and `components/app-shell/sidebar-nav.tsx`: `NavItem` allows only `href: "/app"` for live items. "Settings" is currently `status: "soon"`.
- `components/app-shell/app-header.tsx`: `UserButton` already offers Clerk's "Manage account", so a second entry point is a convenience, not new logic.
- `lib/ai/limits.ts`: `checkDailyLimit(db, userId, limit, now)` counts the rolling 24 hours, excluding provider failures. `lib/ai/env.ts`: `readAiConfig` requires `OPENAI_API_KEY`, so it cannot be used just to read the cap.
- `lib/supabase/server.ts`: `createUserClient()`, the Clerk-authenticated client. RLS policy `ai_generations_select_own` lets a creator read only their own rows, so the usage read needs no service role.
- `lib/services/current-user.ts` and `users.ts`: the fail-soft result pattern to copy.
- `app/globals.css`: `.card`, `.btn*`, `.container-wide`, `stack-*`, semantic tokens. There is no form-field or badge primitive, and none is needed here.
- `tests/`: Vitest with a fake Supabase client pattern (`tests/ai/fake-db.ts`, `tests/services/users.test.ts`). No component-testing library (no jsdom, no Testing Library) and no Playwright.
- The `users` table has `id`, `email`, `created_at`, `updated_at` only. There is no preferences column.

## Decisions / Assumptions

1. **No editable preferences.** There is nothing to configure yet (no notifications, no brand voice, no billing). Adding switches that do nothing would violate §14. Those arrive with their own features (Phase 2 brand voice, Phase 6 billing).
2. **Account details come from Clerk on the server.** `currentUser()` provides name and primary email, shown read-only. Profile edits, password, email changes and sign-out of other sessions are Clerk's job, reached through `openUserProfile()` from a small client button "Manage account". I use `openUserProfile()` (modal) instead of embedding `<UserProfile />`, because the embedded component needs a catch-all route under `/app/settings/[[...rest]]`.
3. **Usage is computed in a service, not the page.** New `lib/services/ai-usage.ts` exports `getAiUsage(client, userId, limit, now)` returning `{ ok: true, used, limit, remaining } | { ok: false }`. It reuses `checkDailyLimit` so the page and the AI service can never disagree about what counts.
4. **The daily cap is read without the OpenAI key.** Add `readDailyGenerationLimit(env)` to `lib/ai/env.ts` (same parsing and default of 25 as `readAiConfig`, which will call it so there is one source). Add `isAiEnabled` display: if `AI_ENABLED=false`, the card says AI features are paused.
5. **Rolling-window wording.** Because the cap is a rolling 24 hours, the page says "in the last 24 hours" and "your allowance frees up as generations age past 24 hours". It does not claim a daily reset time.
6. **Data and privacy section is static text** that must stay true:
   - What we store: your account email, your creator content once those features exist, and a record of each AI generation (type, model, time, token counts, cost). We do not store prompts or AI replies in that record.
   - AI requests go to OpenAI with response storage turned off on our side. Creator data you submit is sent to OpenAI to produce a result.
   - Self-serve data export and account deletion are **not available yet**. Stated plainly as "Coming later", not as a disabled button.
   Wording is reviewed against the code at implementation; if a statement is not true I change the statement, not the code.
7. **No delete-account or export.** Deleting a user means deleting the Clerk user and cascading Supabase rows safely (Clerk webhook, Storage cleanup). That is its own task and is listed as a follow-up so the page does not imply it exists.
8. **Nav change.** Widen `NavItem`'s live `href` to `"/app" | "/app/settings"` and make Settings `live`. `SidebarNav` already marks the active item with `pathname === item.href`, so no component logic changes.
9. **Cache Components.** The page shell is static; the Clerk and Supabase reads sit in async components inside `Suspense` with skeleton fallbacks, as the dashboard does.
10. **Failure handling.** If the Supabase client cannot be created or the count fails, the usage card shows an inline message and the rest of the page still renders. No error is thrown. Failures go through `logEvent` if the observability work has landed, otherwise `console.error` with a stable event name and no ids (see Files).
11. **Order of work.** This is independent of the observability prompt. If observability lands first, `ai-usage.ts` logs through `logEvent`; if not, it uses `console.error(JSON.stringify({ event: "ai_usage_read_failed", ... }))` exactly like `users.ts`, and the observability work later converts it.

## Files Likely to Change

| File | Change |
|---|---|
| `app/app/settings/page.tsx` (new) | The page: metadata, three sections, `auth.protect()` inside `Suspense` |
| `components/settings/account-section.tsx` (new) | Server component: name, email, "Manage account" |
| `components/settings/manage-account-button.tsx` (new) | `"use client"`; `useClerk().openUserProfile()` |
| `components/settings/ai-usage-section.tsx` (new) | Server component: usage text and a progress bar |
| `components/settings/privacy-section.tsx` (new) | Static data-handling text |
| `lib/services/ai-usage.ts` (new) | `getAiUsage()` (decision 3) |
| `lib/ai/env.ts` | Add `readDailyGenerationLimit`; `readAiConfig` reuses it |
| `lib/app-shell/nav-items.ts` | Settings becomes live, href union widened |
| `tests/services/ai-usage.test.ts` (new) | See Checks |
| `tests/ai/models.test.ts` | One added test for `readDailyGenerationLimit` |
| `PHASES.md` | Tick the settings item |

## Database Changes

None. The read uses the existing `ai_generations` table, its index `ai_generations_user_id_created_at_idx`, and the existing select-own RLS policy.

## Implementation Requirements

1. **Route** `/app/settings`, title "Settings" (the root template adds the site name). It sits under the existing `/app` layout, so the shell, skip link and mobile menu apply.
2. **Page structure:** `h1` "Settings" and a one-line `lead`: "Your account, your AI usage, and how your data is handled." Then three `.card` sections in this order: Account, AI usage, Data and privacy. Each has an `h2` (`text-heading` size, as the dashboard card uses) with a matching `aria-labelledby`.
3. **Account section:** shows display name (first and last name if present) and primary email as a definition list; if neither exists, shows "Signed in" with no placeholder values. "Manage account" opens Clerk's profile modal. Helper text: "Change your name, email, password and connected accounts."
4. **AI usage section:**
   - Reads the creator's id from `auth()` on the server, never from the browser.
   - Shows "`X` of `Y` AI generations used in the last 24 hours".
   - Shows a bar: a native `<progress>` with `value`, `max` and an accessible label (no custom ARIA widget), styled with tokens.
   - Zero used: "You haven't used any AI generations yet. They'll show here as you create."
   - At or over the cap: the bar uses the danger token and the text says the allowance frees up as generations age past 24 hours.
   - Explanatory line: "Generations that fail because of a service problem don't count against your allowance."
   - AI paused: "AI features are paused right now." and no bar.
   - Read failure: "We couldn't load your usage right now. Refresh to try again."
5. **Privacy section:** the three statements from decision 6, as a short list, with "Coming later" shown as text beside export and deletion, not as a button.
6. **Nav:** the sidebar and mobile menu show Settings as a link and highlight it on `/app/settings`.
7. **`getAiUsage`:** accepts the client type used by `checkDailyLimit`, returns the result object and never throws.

## AI Behavior

No AI calls. This page only reads existing metadata (`ai_generations` counts) and shows the existing cap. No creator content is sent anywhere.

## Security Requirements

- `auth.protect()` in the page itself, in addition to the layout (matches the existing rule: layouts are an extra layer only).
- The user id comes from Clerk's server session. The usage read runs as the creator through `createUserClient()`, so RLS (`ai_generations_select_own`) guarantees only their own rows are counted. No service-role client is used.
- No secret reaches the client. The client component only calls `openUserProfile()`.
- The page shows the creator's own email only to them; it is not logged.
- `AI_DAILY_GENERATION_LIMIT` is read on the server only.

## Acceptance Criteria

1. Signed out, `/app/settings` redirects to sign-in. Signed in, it renders inside the shell.
2. "Settings" is a working link in the desktop sidebar and mobile menu and is highlighted on the page.
3. The Account section shows the correct name and email, and "Manage account" opens Clerk's profile.
4. The AI usage numbers match `ai_generations` for the signed-in creator: after running `pnpm test:live` for a real user (or inserting rows), the count and bar update on refresh; another creator's rows never affect it.
5. The cap shown equals `AI_DAILY_GENERATION_LIMIT` (25 by default) and matches the cap the AI service enforces.
6. Zero, near-cap, at-cap, AI-paused and read-failure states each render the text in Implementation Requirements without errors.
7. The Data and privacy text matches what the code actually does, and nothing on the page is a dead button.
8. `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm build` pass.

## Checks

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build   # required: new route and nav change
```

New automated tests (offline):
- `tests/services/ai-usage.test.ts`: used/limit/remaining arithmetic (0, below, at and over the cap, with `remaining` never negative); filters by the given user id and the 24-hour window; a database error returns `{ ok: false }` without throwing.
- `tests/ai/models.test.ts` (or a new `env` test): `readDailyGenerationLimit` default 25, valid override, blank and invalid values.
- Existing RLS tests already prove a creator cannot read another creator's `ai_generations` rows.

Component and end-to-end tests are not added: the project has neither a component-test setup nor Playwright installed, and adding them is outside this item. The page is covered by the manual procedure.

## Manual Test Procedure

1. `pnpm dev`, sign in, and open the sidebar. "Settings" should be a link.
2. Click it. You should see the three sections. Check that name and email match your Clerk account.
3. Click **Manage account**. Clerk's profile modal opens. Close it.
4. With a fresh account the usage card says you haven't used any generations. Insert rows for your own Clerk id in the Supabase SQL editor (find the id in the `users` table). `pnpm test:live` rows belong to a separate smoke-test user and never show on your page:
   ```sql
   insert into public.ai_generations (user_id, kind, status)
   select '<your clerk user id>', 'smoke_test', 'succeeded' from generate_series(1, 24);
   ```
   Refresh the page: "24 of 25". Add one more row: the bar turns to the danger colour and the text explains the 24-hour window. Delete the rows afterwards:
   ```sql
   delete from public.ai_generations where user_id = '<your clerk user id>' and kind = 'smoke_test';
   ```
5. Set `AI_DAILY_GENERATION_LIMIT=5` in `.env.local`, restart, and confirm the card reads "… of 5". Remove the line.
6. Set `AI_ENABLED=false`, restart, and confirm the card says AI features are paused. Remove the line.
7. Narrow the browser to a phone width (about 375px) and check the layout, the mobile menu entry, and that nothing scrolls sideways.
8. Switch your OS between light and dark and check both themes, including the bar colours.
9. Tab through the page with the keyboard: the skip link, the nav, then the "Manage account" button must all show a visible focus ring.

## UI

- **Visual interpretation:** a quiet utility page in the same flat, outlined style as the dashboard card. No decorative graphics. Information first, one action.
- **Layout:** the shell's `<main>` (`container-wide`). Content column capped at `max-w-2xl`, left-aligned, sections stacked with `stack-lg`; each section is a `.card` with `stack-sm` inside. Same measure as the dashboard's status card.
- **Typography:** `h1` at the existing display size; `.lead` under it; section `h2` at `text-heading`; body text at the default size; secondary lines in `text-muted-foreground`. Email and counts use the standard sans font; no mono except none needed.
- **Spacing:** the existing `stack-*` scale only. No custom pixel values.
- **Component behaviour:**
  - Account rows are label/value pairs (`dl`), label muted, value normal weight; the email wraps instead of overflowing.
  - "Manage account" is `.btn .btn-secondary`, minimum 44px height.
  - The usage bar is a native `<progress>` with a visible label; it uses the accent colour normally and the danger token at or over the cap, with the text conveying the state too (colour is not the only signal).
- **Loading:** each async section renders a card-shaped skeleton (muted blocks, no spinner text) inside `Suspense`; the heading and lead render immediately.
- **Empty:** zero usage shows the "haven't used any" sentence; an account without a name shows only the email.
- **Error:** a failed usage read shows the inline sentence in the usage card only. The rest of the page is unaffected.
- **Responsive and mobile:** single column at every width. The page works at 320px: labels and values stack, the button goes full width below 480px, the email breaks onto its own line. The mobile menu already lists Settings via the shared nav.
- **Dark mode:** semantic tokens only, following the OS theme like the rest of the app.
- **Accessibility:** one `h1`; sections labelled by their headings; `<progress>` has an accessible name; the Clerk modal is Clerk's own and handles focus.

## Known Limitations / Follow-ups

- No editable settings, notification preferences or theme toggle. They arrive with the features that need them.
- No data export or account deletion yet (decision 7). This is a real gap before public launch (AGENTS.md §22) and needs its own prompt covering the Clerk user, Supabase cascade and Storage cleanup.
- Plan-based limits and the billing page arrive in Phase 6; this card will then show the plan's cap.
- Usage shows generation counts, not money. Per-creator cost (`usage_events.cost_micros`) is not shown to creators.
- The cap shown is read from the environment, so it reflects the current deployment setting, not a stored per-creator value.
