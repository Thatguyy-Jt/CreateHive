# Monitoring and alerting (Phase 7, part 3)

## Goal

Make sure the owner **finds out** when something important breaks, without anyone watching logs:

1. **The daily cron stops running or fails.** Today a missed or failed run only shows in Vercel's cron log.
2. **The app or database is down.** There's no endpoint an uptime monitor can check.
3. **Errors that need action (billing, account deletion, cron) are buried** among routine failures. They have no tag to alert on, and preview/dev events mix with production because no `environment` is set.
4. **There are no alert rules.** Sentry alert rules live in the Sentry UI, not in code, so the deliverable for those is a short runbook with the exact rules to create.

## Skills Read

None apply. This is server-side observability with no UI, AI or animation.

Docs read:
- Next.js `01-app/01-getting-started/15-route-handlers.md`.
- The installed `@sentry/core@11.6.0` types: `captureCheckIn(checkIn, monitorConfig)` and `MonitorConfig` (`schedule`, `checkinMargin`, `maxRuntime`, `timezone`, `failureIssueThreshold`, `recoveryThreshold`), plus `flush(timeout)`.

## Existing Code Inspected

- `lib/observability/log.ts`: `logEvent` sends `error` events to Sentry as `captureMessage(event, { level, tags })`, using fields only. Events group by their message, i.e. the event name.
- `lib/observability/sentry-options.ts`: `baseSentryOptions` (DSN gate, `sendDefaultPii: false`, `beforeSend: scrubEvent`, sample rates). It has no `environment`.
- `instrumentation.ts` (`onRequestError = Sentry.captureRequestError`), `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`.
- `components/errors/error-screen.tsx`: browser errors are captured in error boundaries.
- `app/api/cron/daily/route.ts`, `lib/jobs/daily-maintenance.ts` (`MaintenanceSummary`), `lib/jobs/cron-auth.ts`.
- Config readers: `readAiConfig` (`lib/ai/env.ts`), `readBillingConfig` (`lib/billing/plans.ts`), `getSupabaseConfig` / `createAdminClient` (`lib/supabase/`), and the YouTube config in `lib/research/env.ts`. `CRON_SECRET` and `CLERK_WEBHOOK_SIGNING_SECRET` are read straight from `process.env`.
- Event names in use. Each has a stable prefix: `ai_`, `billing_`, `account_`, `cron_`, `youtube_`, `ensure_user_`, plus feature reads such as `studio_`, `strategy_` and `opportunity_`.
- `prompts/observability.md`: alert rules were explicitly deferred to "the Sentry UI". No `docs/` folder exists.
- Tests: `tests/observability/log.test.ts`, `sentry-options.test.ts`, `tests/jobs/*`.

## Decisions / Assumptions

1. **Cron monitor through Sentry check-ins.** The daily route sends an `in_progress` check-in before running and an `ok` or `error` check-in after. It sends `error` if any task failed or the run threw. The slug is `daily-maintenance`, and the monitor config is sent with the first check-in so Sentry creates the monitor itself:
   - schedule `0 4 * * *`, timezone `Etc/UTC`
   - `checkinMargin: 90` minutes (Vercel Hobby fires anywhere within the hour)
   - `maxRuntime: 5` minutes
   - `failureIssueThreshold: 1`, `recoveryThreshold: 1`

   A **missed** run (cron stopped, deploy broke the route, or the secret is wrong so it never gets past 401) also creates a Sentry issue, which the plain logs can't catch. Check-ins are sent only after auth passes, so random 401 traffic can't mark the monitor healthy. `Sentry.flush(2000)` runs before responding so the final check-in isn't lost when the function freezes. With no DSN, all of this does nothing, as today.
2. **`/api/health`** (GET, public, `Cache-Control: no-store`) is for an external uptime monitor. Sentry Uptime is the recommended one; any monitor works.
   - **Database:** a `head` count query on `users` (`limit 1`) through the service-role client, aborted after **3 seconds**. If it fails or times out, the route returns `503 { "status": "down" }`. Otherwise it returns `200 { "status": "ok" }`.
   - **Config:** the AI key, Paystack, `CRON_SECRET`, `CLERK_WEBHOOK_SIGNING_SECRET` and the YouTube key are also checked. A missing one gives `"degraded"`, but the status stays **200**, so the uptime monitor only pages on a real outage.
   - **Who sees what:** the public response is only `{ status }`. The per-check breakdown (`{ database: "ok" | "error", ai | billing | cron | account_webhook | youtube: "configured" | "missing" }`) is included only when the request carries the `CRON_SECRET` bearer token (reusing `checkCronAuth`). Strangers learn nothing about our configuration.
   - **Logging:** a database failure logs `health_check_failed` at error level (`{ stage: "database", db_code | name }`). Sentry groups repeats into one issue. Missing config isn't logged here, since each feature already logs its own `*_not_configured`.
3. **`area` tag** on every Sentry message from `logEvent`, derived from the event name's prefix:

   | Prefix | `area` |
   |---|---|
   | `billing_` | `billing` |
   | `account_` | `account` |
   | `cron_` | `cron` |
   | `ai_` | `ai` |
   | `health_` | `health` |
   | `youtube_` | `research` |
   | anything else | `app` |

   Alert rules can then target `area:billing` and `area:account` without depending on exact event names. The tag is added in the Sentry tags only, and the console JSON line is unchanged. The mapping lives in one small exported function, with tests.
4. **`environment`** in `baseSentryOptions` is `VERCEL_ENV` (`production`, `preview` or `development`) when set, otherwise `NODE_ENV`. Alert rules filter on `environment:production`, so previews never page. This is a pure function of the env and is unit tested.
5. **Alert rules are documented, not coded.** Creating them through the Sentry API would need an org admin token in CI, which is out of proportion for beta. `docs/monitoring.md` lists the exact rules to create (decision 6), the uptime monitor setup, what each `area` means, and a "when this fires" checklist. It's written for the owner or whoever is on call.
6. **Recommended rules** (all filtered to `environment:production`, all emailing the owner):
   - **A. Cron monitor `daily-maintenance`:** alert on a new issue (missed, failed or timed out). This comes with decision 1.
   - **B. Uptime `/api/health`:** check every 5 minutes, alert after 2 consecutive failures.
   - **C. Billing and account:** alert on any new or regressed issue with `area` in (`billing`, `account`). Money and deletions are always actionable.
   - **D. Error spike:** more than 50 events in 1 hour, any area. Catches an outage of the AI provider or Supabase without paging on single errors.
   - **E. New issue (any area):** a daily digest, not an immediate alert.
7. No new tables, migrations, dependencies or UI. Sentry's DSN gate and event scrubbing are unchanged.
9. **Fix found during implementation: browser Sentry was never enabled.** Next.js inlines `process.env.NEXT_PUBLIC_*` only when it's written literally. `instrumentation-client.ts` calls `baseSentryOptions()`, which reads the DSN from the `process.env` object, and that object is empty in the browser. The built client chunk confirms this: it reads `e.NEXT_PUBLIC_SENTRY_DSN` from the `process` polyfill, and no DSN value is in the bundle. So browser errors from the error screen were never sent. The fix is that `instrumentation-client.ts` passes an explicit object with literal references: `NEXT_PUBLIC_SENTRY_DSN`, `NODE_ENV` and `NEXT_PUBLIC_VERCEL_ENV`, which Vercel exposes to Next.js automatically. The `environment` rule becomes `NEXT_PUBLIC_VERCEL_ENV || VERCEL_ENV || NODE_ENV`, so browser and server agree.
8. **Out of scope:**
   - performance and tracing tuning (part 5)
   - Playwright (part 4)
   - a public status page
   - Slack or PagerDuty integrations (email is enough for beta)
   - Vercel Analytics changes

## Files Likely to Change

| File | Change |
|---|---|
| `lib/observability/cron-monitor.ts` | **New.** `DAILY_MAINTENANCE_MONITOR` (slug and config) and `monitorCron(monitor, run)`: in_progress → run → ok/error by result → flush. Never throws because of Sentry |
| `app/api/cron/daily/route.ts` | Wrap `runDailyMaintenance` with `monitorCron` after auth. A setup failure sends an `error` check-in |
| `lib/observability/health.ts` | **New.** `runHealthCheck(deps)` → `{ status, checks }`, with injectable DB ping and env |
| `app/api/health/route.ts` | **New.** GET: run the check, add details only for the bearer token, 200/503 |
| `lib/observability/log.ts` | Add the `area` tag in Sentry (`areaFor(event)`) |
| `lib/observability/sentry-options.ts` | `environment` from `VERCEL_ENV` / `NODE_ENV` |
| `docs/monitoring.md` | **New.** Runbook: alert rules A–E, uptime setup, areas, "when this fires" |
| `tests/observability/cron-monitor.test.ts` | **New** (Sentry mocked) |
| `tests/observability/health.test.ts` | **New** |
| `tests/observability/log.test.ts`, `sentry-options.test.ts` | `area` and `environment` cases |
| `PHASES.md` | Check off "Monitoring and alerting" and note part 3 |

## Database Changes

None.

## Implementation Requirements

### `lib/observability/cron-monitor.ts`
- `export const DAILY_MAINTENANCE_MONITOR = { slug: "daily-maintenance", config: { schedule: { type: "crontab", value: "0 4 * * *" }, timezone: "Etc/UTC", checkinMargin: 90, maxRuntime: 5, failureIssueThreshold: 1, recoveryThreshold: 1 } } satisfies …`
- A test checks that the schedule equals the one in `vercel.json`, so the two can't drift.
- `monitorCron<T extends { ok: boolean }>(monitor, run: () => Promise<T>): Promise<T>` works as follows:
  - It calls `captureCheckIn({ monitorSlug, status: "in_progress" }, config)`, wrapped in try/catch, and keeps the id.
  - It awaits `run()` and sends `{ checkInId, monitorSlug, status: result.ok ? "ok" : "error", duration }`.
  - If `run` throws, it sends `error` and rethrows. The route still turns that into a 500, though `runDailyMaintenance` never throws.
  - It always `await Sentry.flush(2000)` in a try/catch at the end.
  - Sentry failures never affect the job's result.

### `/api/cron/daily`
- After auth: if admin client setup fails, send a single `error` heartbeat check-in (`captureCheckIn({ monitorSlug, status: "error" }, config)`), flush, and return 500 as today.
- Otherwise: `const summary = await monitorCron(DAILY_MAINTENANCE_MONITOR, () => runDailyMaintenance(…))`.

### `lib/observability/health.ts`
- `HealthDeps = { pingDatabase: () => Promise<{ ok: true } | { ok: false; db_code?: string; name?: string }>; env: EnvSource }`.
- `runHealthCheck(deps)` returns `{ status: "ok" | "degraded" | "down"; checks: {...} }`. It never throws: a thrown ping counts as a database error.
- Config checks use the existing readers:
  - `ai`: `readAiConfig(env).ok`
  - `billing`: `readBillingConfig(env).paystack !== null`
  - `youtube`: the research env reader
  - `cron`: a non-blank `CRON_SECRET`
  - `account_webhook`: a non-blank `CLERK_WEBHOOK_SIGNING_SECRET`
- The app's kill switch (`isAiEnabled` false) counts as `configured`, because it's a deliberate pause.
- If a reader needs a different env shape, use the closest existing exported check rather than duplicating its rules.

### `/api/health`
- `pingDatabase` creates the admin client inside a try/catch. A missing Supabase env counts as `{ ok: false, name: "SupabaseEnvError" }`. It then runs `.from("users").select("id", { head: true, count: "exact" }).limit(1).abortSignal(AbortSignal.timeout(3000))`.
- Response: `Response.json(isAuthorized ? result : { status: result.status }, { status: result.status === "down" ? 503 : 200, headers: { "Cache-Control": "no-store" } })`.
- `checkCronAuth` returning `not_configured` or `unauthorized` just means the public shape is returned. That isn't logged, because uptime monitors call this constantly.

### `log.ts` and `sentry-options.ts`
- `export function areaFor(event: string): string`, using the table in decision 3. In `logEvent`'s Sentry branch, the tags become `{ area: areaFor(event), ...fieldTags }`.
- `baseSentryOptions` gains `environment: env.VERCEL_ENV?.trim() || env.NODE_ENV || "development"`.

### `docs/monitoring.md`
Sections:
1. What's monitored, and where it shows up.
2. One-time setup:
   - Sentry DSN env (already documented)
   - the cron monitor appears after the first production run
   - creating the uptime monitor: URL, interval, failure threshold
3. Alert rules A–E, with the exact Sentry UI fields (conditions, filters, action, frequency).
4. Areas and their main event names.
5. When an alert fires, a short checklist per alert:
   - cron missed → Vercel Cron Jobs page, `CRON_SECRET`, latest deploy
   - billing → the Paystack dashboard and the reconciliation in the next run
   - uptime → the Supabase status page
6. Things this does not cover.

It's plain Markdown, written for the owner, under about 150 lines.

## AI Behavior

None. The only change is that AI failure messages gain `area: ai` in Sentry.

## Security Requirements

- `/api/health` is public but returns only `ok`, `degraded` or `down`. The breakdown needs the `CRON_SECRET` bearer token, checked in constant time. No env values, ids or error messages appear in the response.
- Check-ins carry only the slug, status and duration.
- The `area` tag comes from our own event names, never from user data.
- Scrubbing (`beforeSend`) is unchanged.

## Acceptance Criteria

1. With a DSN set, an authorized `/api/cron/daily` run produces an `in_progress` check-in and then an `ok` check-in (or `error` when a task fails). The Sentry monitor `daily-maintenance` exists with the configured schedule. An unauthorized call sends no check-in.
2. Without a DSN, cron and health behave exactly as before, and nothing throws.
3. `GET /api/health`:
   - With the database reachable it returns 200 `{ "status": "ok" }`, or `"degraded"` when some config is missing.
   - With the database unreachable it returns 503 `{ "status": "down" }`.
   - With the bearer token it also returns `checks`.
   - The response is never cached.
4. Sentry messages from `logEvent` carry `area`, and every Sentry event carries `environment`.
5. `docs/monitoring.md` exists with rules A–E and the per-alert checklists.
6. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass, and `/api/health` is a dynamic route.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

New tests:
- `cron-monitor`:
  - The check-in order is in_progress then ok.
  - A failed summary gives `error`.
  - A throwing run gives `error` and rethrows.
  - A Sentry throw doesn't change the result.
  - Flush is called.
  - The schedule matches `vercel.json`.
- `health`:
  - Everything configured → `ok`.
  - Missing config → `degraded` with the right `missing` keys.
  - A ping failure or throw → `down`.
  - The kill switch counts as configured.
- `log`: `areaFor` maps every prefix in the table, the tag is added only in Sentry, and the console output is unchanged.
- `sentry-options`: `environment` comes from `VERCEL_ENV`, falling back to `NODE_ENV`.

## Manual Test Procedure

1. With `NEXT_PUBLIC_SENTRY_DSN` and `CRON_SECRET` in `.env.local`, run `pnpm dev`.
2. `curl -i http://localhost:3000/api/health` returns `200 {"status":"ok"}` (or `degraded`). Then run `curl -i -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/health`: the response also lists `checks`.
3. Temporarily set `SUPABASE_URL` to an unreachable host and restart. `/api/health` returns `503 {"status":"down"}` within about 3 seconds, and Sentry shows `health_check_failed` with `area: health`. Restore it.
4. Run `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily`. In Sentry › Crons, `daily-maintenance` appears with an OK check-in, environment `development`.
5. `curl` the cron route without the token: no new check-in appears.
6. Trigger any billing error (for example, start a checkout with Paystack unconfigured). The Sentry issue has `area: billing`.
7. Follow `docs/monitoring.md` to create the uptime monitor and rules A–E in Sentry for production.
