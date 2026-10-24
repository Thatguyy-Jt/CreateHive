# Build Phases — AI Creator Strategist

Mark a task `[x]` when it is finished. When every task in a phase is checked, change the phase status to `✅ DONE`.

**Core loop:** Creator Profile → Audience Understanding → Opportunity Detection → Content Plan → Creation → Publishing → Analytics → AI Diagnosis → Improved Recommendations

**MVP scope:** Phases 1–5 (onboarding, strategy, opportunities, Content Studio, basic analytics + diagnosis).

## Progress Overview

| # | Phase | Status |
|---|-------|--------|
| 1 | Foundation | ✅ DONE |
| 2 | Creator Intelligence | ✅ DONE |
| 3 | Opportunity Engine | ✅ DONE |
| 4 | Content Studio | ✅ DONE |
| 5 | Analytics and Learning | ✅ DONE |
| 6 | Billing | ✅ DONE |
| 7 | Reliability | ⬜ Not done |
| 8 | Beta | ⬜ Not done |
| 9 | Public Launch | ⬜ Not done |

---

## Phase 1 — Foundation — ✅ DONE

- [x] App shell (layout, navigation, `/app` route group)
- [x] Authentication (Clerk)
- [x] Database (Supabase PostgreSQL) and core migrations
- [x] Row Level Security policies and data-isolation tests
- [x] Core types (generated DB types, shared Zod schemas)
- [x] AI service (Vercel AI SDK, model routing, prompt organization)
- [x] Observability (Sentry / Vercel Analytics)
- [x] Basic settings page

## Phase 2 — Creator Intelligence — ✅ DONE

- [x] Onboarding flow (`/onboarding`)
- [x] Creator profile (`creator_profiles`)
- [x] Brand voice (`brand_profiles`)
- [x] Strategy generation (`generateCreatorStrategy()`)
- [x] Persistent strategy (pillars, positioning, 30-day plan) at `/app/strategy`
- [x] Creator context builder

## Phase 3 — Opportunity Engine — ✅ DONE

- [x] Opportunities (`generateContentOpportunities()`, `content_ideas`)
- [x] Evidence / signals (`research_signals`)
- [x] Daily recommendations (`getDailyRecommendation()`)
- [x] Calendar (`/app/calendar`)
- [x] Weekly planning (`generateWeeklyPlan()`)
- [x] Dashboard: "What should I do today?" (`/app`)

## Phase 4 — Content Studio — ✅ DONE

- [x] Content package generation (`generateContentPackage()`)
- [x] Hooks
- [x] Scripts
- [x] Shot lists
- [x] Captions
- [x] CTAs
- [x] Titles
- [x] Thumbnail concepts
- [x] Repurposing suggestions
- [x] Section-level regeneration
- [x] Save / edit / version (`content_items`, `content_versions`)
- [x] Studio routes (`/app/studio`, `/app/studio/[id]`)

## Phase 5 — Analytics and Learning — ✅ DONE

- [x] Analytics import / manual entry
- [x] Performance snapshots (`analytics_snapshots`)
- [x] AI diagnosis (`analyzeContentPerformance()`)
- [x] Creator insights (`creator_insights`, `updateCreatorInsights()`)
- [x] Learning feedback loop into recommendations
- [x] Analytics and insights routes (`/app/analytics`, `/app/insights`)

## Phase 6 — Billing — ✅ DONE

Payment provider: **Paystack** (monthly card subscriptions, NGN) instead of Stripe. Stripe doesn't onboard Nigerian businesses, and most creators are expected to be in Nigeria (owner decision, 2026-10-21). See `prompts/billing-paystack-opay.md`.

Part 3 (`prompts/billing-paystack-only.md`, owner decision 2026-10-23): **OPay removed**. Its sandbox was never confirmed and its onboarding blocked testing. Paystack is the only provider, and Pro is ₦12,000 a month.

Part 2 (`prompts/pricing-and-billing-settings.md`): **Free and Pro only** (Studio removed), per-feature monthly allowances instead of a daily count, a public `/pricing` page, billing moved into Settings › Billing (receipts, CSV export, card on file), and Upgrade to Pro prompts on the dashboard and at Free limits.

- [x] Plans (Free / Pro) and public pricing page (`/pricing`)
- [x] Checkout (Paystack)
- [x] Subscription state (`subscriptions`, `payments`)
- [x] Usage metering (`usage_events`, per-feature monthly allowances)
- [x] Webhooks (`/api/webhooks/paystack`)
- [x] Billing in Settings (`/app/settings/billing`)

## Phase 7 — Reliability — ⬜ Not done

Split into parts (owner decision, 2026-10-23): 1. data export and deletion, 2. background jobs, 3. monitoring and alerting, 4. Playwright smoke tests, 5. performance. Background jobs run on **Vercel Cron + `CRON_SECRET`-protected route handlers**, not Inngest or Trigger.dev.

Part 1 (`prompts/data-export-and-deletion.md`): JSON export at `/app/settings/export`, account deletion in Settings (stops Paystack renewal, cascades every row, deletes the Clerk user), and a Clerk `user.deleted` webhook at `/api/webhooks/clerk`.

Part 2 (`prompts/background-jobs-cron.md`): a daily, idempotent maintenance job at `/api/cron/daily` (`vercel.json`, 04:00 UTC, `CRON_SECRET`). It marks abandoned `pending` AI generations as failed, deletes expired research signals, and reconciles Paystack subscriptions and pending checkouts that lost webhooks. A failed task is retried by the next run.

Part 3 (`prompts/monitoring-and-alerting.md`):
- A Sentry cron monitor (`daily-maintenance`) for missed or failed runs.
- `/api/health` for an uptime monitor.
- An `area` tag and `environment` on Sentry events.
- Browser Sentry fixed: it was never enabled.
- The alert-rule runbook in `docs/monitoring.md`. Alert rules are created by hand in the Sentry UI.

Part 4 (`prompts/playwright-smoke-tests.md`): Playwright smoke tests in `e2e/` (`pnpm test:e2e`), covering public pages at desktop and phone width, onboarding, the data export, the delete-confirm gating and every app page. They run against a dedicated Clerk dev test creator, reset each run, with AI off. Local only for now; see `docs/testing.md`.

- [ ] Error handling and recovery for all AI / external calls
- [x] Monitoring and alerting
- [x] Background jobs with retries (Vercel Cron)
- [x] Tests (Vitest, Playwright)
- [x] Data handling (export, deletion)
- [ ] Performance improvements

## Phase 8 — Beta — ⬜ Not done

- [ ] Onboard ~20–50 creators
- [ ] Collect feedback: confusing workflows
- [ ] Collect feedback: weak recommendations
- [ ] Collect feedback: missing creator context
- [ ] Collect feedback: AI quality issues
- [ ] Collect feedback: analytics gaps
- [ ] Collect feedback: reliability problems
- [ ] Fix prioritized issues

## Phase 9 — Public Launch — ⬜ Not done

- [ ] Core workflows reliable
- [ ] Observability in place
- [ ] Billing working end to end
- [ ] Data handling / deletion working
- [ ] Launch
