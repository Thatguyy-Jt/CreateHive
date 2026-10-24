# Data handling: export and account deletion (Phase 7, part 1)

## Goal

A creator can **download everything we store about them** as one JSON file, and **delete their account and all their data** from Settings. These replace the two "Coming later" lines in Settings › General › Data and privacy. Data handling and deletion are launch requirements (Phase 9).

Deletion must leave nothing behind: no rows in our database, no login at Clerk, and no Paystack subscription that keeps charging a card for an account that no longer exists. Deleting a creator from Clerk directly (from the dashboard, or Clerk's own profile modal if account deletion is enabled there) must also delete their data, through a signed Clerk webhook.

**Phase 7 split** (owner decision 2026-10-23). Background jobs use **Vercel Cron and route handlers**, not Inngest or Trigger.dev:

1. **Data export and deletion** (this prompt)
2. Background jobs on Vercel Cron: clean up stale `pending` AI generations, expired YouTube signals and expired checkouts
3. Monitoring and alerting: health check, cron check-ins, Sentry alert rules
4. Playwright smoke tests for the critical flows
5. Performance pass

## Skills Read

None apply. This is a server-side data feature with one small confirm control that copies the existing `DiscardDraftControl` pattern. It adds no AI, animation or new visual patterns.

Next.js docs read: `01-app/01-getting-started/15-route-handlers.md`, `01-app/02-guides/server-actions.md` (security: every action authenticates itself, render-time gating is not a boundary).

## Existing Code Inspected

- `components/settings/privacy-section.tsx`: the two "Coming later" lines, and the rule that every statement must match the code.
- `app/app/settings/page.tsx`, `app/app/settings/layout.tsx`, `components/settings/account-section.tsx`, `manage-account-button.tsx` (Clerk's `openUserProfile`).
- `app/app/settings/billing/export/route.ts`: the CSV export pattern (`auth.protect()`, `createUserClient()`, plain-text 500, `Content-Disposition`, `no-store`).
- `app/app/settings/billing/actions.ts` and `lib/billing/index.ts` (`createBillingDeps()`).
- `lib/services/billing.ts`: `currentPaystackRow`, `cancelPaystackSubscription` (disable, then re-read and sync), `BillingDeps`.
- `lib/billing/paystack.ts`: `disableSubscription(code, emailToken)`.
- `app/api/webhooks/paystack/route.ts`: the webhook pattern (verify signature, then 200 acknowledges or 500 retries).
- `lib/supabase/admin.ts` (service role, "background jobs and webhooks only"), `lib/supabase/server.ts` (RLS client).
- `lib/services/users.ts` and `current-user.ts` (`ensureUser` recreates the `users` row on the next visit).
- `lib/observability/log.ts` (`logEvent`, safe fields only).
- Migrations: every creator-owned table references `public.users (id) on delete cascade`. These are `subscriptions`, `payments`, `creator_profiles`, `brand_profiles`, `content_pillars`, `content_ideas`, `content_items`, `content_versions`, `analytics_snapshots`, `content_diagnoses`, `competitors`, `research_signals`, `creator_insights`, `creator_strategies`, `ai_generations`, `assets`, `usage_events` and `notifications`. The `authenticated` role has **no delete grant on `users`**, and `subscriptions`, `payments`, `ai_generations` and `usage_events` are select-only for creators.
- Supabase Storage: unused (no code reads or writes `assets` files), so there are no stored files to delete.
- `@clerk/nextjs` exposes `verifyWebhook` (`@clerk/nextjs/webhooks`, reads `CLERK_WEBHOOK_SIGNING_SECRET`), and `@clerk/backend` exposes `users.deleteUser`.
- `components/studio/discard-draft-control.tsx`: the two-step destructive confirm pattern.
- Tests: `tests/db/helpers.ts` (PGlite with migrations), `tests/db/rls-isolation.test.ts`, `tests/services/fake-supabase.ts`, `tests/services/billing.test.ts`.

## Decisions / Assumptions

1. **The export is one JSON file**, `createhive-data-YYYY-MM-DD.json`, served by a GET route handler at `/app/settings/export`. Reads use `createUserClient()`, so RLS limits them to the creator's own rows.
2. **The export includes every creator-owned table, with `select *` minus a short deny-list**, so new columns are exported by default. Removed from every row: `user_id` (redundant). Removed from `subscriptions`: `provider_customer_id`, `provider_subscription_id`, `provider_plan_code` and `provider_email_token` (provider secrets and handles, no use to the creator). Removed from `payments`: `provider_order_id` and `provider_customer_id`. A DB test fails if a table with a `user_id` column is neither exported nor listed as deliberately excluded.
3. **Paging.** Each table is read in pages of 1,000 rows (PostgREST's default cap), ordered by `id`, until a short page comes back. A failed read fails the whole export with a 500. A partial file must never look complete.
4. **Deletion is a server action that requires the creator to type `DELETE`.** The confirmation is checked on the server, not only in the UI.
5. **Deletion order:** (a) stop Paystack billing → (b) delete the `users` row with the service-role client, which cascades to every table → (c) delete the Clerk user.
   - (a) runs first because a creator whose data is gone but whose card still renews is the worst outcome. If the subscription is live and renewing (`provider = 'paystack'`, a subscription id and email token, `status` not `canceled`, `cancel_at_period_end = false`), it is disabled with `disableSubscription`. If Paystack isn't configured or the disable fails, **nothing is deleted** and the creator is told to try again or cancel in Billing first. An already-cancelled or non-renewing subscription is skipped.
   - (b) is idempotent: deleting a missing row is success.
   - If (c) fails after (b) succeeded, the creator is told their data was deleted but their login wasn't, and to try again. A retry repeats (a) and (b) harmlessly. A Clerk 404 (already deleted) counts as success.
6. **Paid time is not refunded.** Deleting during a paid month ends Pro immediately. The confirm copy says so.
7. **Payment records are deleted from our database too.** Paystack keeps its own transaction records, so our copy isn't the system of record. The privacy copy tells the creator to download their data first if they want receipts.
8. **Clerk webhook** at `/api/webhooks/clerk`, verified with `verifyWebhook`. `user.deleted` runs the same steps (a) and (b). It returns 200 on success or for events we ignore, 400 for a bad signature, 500 when (a) or (b) fails (Svix retries), and 503 when `CLERK_WEBHOOK_SIGNING_SECRET` is unset. Other event types get a 200 and are ignored.
9. **After success the browser signs out** with Clerk's `signOut({ redirectUrl: "/" })`. The deleted user's sessions are revoked anyway. No "account deleted" toast on the homepage, to keep scope small.
10. **No new tables or migrations.** The existing cascades already cover deletion.
11. **Known gap, accepted:** deleting removes `ai_generations` and `usage_events`, so a creator who deletes and signs up again starts with fresh monthly allowances. A new sign-up gets a new Clerk id anyway, so this adds no new way to abuse the limits.
12. Out of scope: cron jobs, deleting data at Paystack (not possible through their API), exports as CSV or ZIP, email confirmation of deletion, a grace period or undo.

## Files Likely to Change

| File | Change |
|---|---|
| `lib/services/account-data.ts` | **New.** `EXPORT_TABLES` (table → omitted columns), `exportCreatorData(client, userId, now)`, `deleteCreatorData(deps, userId)`, `ACCOUNT_ERRORS` |
| `app/app/settings/export/route.ts` | **New.** GET: auth, export, JSON download |
| `app/app/settings/actions.ts` | **New.** `deleteAccountAction(confirmation)`: auth, validate, `deleteCreatorData`, Clerk `deleteUser` |
| `app/api/webhooks/clerk/route.ts` | **New.** Verified `user.deleted` → `deleteCreatorData` |
| `components/settings/data-section.tsx` | **New.** "Your data" card: download link and delete control |
| `components/settings/delete-account-control.tsx` | **New, client.** Two-step confirm, typed `DELETE`, then sign out |
| `app/app/settings/page.tsx` | Render `<DataSection />` after `<PrivacySection />` |
| `components/settings/privacy-section.tsx` | Replace the two "Coming later" lines with true statements (see UI) |
| `.env.example` | Add `CLERK_WEBHOOK_SIGNING_SECRET=` |
| `tests/services/account-data.test.ts` | **New.** Unit tests (fake Supabase, fake Paystack) |
| `tests/db/account-data.test.ts` | **New.** PGlite: cascade leaves no rows, export coverage of every `user_id` table, RLS-scoped export |
| `PHASES.md` | Phase 7: record the split and the job-runner decision, check off **Data handling** |

## Database Changes

None. No migration, no new RLS policies. Deletion uses the service-role client on purpose, because creators have no delete grant on `users` and that stays true. Export uses the existing own-row select policies.

## Implementation Requirements

### `lib/services/account-data.ts`

- `EXPORT_TABLES`: a readonly record `{ [table]: { omit: readonly string[] } }` covering the 18 creator-owned tables listed above, plus `users` (exported as `account`, keeping `email`, `display_name` and `created_at`).
- `exportCreatorData(client, userId, now)` returns `{ ok: true; data: CreatorExport } | { ok: false }`. It never throws.
  - `CreatorExport = { format_version: 1; exported_at: string; account: {...} | null; tables: Record<table, Row[]> }`. Single-row tables (`creator_profiles`, `brand_profiles`, `creator_strategies` and `subscriptions`) are still arrays, so the shape is uniform.
  - Each table is queried with `.select("*").eq("user_id", userId).order("id").range(from, from + 999)` until a short page. The explicit `user_id` filter sits on top of RLS. Omitted columns are stripped in code.
  - A failure logs `account_export_failed` with `{ stage: <table>, db_code }` and returns `{ ok: false }`.
- `deleteCreatorData(deps: AccountDeps, userId)` returns `{ ok: true } | { ok: false; code: "billing_unavailable" | "billing_cancel_failed" | "persistence_error" }`. It never throws.
  - `AccountDeps = Pick<BillingDeps, "db" | "paystack" | "config">`, built from `createBillingDeps()`.
  - Reads the `subscriptions` row. Applies decision 5(a). A disable failure logs `billing_provider_failed` with `{ provider: "paystack", stage: "account_delete" }`.
  - Runs `db.from("users").delete().eq("id", userId)`. An error logs `account_delete_failed` with `{ stage: "db", db_code }`.
- `ACCOUNT_ERRORS`: creator-facing messages:
  - `billing_unavailable`: "We couldn't reach our payment provider to stop your Pro renewal, so nothing was deleted. Try again in a few minutes, or cancel your plan in Billing first."
  - `billing_cancel_failed`: same text.
  - `persistence_error`: "We couldn't delete your data right now. Nothing was removed. Please try again in a minute."
  - `login_delete_failed`: "Your data was deleted, but we couldn't close your login. Please try again."
  - `confirmation`: "Type DELETE to confirm."

### Export route `app/app/settings/export/route.ts`

- `auth.protect()`, then `createUserClient()`. If the client can't be created, log it and return a plain-text 500: "We couldn't export your data right now. Try again in a minute."
- On success, return `JSON.stringify(data, null, 2)` with `Content-Type: application/json; charset=utf-8`, `Content-Disposition: attachment; filename="createhive-data-<date>.json"` and `Cache-Control: no-store`.

### Action `app/app/settings/actions.ts`

- `"use server"`. `deleteAccountAction(_prev, formData)` returns `{ status: "idle" | "error" | "deleted"; message: string | null }`, used with `useActionState`.
- `auth.protect()` → `z.literal("DELETE")` on `formData.get("confirmation")` after trimming (case-sensitive) → `createBillingDeps()` (null → `persistence_error`) → `deleteCreatorData` → `(await clerkClient()).users.deleteUser(userId)`. A thrown error with status 404 counts as success. Any other error logs `account_delete_failed` with `{ stage: "clerk", name }` and returns `login_delete_failed`.
- The user id comes only from the Clerk session.

### Webhook `app/api/webhooks/clerk/route.ts`

- `POST`. If `CLERK_WEBHOOK_SIGNING_SECRET` is unset, log `account_webhook_rejected` with `{ code: "not_configured" }` and return 503.
- `verifyWebhook(request)`. If it throws, log a warning `account_webhook_rejected` with `{ code: "bad_signature" }` and return 400.
- If `evt.type === "user.deleted"` and `evt.data.id` is a string, run `deleteCreatorData`. Failure returns 500. Everything else returns 200.
- `proxy.ts` needs no change: Clerk middleware doesn't block unauthenticated requests, and the route never calls `auth()`.

### UI

**`DataSection`** is a `card stack-sm` with heading **"Your data"** (`aria-labelledby="settings-data"`). It has two blocks separated the same way as `DiscardDraftControl` (`border-t border-border pt-6`):

1. **Download your data.** Help text: "One JSON file with your profile, brand voice, strategy, ideas, Studio drafts and versions, posts, results, diagnoses, insights, research signals, plan and payments, and your AI usage record." Below it, a plain `<a href="/app/settings/export" download className="btn btn-secondary w-full min-[480px]:w-auto">Download my data</a>`. No JavaScript, so the browser handles progress and errors natively, like the billing CSV.
2. **`DeleteAccountControl`** (client), following `DiscardDraftControl`:
   - At rest: heading "Delete your account". Help text: "Permanently deletes your account and everything listed above. This can't be undone." Then a `btn btn-ghost btn-sm` labelled "Delete account…".
   - Confirming: a `<form action={action}>` with a `role="alert"` paragraph. On Pro, it reads: "This deletes your account and all your data, and stops your Pro renewal. Your remaining paid time ends now and isn't refunded. Download your data first if you want a copy." The Pro wording is chosen by a `hasRenewingPlan` boolean prop that the server section computes from the subscription. Otherwise the paragraph reads: "This deletes your account and all your data. Download your data first if you want a copy."
   - Below it, a labelled text input "Type DELETE to confirm" (`name="confirmation"`, `autoComplete="off"`, `autoCapitalize="characters"`, `spellCheck={false}`, ≥16px font so iOS doesn't zoom). Then "Delete my account" (`btn btn-primary btn-sm`, disabled until the input is exactly `DELETE` and while pending; the label is "Deleting…" while pending) and a "Keep my account" ghost button that gets focus when the panel opens.
   - `state.status === "error"`: inline `role="alert"` `alert` paragraph with the message, and the panel stays open.
   - `state.status === "deleted"`: an effect calls `signOut({ redirectUrl: "/" })` from `useClerk()`. While that runs, the panel shows "Account deleted. Signing you out…".
- Mobile: buttons are full width and stacked below 480px, matching the existing controls. There are no modals.
- The section's subscription read (for `hasRenewingPlan`) sits behind `Suspense` with `SectionSkeleton`, like `AccountSection`. If the read fails, the general copy is shown, and the server still cancels billing correctly.

**`PrivacySection`**: replace the two "Coming later" `<li>`s with:
- "You can download all of this as one file from **Your data** below."
- "Deleting your account (below) stops any Pro renewal, then permanently deletes your account, your login and everything listed here, including your payment records (Paystack keeps its own). Deleting your account from the account settings window does the same."

## AI Behavior

None. No AI calls, prompts or metering change.

## Security Requirements

- Every entry point authenticates itself: the export route and the action use `auth.protect()`, and the webhook uses `verifyWebhook`. Ids come only from the Clerk session or a verified webhook payload.
- The export reads through RLS (`createUserClient`) with an explicit `user_id` filter, and strips provider tokens and ids.
- The service-role client is used only inside `deleteCreatorData`, scoped by `eq("id", userId)`, never with an id from the browser.
- `DELETE` confirmation is enforced on the server.
- Logs carry only safe fields (event, stage, code, db_code, name). No ids, emails or export contents.
- `CLERK_WEBHOOK_SIGNING_SECRET` is server-only, never `NEXT_PUBLIC_`.

## Acceptance Criteria

1. Settings › General shows **Your data** with a working download and delete control. The "Coming later" lines are gone.
2. The downloaded file is valid JSON containing every creator-owned table's rows, and none of another creator's rows, `user_id` or provider token/id columns.
3. Typing anything but `DELETE` (including when posted directly) deletes nothing.
4. A successful deletion leaves zero rows for that user in every public table, deletes the Clerk user and signs the browser out to `/`.
5. With a renewing Paystack subscription, the subscription is disabled before any row is deleted. If disabling fails, nothing is deleted and the creator sees the billing message.
6. A signed `user.deleted` webhook deletes the creator's data. Unsigned requests get 400, and failures get 500.
7. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

New tests:
- `tests/services/account-data.test.ts`:
  - The export strips `user_id` and provider columns, and pages past 1,000 rows.
  - A failed table read fails the export.
  - Deletion with no subscription, a cancelled subscription or a non-renewing one skips Paystack and deletes.
  - A renewing subscription calls `disableSubscription` before the delete.
  - A disable failure, or Paystack being unconfigured, makes no delete call.
  - A DB delete error returns `persistence_error`.
- `tests/db/account-data.test.ts` (PGlite):
  - Seed two creators across all tables. Deleting creator A's `users` row as service role leaves zero A rows in every table with `user_id`, and all of B's rows.
  - Every public table with a `user_id` column appears in `EXPORT_TABLES`.
  - As creator A under RLS, the export queries return only A's rows.

## Manual Test Procedure

1. `pnpm dev`, sign in as a test creator who has finished onboarding and has a strategy, ideas, a Studio draft and a logged post.
2. Settings › General › Your data → **Download my data**. Open the file and confirm that every section is present, there's no `user_id` anywhere, `subscriptions` has no `provider_customer_id`, `provider_subscription_id`, `provider_plan_code` or `provider_email_token`, and `payments` has no `provider_order_id` or `provider_customer_id`. The plain `provider` column (`"paystack"`) and our own checkout `reference` are kept on purpose.
3. Click **Delete account…**. The **Keep my account** button is focused. Type `delete` (lowercase): the delete button stays disabled. Click **Keep my account**: the panel closes.
4. (Pro, Paystack test mode) Subscribe with a test card, then delete with `DELETE`. In the Paystack dashboard, the subscription is now **cancelled/non-renewing**.
5. The browser lands on `/` signed out. In Supabase, `select count(*)` across tables for that user id returns 0. In the Clerk dashboard, the user is gone.
6. Webhook: create a test user, add the endpoint `https://<tunnel>/api/webhooks/clerk` in Clerk → Webhooks (event `user.deleted`), and set `CLERK_WEBHOOK_SIGNING_SECRET`. Delete the user from the Clerk dashboard. The endpoint returns 200 and their rows are gone. Send a request without Svix headers with `curl -X POST`: it returns 400.
7. Failure path: unset `PAYSTACK_SECRET_KEY` for a Pro test user, then delete. You get the billing message and all data is still present.
