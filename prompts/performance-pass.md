# Performance pass (Phase 7, part 5)

## Goal

Make CreateHive measurably lighter where it counts, and start measuring real users' performance. **Everything here was found by measuring first.** No speculative rewrites.

### Baseline (production build, measured 2026-10-29)

| What | Measured | Notes |
|---|---|---|
| `/` and `/pricing` TTFB | ~105 ms / ~75 ms | Prerendered and served from the cache (`x-nextjs-cache: HIT`). Already good |
| JS on `/` and `/pricing` | ~290 KB gzipped (14 scripts) | Mostly React, the router, Clerk (~26 KB) and Sentry (~52 KB) |
| Fonts preloaded on `/` | 4 files, **92 KB** | Includes **Nunito Sans** (used only by the logged-in app) and **Geist Mono** (only `code`/`kbd`) |
| Zod in the browser | ~29 KB gzipped chunk on app pages that use forms | Pulled in by 14 client components importing label/limit **constants** from `lib/schemas/*`, modules that also define Zod schemas |
| `/api/health` | ~600 ms | Runs `count: "exact"` on `users`, which counts the whole table on every uptime check |
| Cron sweeps | No index for `ai_generations` `status='pending'` + `created_at`, or `research_signals.expires_at` | Full-table scans once a day, which grow with the data |
| Hero image | Uses `priority` | **Deprecated in Next 16** in favour of `preload` (docs: `03-api-reference/02-components/image.md`) |

**Checked and already fine, so no change:**
- **The dashboard:** a static shell with each card in its own Suspense boundary. The cards load in parallel.
- **Services:** they use `Promise.all` for independent reads, and reads are bounded (for example `BASELINE_POST_LIMIT`).
- **RLS policies:** they use the cached `(select auth.jwt() ->> 'sub')` form.
- **Indexes for the main read paths:** all exist.
- **The hero image:** `sizes` is set correctly.

**Not measured:** signed-in pages in production, which need a session (part 4's test creator isn't set up yet). Real-user numbers come from decision 8.

## Skills Read

- `animation-performance` doesn't apply (there are no animation changes).
- No skill covers bundle or font work.

Next.js docs read: `03-api-reference/02-components/image.md` (`preload`, `priority` deprecated), `03-api-reference/02-components/font.md` (`preload`, per-layout loading).

## Existing Code Inspected

- `app/layout.tsx`: four `next/font/google` families (Manrope, Nunito Sans 400/700/800, Instrument Serif italic, Geist Mono). All are applied at the root, so all are preloaded on every route.
- `app/globals.css`: `--font-mono` is used only by `code, kbd, pre`. Section 11 says Nunito Sans is the logged-in app's single family. `--font-accent` is Instrument Serif.
- `app/app/layout.tsx`, `app/onboarding/layout.tsx`: the logged-in shells.
- `components/marketing/hero.tsx` (`priority`), `creators.tsx` and `feature-splits.tsx` (lazy `<Image>` with `sizes`).
- Client components with value imports from `lib/schemas/*`:
  - `PLATFORM_LABELS`
  - `FORMAT_MAX`, `TITLE_MAX`, `RESULT_FIELD_LABELS`
  - `SIGNAL_SOURCE_LABELS`, `SIGNAL_TYPE_LABELS`, `MANUAL_TEXT_MAX`, `manualSignalType`
  - `experienceLevel`, plus `creatorGoal`/`platform` options in `onboarding-form.tsx`
- `next.config.ts` (`withSentryConfig`), `lib/observability/sentry-options.ts` (`tracesSampleRate` 0.1 in production).
- `app/api/health/route.ts` (`count: "exact"`).
- `lib/jobs/daily-maintenance.ts` (the sweep queries) and the migrations' index list.
- `lib/services/ai-usage.ts`: `getPlanUsage` awaits `getAllowance`, then `getMonthlyUsage`.
- `components/settings/privacy-section.tsx` (the Vercel Analytics statement), `@vercel/analytics` in the root layout.

## Decisions / Assumptions

1. **Fonts.**
   - **Nunito Sans moves out of the root layout** into a shared `app/fonts.ts`. Its variable class is applied only on the logged-in shells (`app/app/layout.tsx` and `app/onboarding/layout.tsx`). Next then preloads it only on those routes.
   - **Geist Mono** gets `preload: false`. It's still loaded when a `code`/`kbd` element appears, with `display: swap`.
   - **Manrope and Instrument Serif stay as they are,** because the marketing pages use both above the fold.
   - Target: about 40 KB less font preloading on `/`, `/pricing` and sign-in.
   - Before moving, I'll check that nothing outside those two shells uses `--font-nunito-sans`. If something does (for example a shared component on a public page), that page keeps the font through the same shared module.
2. **Hero image:** `priority` → `preload`. This is the documented Next 16 replacement, and the behaviour is the same.
3. **Zod out of the client bundle.**
   - **New zod-free modules for display constants:** `lib/schemas/labels.ts` (labels, option lists) and `lib/schemas/limits.ts` (max lengths). Each enum's options are written as a plain `as const` tuple, and the Zod enums in `enums.ts`/`creator.ts`/`research.ts` are built from those tuples, so there's one source of truth.
   - **No server import changes:** the existing schema modules **re-export** the moved constants.
   - **Client components** import from the new modules. Type-only imports stay as they are, since they're erased.
   - **Guard test:** `labels.ts` and `limits.ts` must never import `zod`.
   - **Target:** no Zod chunk on any page whose client code only needs labels. Forms that validate on the client (if any) keep Zod; I'll report which pages still load it.
4. **Sentry:** `withSentryConfig({ treeshake: { removeDebugLogging: true } })` removes SDK debug logging from bundles. Tracing stays (10% sampled), because it's the only per-route performance data from Sentry. If this has no measurable effect under Turbopack, I'll keep it (it's harmless) and report that.
5. **`/api/health`** uses `.select("id").limit(1)` with no count: one indexed row instead of a table count. The 3-second timeout and the behaviour are unchanged.
6. **Indexes for the daily sweeps.** A new migration `20261029000100_maintenance_indexes.sql` adds two partial indexes, using plain `create index`:
   - `ai_generations (created_at) where status = 'pending'`. It stays tiny, since pending rows are short-lived.
   - `research_signals (expires_at) where expires_at is not null`.

   `create index concurrently` can't run inside the migration transaction, and the tables are small at beta. No RLS or grant changes.
7. **`getPlanUsage`** reads the plan and the monthly usage counts in parallel:
   - `getMonthlyUsage` only needs the plan id to pick allowances, so the counts are fetched in parallel and the allowances are applied once both arrive.
   - This saves one database round trip on the dashboard's AI usage line and Settings › AI usage.
   - If the counting query actually depends on the plan, it stays sequential and I'll report why.
8. **Real-user performance monitoring:** add `@vercel/speed-insights` (`<SpeedInsights />` next to `<Analytics />` in the root layout). It collects Core Web Vitals (LCP, INP, CLS) per route from real visitors, without cookies, and needs no code beyond the component. Speed Insights has to be enabled in the Vercel project. The privacy section's monitoring line mentions it.
9. **Out of scope:**
   - Replacing Clerk or Sentry.
   - Removing client tracing.
   - Server-side caching of creator data. Every page is per-creator and must be fresh, and `"use cache"` with per-user keys would be a larger design change.
   - Image format work (Next already serves AVIF/WebP).
   - Edge runtime moves.
   - Anything without a measured problem.

## Files Likely to Change

| File | Change |
|---|---|
| `app/fonts.ts` | **New.** The four font loaders, with `preload` set per decision 1 |
| `app/layout.tsx` | Use `app/fonts.ts`. Root classes: Manrope, Instrument Serif, Geist Mono. Add `<SpeedInsights />` |
| `app/app/layout.tsx`, `app/onboarding/layout.tsx` | Add the Nunito Sans variable class on the shell |
| `components/marketing/hero.tsx` | `priority` → `preload` |
| `lib/schemas/labels.ts`, `lib/schemas/limits.ts` | **New**, zod-free |
| `lib/schemas/{enums,creator,analytics,research}.ts` | Build the enums from the tuples and re-export the constants |
| The 14 client components | Import constants from the new modules |
| `next.config.ts` | `treeshake.removeDebugLogging` |
| `app/api/health/route.ts` | Cheaper ping |
| `supabase/migrations/20261029000100_maintenance_indexes.sql` | **New**, two partial indexes |
| `lib/services/ai-usage.ts` | Parallel reads |
| `components/settings/privacy-section.tsx` | Mention Speed Insights |
| `package.json` | `@vercel/speed-insights` |
| Tests | Zod-free guard. `schema-parity` still passes. A DB test that the indexes exist and the sweep queries use them (`explain`). `ai-usage` test for the parallel path |
| `PHASES.md` | Check off "Performance improvements". Phase 7 → ✅ DONE |

## Database Changes

One migration with two partial indexes (decision 6). There are no column, RLS or grant changes. `lib/supabase/database.types.ts` doesn't change, since indexes don't appear in the types.

## Implementation Requirements

- **Measure after each change, using the baseline method:**
  - JS per route: the gzipped sum of the scripts in `.next/server/app/<page>.html`.
  - Fonts: the sum of the `-s.p.` woff2 files referenced.
  - TTFB: the median of 3 `curl` runs against `pnpm start`.
  - Zod: which client chunks contain it.
- The report gives a before/after table. No claim is made without a measurement.
- Behaviour must be identical: same text, same validation messages, same fonts rendered on each page. Font changes are checked visually on `/`, `/pricing`, `/onboarding` and `/app`.
- All existing tests pass unchanged, except the ones the refactor needs.

## AI Behavior

None.

## Security Requirements

- No new data collection beyond anonymous Web Vitals (Speed Insights, no cookies), which is disclosed in the privacy section.
- The health endpoint's response and auth are unchanged.
- The migration only adds indexes.

## Acceptance Criteria

1. Fonts preloaded on `/` drop from 92 KB, with Nunito Sans no longer preloaded there. `/app` and `/onboarding` still render in Nunito Sans.
2. App pages that only display labels no longer load the Zod chunk. The pages that still load it are listed in the report.
3. The hero uses `preload`, and the build shows no `priority` deprecation for it.
4. `/api/health` no longer counts the table, and its TTFB is reported before and after.
5. The two partial indexes exist, and `explain` shows the sweep queries can use them (in PGlite).
6. `getPlanUsage` makes its reads in parallel, with results unchanged.
7. `<SpeedInsights />` renders, and the privacy section mentions it.
8. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and the public `pnpm test:e2e` specs pass.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Plus the before/after measurements described above.

## Manual Test Procedure

1. Run `pnpm build && pnpm start`. Open `/`, `/pricing` and `/sign-in` in DevTools › Network › Font: only the marketing fonts load. Open `/app` and `/onboarding`: Nunito Sans loads, and the text looks the same as before.
2. On `/app/research` and `/app/analytics`, check DevTools › Network › JS: no chunk containing Zod (search the Sources panel for `ZodError`) where none is expected.
3. Check that the labels (platforms, signal types, result fields) and form limits look and behave exactly as before.
4. `curl -w "%{time_starttransfer}\n" -o /dev/null -s http://localhost:3000/api/health` is faster than about 600 ms.
5. Apply the migration (`supabase db push`, or let your normal migration flow run it).
6. After deploying, enable Speed Insights in Vercel › Project › Speed Insights. Data appears after real visits.
