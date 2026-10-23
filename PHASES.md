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

- [ ] Error handling and recovery for all AI / external calls
- [ ] Monitoring and alerting
- [ ] Background jobs with retries (Inngest / Trigger.dev, Vercel Cron)
- [ ] Tests (Vitest, Playwright)
- [ ] Data handling (export, deletion)
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
