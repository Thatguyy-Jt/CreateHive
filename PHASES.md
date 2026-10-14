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
| 4 | Content Studio | ⬜ Not done |
| 5 | Analytics and Learning | ⬜ Not done |
| 6 | Billing | ⬜ Not done |
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

## Phase 4 — Content Studio — ⬜ Not done

- [x] Content package generation (`generateContentPackage()`)
- [x] Hooks
- [x] Scripts
- [x] Shot lists
- [x] Captions
- [x] CTAs
- [x] Titles
- [x] Thumbnail concepts
- [x] Repurposing suggestions
- [ ] Section-level regeneration
- [ ] Save / edit / version (`content_items`, `content_versions`)
- [x] Studio routes (`/app/studio`, `/app/studio/[id]`)

## Phase 5 — Analytics and Learning — ⬜ Not done

- [ ] Analytics import / manual entry
- [ ] Performance snapshots (`analytics_snapshots`)
- [ ] AI diagnosis (`analyzeContentPerformance()`)
- [ ] Creator insights (`creator_insights`, `updateCreatorInsights()`)
- [ ] Learning feedback loop into recommendations
- [ ] Analytics and insights routes (`/app/analytics`, `/app/insights`)

## Phase 6 — Billing — ⬜ Not done

- [ ] Plans
- [ ] Checkout (Stripe)
- [ ] Subscription state (`subscriptions`)
- [ ] Usage metering (`usage_events`, per-user limits)
- [ ] Webhooks
- [ ] Billing page (`/app/billing`)

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
