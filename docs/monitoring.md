# Monitoring and alerting

How CreateHive tells you something is wrong, what to set up once, and what to check when an alert fires. Sentry menu names shift over time; if a label below doesn't match, look for the closest equivalent.

## 1. What's monitored

| Signal | Where it shows up |
|---|---|
| Server errors (pages, route handlers, server actions) | Sentry issues, via `onRequestError` |
| Browser errors caught by the error screens | Sentry issues |
| Handled failures (`logEvent("error", …)`: AI, billing, account, cron, research…) | Sentry issues, one per event name, tagged `area` |
| Daily maintenance job (`/api/cron/daily`) | Sentry › Crons › `daily-maintenance`: OK, failed, missed or timed out |
| App and database up | `/api/health`, checked by an uptime monitor |

Every Sentry event carries `environment` (`production`, `preview` or `development`). **All alert rules below filter to `production`.** No cookies, headers, request bodies, users, prompts or AI replies are sent to Sentry.

## 2. One-time setup

1. **Sentry DSN.** Set `NEXT_PUBLIC_SENTRY_DSN` in Vercel (all environments). Without it, nothing is sent and the app works as normal.
2. **Cron monitor.** Nothing to create: the first production run of the cron creates `daily-maintenance` in Sentry › Crons with its schedule (`0 4 * * *` UTC, 90-minute margin, 5-minute max runtime). Afterwards, open it and confirm the alert goes to you (rule A).
3. **Uptime monitor.** In Sentry, go to Alerts › Create Alert › Uptime Monitor (or use any uptime service):
   - URL: `https://<production-domain>/api/health`, method GET
   - Interval: 5 minutes
   - Alert after 2 consecutive failures (a failure is a non-2xx response or a timeout)
   - Environment: production
4. **`CRON_SECRET`.** This is already required by the cron. With it, `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/health` also shows which settings are missing.

## 3. Alert rules to create

Create these in Sentry › Alerts › Create Alert. Each one emails the owner.

**A. Cron monitor: daily maintenance.**
In Crons › `daily-maintenance` › alert settings, notify on a new issue. A run that is missed, fails or times out creates an issue. That covers the cron being turned off, a broken deploy, or a wrong `CRON_SECRET` (the run never gets past 401, so it's reported as missed).

**B. Uptime: `/api/health`.**
This comes from the uptime monitor in setup step 3. It fires when the app or the database is unreachable (`503 down`).

**C. Billing and account problems (Issue alert).**
- When: *A new issue is created* **or** *The issue changes state from resolved to unresolved*
- If: *The event's tags match* `area` *is in* `billing, account` (two filters with "any" also work)
- Environment: production
- Then: email the owner. Action interval: 5 minutes

Money and account deletions always need a human.

**D. Error spike (Metric alert).**
- Metric: number of errors, environment production
- Critical: above **50 in 1 hour**. Resolve below 10.
- Then: email the owner

This catches the AI provider, Supabase or Paystack failing broadly, without paging on single errors.

**E. Everything else: daily digest (Issue alert).**
- When: *A new issue is created*
- Environment: production
- Then: email the owner. Action interval: **1 day**

## 4. Areas

`area` is set from the event name prefix (`lib/observability/log.ts`).

| `area` | Typical events | Meaning |
|---|---|---|
| `billing` | `billing_webhook_rejected`, `billing_provider_failed`, `billing_apply_failed`, `billing_reconcile_failed`, `billing_sync_failed` | Paystack calls, webhooks, applying payments |
| `account` | `account_delete_failed`, `account_export_failed`, `account_webhook_rejected` | Data export and account deletion |
| `cron` | `cron_task_failed`, `cron_rejected` | The daily maintenance job |
| `ai` | `ai_generation_failed`, `ai_not_configured`, `ai_limit_check_failed` | OpenAI calls and AI metering |
| `health` | `health_check_failed` | `/api/health` couldn't reach the database |
| `research` | `youtube_refresh_failed` | YouTube Data API |
| `app` | everything else (`*_read_failed`, `*_save_failed`, …) | Feature reads and writes |

## 5. When an alert fires

**Cron missed or failed (A).**
1. Vercel › Project › Settings › Cron Jobs: is `/api/cron/daily` listed and enabled? Click **Run** to retry now.
2. If it's missed: is `CRON_SECRET` set in Vercel production? Did the latest deploy fail?
3. If it failed: the Vercel function log for the run has `cron_task_failed` lines naming the task (`abandoned_generations`, `expired_signals` or `paystack`). Every task is safe to re-run.

**Uptime down (B).**
1. Open `/api/health` with the bearer token. Is it `database: error`?
2. Check status.supabase.com and the Supabase project (paused? connection limits?).
3. Check Vercel for a failed deploy and roll back if needed.

**Billing or account (C).**
- `billing_webhook_rejected` with `bad_signature`: check that `PAYSTACK_SECRET_KEY` matches the Paystack dashboard (test vs live).
- Payment or sync failures: find the payment in Paystack. The next daily run re-checks due subscriptions and pending checkouts; run the cron manually to do it now.
- `account_delete_failed` with stage `clerk`: the data is gone but the login isn't. Delete the user in the Clerk dashboard.
- `account_delete_failed` with stage `db`, or `billing_provider_failed` with stage `account_delete`: nothing was deleted, and the creator was told to retry.

**Error spike (D).**
Sort the issues by events in the last hour. Usually one `area` dominates: `ai` (check status.openai.com and the `AI_ENABLED=false` kill switch), `app` or `health` (Supabase), or `billing` (status.paystack.com).

## 6. Not covered

- No status page for creators.
- No Slack or PagerDuty: alerts are email only.
- Performance (slow pages and queries) isn't alerted on yet.
- Vercel Analytics is for traffic, not alerts.
