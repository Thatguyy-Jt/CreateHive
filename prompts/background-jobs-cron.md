# Background jobs: daily maintenance on Vercel Cron (Phase 7, part 2)

## Goal

Add the app's first scheduled job: one daily, idempotent maintenance run on **Vercel Cron**. It fixes three problems that today only fix themselves when a creator happens to act, or never:

1. **Abandoned AI generations.** If a request dies between the `pending` insert and the final update (crash, deploy, function timeout), the `ai_generations` row stays `pending` forever. It counts against the creator's daily limit and monthly allowance (`run-structured.ts` notes it "counts until cleanup exists").
2. **Expired research signals.** YouTube signals have a 7-day `expires_at`, but they're only deleted when that creator refreshes YouTube again. A creator who never refreshes keeps expired API data indefinitely. The privacy copy says these "are deleted after 7 days".
3. **Missed Paystack webhooks.** Entitlement ends at `subscriptions.current_period_end`, and only webhooks move it forward. If a renewal's webhooks are lost (Paystack gives up after 72 hours), a paying creator silently drops to Free. Likewise, a checkout whose `charge.success` never arrives stays `pending` until the creator clicks **Check status**.

The job runner decision is already made (2026-10-23): **Vercel Cron + a `CRON_SECRET`-protected route handler**, no Inngest or Trigger.dev.

**Not included: "expired checkouts".** A checkout is shown as Expired by `displayStatus()` at read time, and nothing is stored. Rewriting those rows would change nothing for the creator, so there's nothing to clean.

## Skills Read

None apply. This is server-only work with no UI, AI or animation.

Next.js docs read: `01-app/01-getting-started/15-route-handlers.md`, `03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`.

## Existing Code Inspected

- `lib/ai/run-structured.ts`: the `pending` insert, the final `status`/`error_code` update, `AI_CALL_TIMEOUT_MS = 60s`, `AI_MAX_RETRIES = 1`.
- `lib/ai/limits.ts` and `lib/services/ai-usage.ts`: rows count unless `status = 'failed'` with an `error_code` other than `invalid_output`. `error_code` is free text with no check constraint, and nothing maps it to UI copy.
- `lib/services/youtube-refresh.ts` (`saveVideos` deletes the creator's expired YouTube rows on refresh) and `lib/services/research-signals.ts` (`notExpired` hides expired rows of any source).
- `lib/services/billing.ts`:
  - `confirmPayment`/`confirmPaystack` verify and apply idempotently, and mark `last_checked_at`.
  - `syncByCode` and `syncPaystackSubscription` are state-based, so replays are harmless.
  - `PENDING_EXPIRY_MS = 1 day`, `CHECK_COOLDOWN_MS`, `handleRenewal` and `findPayment`.
- `lib/billing/entitlement.ts` (`resolveEntitlement`: paid only while `current_period_end > now`), `lib/billing/http.ts` (`PROVIDER_TIMEOUT_MS = 15s`), `lib/billing/index.ts` (`createBillingDeps`).
- `lib/supabase/admin.ts` (service role, "background jobs" are a listed use), `lib/observability/log.ts` (`SafeLogFields` has no count field, and the only levels are `error` and `warn`).
- `app/api/webhooks/paystack/route.ts`: the public-endpoint pattern.
- No `vercel.json`. `proxy.ts` matches `/api/*` but doesn't block (Clerk middleware only).
- Tests: `tests/services/fake-supabase.ts`, `tests/services/billing.test.ts` (`memoryDb`, fake Paystack), `tests/observability/log.test.ts`.

## Decisions / Assumptions

1. **One cron route, `/api/cron/daily`, scheduled daily at `0 4 * * *`** (04:00 UTC, 05:00 in Lagos). Vercel Hobby allows only daily crons, and Hobby fires anywhere within the hour, so the jobs don't depend on exact timing. Every task is idempotent and can run any number of times. On Vercel Pro the schedule can be tightened later without code changes.
2. **Auth:** Vercel sends `Authorization: Bearer <CRON_SECRET>`, which is compared in constant time. If `CRON_SECRET` is unset, the route returns 503 (logged as an error). A wrong or missing header returns 401 (logged as a warning). The secret is never logged.
3. **Retries:** Vercel Cron doesn't retry. A failed task is retried by the next day's run, and each task is idempotent. Each task runs on its own: one failing doesn't stop the others. The route returns 500 if any task failed, so the Vercel cron log shows the run as failed, and 200 otherwise.
4. **Abandoned generations:** `pending` rows created more than **15 minutes** ago are set to `status = 'failed'`, `error_code = 'abandoned'`, `completed_at = now`. A real call takes at most about 2 minutes (60s timeout × 2 attempts), so 15 minutes never catches a live call. Under the existing filters, `abandoned` rows stop counting toward limits, the same as provider failures. `'abandoned'` is a stored code, not an `AiErrorCode`, because no creator ever sees it.
5. **Expired signals:** `delete from research_signals where expires_at < now`, for **any** source. Only YouTube rows have an expiry today, but any expired row is already hidden.
6. **Paystack reconciliation** (skipped entirely when Paystack isn't configured). It has two bounded sweeps:
   - **Subscriptions:** rows with `provider = 'paystack'`, a `provider_subscription_id`, `status != 'canceled'` and `current_period_end` between **now − 7 days and now + 1 day**, i.e. due or just lapsed. Each is re-read with `syncByCode`. This rescues a renewal whose webhooks were lost, and also records a cancellation or failure we missed. Rows past their end by more than 7 days are left alone, since that's a genuine lapse.
   - **Pending payments:** `status = 'pending'`, created more than **10 minutes** ago and less than **1 day** ago (`PENDING_EXPIRY_MS`). Each goes through the existing `confirmPayment`, which applies it if Paystack says it succeeded.
   - Each sweep handles at most **25 rows** per run, oldest `current_period_end` / `created_at` first. Calls run one after another, with a **40-second total budget** for the reconciliation. When the budget runs out, the remaining rows wait for tomorrow. This keeps one run comfortably under `maxDuration = 60` with 15-second provider timeouts.
   - **Not done:** inserting missing `renewal` payment rows for lost renewal webhooks. Access is restored by the subscription sync, but a receipt for that month is only recorded if a webhook arrives. This is a known limitation, documented below.
7. **Where the code lives:**
   - `lib/jobs/daily-maintenance.ts` orchestrates the tasks and holds the two DB tasks.
   - Paystack reconciliation goes in `lib/services/billing.ts` as `reconcilePaystack(deps, options)`, because it reuses the private `syncByCode` and `PaymentRow`.
   - `lib/jobs/cron-auth.ts` holds the header check.
   - The route stays thin.
8. **Logging:**
   - `logEvent` gains an `"info"` level: `console.info`, never sent to Sentry.
   - `SafeLogFields` gains `count?: number`.
   - Each task logs one `cron_task_done` info line `{ name, count }`, or `cron_task_failed` at error level (sent to Sentry) `{ name, stage?, db_code?, code? }`.
   - Sentry cron check-ins and alert rules are part 3.
9. **No new tables.** There's no `job_runs` table: Vercel's cron log and the structured logs cover observability for now, and part 3 adds Sentry monitors.
10. Out of scope: daily opportunity generation, weekly strategy refresh, email digests (Resend isn't configured), Sentry monitors (part 3), and any UI.

## Files Likely to Change

| File | Change |
|---|---|
| `vercel.json` | **New.** `{ "crons": [{ "path": "/api/cron/daily", "schedule": "0 4 * * *" }] }` |
| `app/api/cron/daily/route.ts` | **New.** `GET`: auth → `runDailyMaintenance` → JSON summary; `maxDuration = 60` |
| `lib/jobs/cron-auth.ts` | **New.** `checkCronAuth(header, env)` → `"ok" \| "not_configured" \| "unauthorized"`, constant-time compare |
| `lib/jobs/daily-maintenance.ts` | **New.** `expireAbandonedGenerations`, `deleteExpiredSignals`, `runDailyMaintenance(deps)` |
| `lib/services/billing.ts` | Add `reconcilePaystack(deps, { limit, budgetMs })` |
| `lib/observability/log.ts` | `"info"` level, and the `count` field |
| `lib/ai/run-structured.ts` | Update the "until cleanup exists" comment |
| `components/settings/privacy-section.tsx` | No change needed. The "deleted after 7 days" statement becomes true for every creator, not just those who refresh, and the wording stays accurate |
| `tests/jobs/cron-auth.test.ts`, `tests/jobs/daily-maintenance.test.ts` | **New** |
| `tests/services/billing.test.ts` | `reconcilePaystack` cases |
| `tests/db/maintenance.test.ts` | **New.** PGlite: the stale-generation update and signal delete against the real schema; abandoned rows no longer counted |
| `tests/observability/log.test.ts` | The info level isn't sent to Sentry; `count` is allowed |
| `PHASES.md` | Check off "Background jobs with retries (Vercel Cron)" |

**Environment** (you need to add these, since `.env.example` is blocked for me): `CRON_SECRET` (server-only, at least 32 random characters). Set it in Vercel too, where it's sent to the cron automatically.

## Database Changes

None. No migration. The queries run as the service role and use existing columns. Indexes:
- **Generations:** filtered by `status = 'pending'` and `created_at`. Volume is small at beta scale, so no new index is needed now.
- **Signals:** filtered by `expires_at`, also small.
- **Subscriptions:** at most one row per creator.

## Implementation Requirements

### `lib/jobs/cron-auth.ts`
- `checkCronAuth(authorization: string | null, env = process.env)`. If `CRON_SECRET` is empty or whitespace, return `not_configured`. Otherwise compare `Bearer <secret>` with `crypto.timingSafeEqual` over equal-length buffers (a length mismatch is `unauthorized`).

### `lib/jobs/daily-maintenance.ts`
- `MaintenanceDeps = { db: AdminDb; billing: BillingDeps | null; now: () => number }`.
- `expireAbandonedGenerations(db, now)` runs `update ai_generations set status='failed', error_code='abandoned', completed_at=now where status='pending' and created_at < now − 15min`, with `{ count: "exact" }`. It returns `{ ok: true; count } | { ok: false; db_code? }`.
- `deleteExpiredSignals(db, now)` runs `delete research_signals where expires_at < now`, with `{ count: "exact" }`, and returns the same shape.
- `runDailyMaintenance(deps)` runs the three tasks in order (generations, signals, Paystack), each in its own try/catch. It logs per decision 8 and returns `{ ok: boolean; tasks: Record<"abandoned_generations" | "expired_signals" | "paystack", { ok: boolean; count?: number; skipped?: boolean }> }`. `paystack.skipped = true` when billing deps or Paystack aren't configured, and a skipped task counts as ok.
- Never throws.

### `reconcilePaystack(deps, { limit = 25, budgetMs = 40_000 })` in `lib/services/billing.ts`
- Returns `{ ok: true; subscriptions: number; payments: number } | { ok: false }`, counting rows **checked**. `ok: false` only when a selection query fails. A single row's provider failure is logged by the existing code and counted as checked.
- Subscriptions select: `user_id, provider_subscription_id` with the filters in decision 6, ordered by `current_period_end` ascending, limit `limit`. Each row goes through `syncByCode(deps, code)`. A `RETRY_LATER` outcome is fine: tomorrow retries.
- Payments select: `PAYMENT_COLUMNS` with the filters in decision 6, ordered by `created_at` ascending, limit `limit`. Each goes through `confirmPayment`.
- Before each provider call, if `deps.now() − started ≥ budgetMs`, stop and return what was checked.

### Route `app/api/cron/daily/route.ts`
- `export const maxDuration = 60;` and `GET(request)`. Verify the route builds with `cacheComponents` and has no `dynamic` export. Reading `request.headers` keeps it dynamic.
- Auth: per decision 2.
- Builds `createAdminClient()`. If that fails, log `cron_task_failed` with `{ name: "setup", variables }` and return 500. Billing deps come from `createBillingDeps()`, and null means Paystack is skipped.
- Responds with `Response.json(summary, { status: summary.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } })`. The summary holds only task names, booleans and counts.

### `vercel.json`
- Only the `crons` entry. No other settings.

## AI Behavior

No AI calls change. The only effect is that abandoned `pending` generations stop counting toward the daily limit and the monthly allowance after the next run. Real calls, failures and metering are unchanged.

## Security Requirements

- The cron route is public and authenticated only by `CRON_SECRET`, using a constant-time compare. If the secret is unset it fails closed (503).
- The service-role client is used only for these fixed maintenance queries. No input from the request reaches a query.
- Responses and logs contain no user ids, emails, references or tokens, only task names, counts and error codes.
- `CRON_SECRET` is never `NEXT_PUBLIC_`.
- Paystack calls reuse the existing adapter (secret key server-side, 15-second timeout).

## Acceptance Criteria

1. `GET /api/cron/daily` without the right bearer token returns 401 (or 503 if `CRON_SECRET` is unset), and no task runs.
2. With the token, a `pending` generation older than 15 minutes becomes `failed`/`abandoned` and stops counting toward limits. A 5-minute-old pending row is untouched.
3. Expired research signals are deleted for every creator. Unexpired and expiry-less rows remain.
4. A Paystack subscription due within a day, or lapsed under 7 days, is re-synced from Paystack. A pending payment between 10 minutes and 1 day old is confirmed. At most 25 of each are handled, and the reconciliation stops at the 40-second budget.
5. One task failing still runs the others, and the response is 500 with a per-task summary.
6. Running the job twice in a row changes nothing the second time.
7. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass, and `/api/cron/daily` appears in the build as a dynamic route.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

New tests:
- `cron-auth`:
  - An unset or blank secret is `not_configured`.
  - A missing header, the wrong scheme, a wrong secret or a different length is `unauthorized`.
  - The exact header is `ok`.
- `daily-maintenance`:
  - The update and delete carry the right filters and cutoffs, and counts are returned.
  - A DB error makes that task fail while the others still run.
  - Paystack is skipped when billing is null.
  - The overall `ok` reflects the task results, and nothing throws.
- `billing.reconcilePaystack`:
  - Only due or recently lapsed, non-cancelled Paystack rows are synced.
  - A renewal moves `current_period_end` forward.
  - Pending payments in the window are confirmed, and ones outside it are ignored.
  - The 25-row limit and the budget stop are respected.
  - A select error returns `ok: false`.
  - Paystack unconfigured returns a skip.
- DB (PGlite):
  - Against the migrated schema, the stale update touches only old `pending` rows.
  - Afterwards the limit filter excludes them.
  - The signal delete keeps `expires_at is null` rows.
- `log`: `info` prints with `console.info` and never calls Sentry, and `count` passes the sanitizer.

## Manual Test Procedure

1. Set `CRON_SECRET` in `.env.local` and run `pnpm dev`.
2. `curl -i http://localhost:3000/api/cron/daily` returns **401**. `curl -i -H "Authorization: Bearer wrong" …` also returns **401**.
3. In Supabase, insert (or leave behind) an `ai_generations` row with `status='pending'` and `created_at = now() - interval '1 hour'`. Run `curl -i -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily`. The response is **200**, with `abandoned_generations.count ≥ 1`. The row is now `failed`/`abandoned`, and Settings › AI usage no longer counts it.
4. Set one YouTube signal's `expires_at` to yesterday and re-run the job. The row is gone, and manual signals remain.
5. Paystack (test mode): for a Pro test creator, set `subscriptions.current_period_end` to yesterday. The dashboard shows Free. Run the job: `current_period_end` is restored to Paystack's next payment date, and the dashboard shows Pro again.
6. Start a checkout, pay with a test card, but stop the webhook first (or use a reference whose webhook didn't reach a local tunnel). Wait 10 minutes and run the job: the payment becomes **Paid**.
7. Run the job twice more. The second run reports `count: 0` for generations and signals.
8. After deploying, Vercel › Project › Settings › Cron Jobs lists `/api/cron/daily`. **Run** it once and check the logs for `cron_task_done` lines.

## Known Limitations

- With a lost renewal webhook, access is restored but no `renewal` payment row (receipt) is recorded for that month.
- On Hobby the job runs once a day: an abandoned generation can count for up to about 24 hours, and a missed checkout confirmation waits for the creator's own "Check status" or the next run.
- There's no alert yet if the cron stops running (part 3).
