# Playwright smoke tests (Phase 7, part 4)

## Goal

Add a small, dependable **browser test suite** that proves the critical flows work end to end in a real browser, against the real app, Clerk and Supabase. Today all 1,350 tests are Vitest unit and DB tests. Nothing checks that pages actually render, that auth redirects work, or that onboarding saves through the UI.

It's a **smoke suite**, not full coverage: a few minutes to run, no flaky AI calls, no money spent, and nothing touched except one dedicated test creator's data.

## Skills Read

None apply. No skill covers Playwright, and no UI is changed.

## Existing Code Inspected

- `package.json`: Vitest only, with `test` / `test:live` scripts. Node v24.21 (`process.loadEnvFile` available).
- `vitest.config.mts`: `include: ["tests/**/*.test.ts"]`, so Playwright specs must live elsewhere and use another suffix.
- No `.github/` folder, so there's no CI.
- `proxy.ts` (Clerk middleware), `app/app/layout.tsx` (`auth.protect()`, `ensureCurrentUser`), `app/sign-in/[[...sign-in]]/page.tsx` (Clerk `<SignIn />`).
- `app/onboarding/actions.ts`: `saveVoiceAction` generates the strategy and redirects to `/app/strategy?error=<code>` on failure. With `AI_ENABLED=false` the code is `disabled` (`AI_ERRORS.disabled`). That makes the full onboarding flow testable for free.
- `components/onboarding/onboarding-form.tsx`:
  - Step 1 fields: niche, audience, goal chips, platform chips, posts per week, experience select, then **Continue**.
  - Step 2 fields: tone, voice traits, do and don't lists, sample text, then submit.
- `components/strategy/strategy-content.tsx` (reads `?error=`), `components/strategy/finish-setup-card.tsx` (the `/app` card linking to `/onboarding`).
- Settings › Your data and the delete control from part 1. Export at `/app/settings/export`.
- `/api/health` and `/api/cron/daily` from parts 2–3. `/pricing` (₦12,000).
- `lib/services/account-data.ts` (`deleteCreatorData`), `lib/supabase/admin.ts`.
- `.gitignore`: `.env*` with `!.env.example` (so `.env.example` **is** committed).
- `@clerk/testing@2.2.50` (peer `@playwright/test ^1`) and `@playwright/test@1.64.1` are current.

## Decisions / Assumptions

1. **Tooling.** `@playwright/test` and `@clerk/testing` are dev dependencies. Only Chromium is installed (`pnpm test:e2e:install` → `playwright install chromium`).
2. **Location.** Specs go in `e2e/*.spec.ts`, config in `playwright.config.ts`. Vitest never picks them up, and `pnpm test` is unchanged.
3. **The app under test** is a dedicated `next dev` started by Playwright's `webServer` on **port 3100**, with `reuseExistingServer: false`. Its env is `AI_ENABLED=false` plus `.env.local` (loaded by Next as usual). `AI_ENABLED=false` means no OpenAI calls and no cost: AI features show their "paused" message, which is a real recovery path worth covering. Because the server is never reused, your own `pnpm dev` (with AI on) isn't reused by accident. YouTube refresh and Paystack checkout are never clicked.
4. **Sign-in uses Clerk's testing helpers.** `clerkSetup()` runs in global setup to get a testing token that bypasses bot protection. `clerk.signIn({ page, emailAddress })` signs the test user in through a backend sign-in token, so there's no password, no OTP and no UI clicking. This needs `CLERK_SECRET_KEY` (already in `.env.local`).
5. **One dedicated test creator.** You create it once in the **Clerk development instance**, for example `e2e+clerk_test@<your-domain>`, and put the address in `.env.local` as `E2E_CLERK_USER_EMAIL`. **Global setup wipes that creator's data before every run:** it looks up the Clerk user id by email and calls `deleteCreatorData` (service role, cascading). The Clerk user itself is kept. Every run starts from a fresh creator, and no other creator's data is touched.
6. **Safety guards** in global setup. It refuses to run, failing loudly, when:
   - `CLERK_SECRET_KEY` starts with `sk_live_` (a production Clerk instance), or
   - the email resolves to anything other than exactly one Clerk user.

   When `E2E_CLERK_USER_EMAIL` is unset, the signed-in specs are **skipped** with a clear reason and the public specs still run.
7. **Signed-in specs run serially, with one worker.** They share one creator, and onboarding has to happen before settings. Public specs are stateless.
8. **Projects:**
   - `chromium-desktop`: all specs.
   - `chromium-mobile` (Pixel 7 viewport): the public specs only, to cover the marketing pages and auth redirect at phone width.
9. **The specs** (selectors use roles, labels and visible text, never CSS classes):
   - **`e2e/public.spec.ts`**
     - `/` renders a level-1 heading and a sign-up link.
     - `/pricing` shows Free and Pro and "₦12,000".
     - `/app` while signed out ends up on `/sign-in`.
     - `GET /api/health` returns 200 with `status` of `ok` or `degraded`.
     - `GET /api/cron/daily` without a token returns 401 (or 503 if `CRON_SECRET` is unset; both mean refused).
   - **`e2e/onboarding.spec.ts`** (signed in, fresh creator):
     1. `/app` shows the finish-setup card. Follow it to `/onboarding`.
     2. Submit step 1 empty: field errors appear and the page stays on step 1.
     3. Fill step 1 and **Continue**: step 2 ("How do you sound?") appears.
     4. Fill step 2 and submit: the browser lands on `/app/strategy` with the AI-paused message (`AI_ERRORS.disabled`). The page doesn't crash.
     5. Reload `/onboarding`: the step-1 values are still there.
   - **`e2e/settings.spec.ts`** (signed in, after onboarding):
     - Settings › General shows **Your data**.
     - **Download my data** downloads `createhive-data-*.json`, which parses with `format_version: 1`, one `creator_profiles` row with the niche used in onboarding, and no `user_id` anywhere.
     - **Delete account…** opens the panel with **Keep my account** focused. **Delete my account** is disabled with `delete` typed and enabled with `DELETE`. **Keep my account** closes the panel. The account is **never** actually deleted, so the suite can rerun.
   - **`e2e/navigation.spec.ts`** (signed in): each main nav destination loads without the error screen ("Something went wrong") and shows its page heading. Destinations: Dashboard, Strategy, Opportunities, Calendar, Studio, Analytics, Insights, Research, Settings.
10. **No CI workflow in this part.** It would need Clerk and Supabase secrets in GitHub. The suite is run locally with `pnpm test:e2e`. A follow-up can add a GitHub Action once a separate test Supabase project exists.
11. **Artifacts.** A trace is recorded on the first retry and a screenshot only on failure. `retries: 1`, to absorb dev-server first-compile slowness. `test-results/`, `playwright-report/` and `playwright/.cache` are gitignored.
12. Out of scope:
    - Paystack checkout, which needs real redirects to Paystack.
    - Anything that calls AI or YouTube.
    - Visual regression snapshots.
    - Running against production.

## Files Likely to Change

| File | Change |
|---|---|
| `package.json` | Dev deps `@playwright/test`, `@clerk/testing`. Scripts `test:e2e` (`playwright test`) and `test:e2e:install` (`playwright install chromium`) |
| `playwright.config.ts` | **New.** `testDir: "e2e"`, the two projects, `webServer` (`pnpm dev --port 3100`, env `AI_ENABLED=false`, 180s timeout), `globalSetup`, `workers: 1`, `retries: 1`, trace and screenshot settings |
| `e2e/global-setup.ts` | **New.** Load `.env.local`, apply the guards, `clerkSetup()`, look up the test user, wipe their data |
| `e2e/fixtures.ts` | **New.** `signedInTest` (skips without `E2E_CLERK_USER_EMAIL`, then `setupClerkTestingToken` and `clerk.signIn`) and shared onboarding values |
| `e2e/public.spec.ts`, `onboarding.spec.ts`, `settings.spec.ts`, `navigation.spec.ts` | **New**, per decision 9 |
| `.gitignore` | `/test-results/`, `/playwright-report/`, `/playwright/.cache/` |
| `eslint.config.mjs` | Only if lint needs the Playwright globals or ignore patterns |
| `docs/testing.md` | **New, short.** One-time setup (create the Clerk test user, set `E2E_CLERK_USER_EMAIL`, install Chromium), how to run, what the suite covers, and the safety guards |
| `PHASES.md` | Check off "Tests (Vitest, Playwright)" and note part 4 |

**Environment** (in `.env.local`, which you add): `E2E_CLERK_USER_EMAIL`. `.env.example` gets `E2E_CLERK_USER_EMAIL=` too. Since `.env.example` is blocked for me, you add that line, along with the outstanding `CLERK_WEBHOOK_SIGNING_SECRET=` and `CRON_SECRET=`.

## Database Changes

None. Global setup deletes only the test creator's rows through the existing `deleteCreatorData` (service role). That creator has no Paystack subscription, so no Paystack call is made.

## Implementation Requirements

- `global-setup.ts`:
  - If `.env.local` exists, load it with `process.loadEnvFile`. Values already in the shell win.
  - Fail fast with a clear message on `sk_live_`.
  - If `E2E_CLERK_USER_EMAIL` is set:
    - `createClerkClient({ secretKey }).users.getUserList({ emailAddress: [email] })` must return exactly one user.
    - Then `deleteCreatorData({ db: createAdminClient(), paystack: null }, userId)` must return `ok`. Otherwise the setup throws.
  - `await clerkSetup()` always runs.
  - `server-only` imports: global setup runs in Node through Playwright's TS loader. If importing `lib/` modules that import `server-only` throws, the setup inlines the equivalent admin delete (`createClient(url, secret).from("users").delete().eq("id", userId)`) rather than changing app code.
- `fixtures.ts`:
  - `signedInTest = test.extend(...)`, which calls `test.skip(!email, "Set E2E_CLERK_USER_EMAIL …")`.
  - Then `await page.goto("/")`, `await clerk.signIn({ page, emailAddress: email })`, `await page.goto("/app")`.
- Onboarding values:
  - niche "home workouts for busy parents", a 2-sentence audience, 1 goal, 1 platform, 3 posts a week, the first experience option
  - tone and traits by their visible labels
  - a short sample text
- Assertions use web-first `expect(...).toBeVisible()` / `toHaveURL()`. No fixed sleeps.
- Timeouts: the test timeout is 60s, because dev compiles on first visit. The `expect` timeout is 10s.

## AI Behavior

None changes. The suite runs with `AI_ENABLED=false`, so no AI provider is called. That exercises the "paused" recovery path.

## Security Requirements

- Tests only ever sign in as the one dedicated Clerk **development** user. `sk_live_` keys are refused.
- Data deletion is scoped by that user's verified Clerk id. Nothing reads the browser for ids.
- No secrets are written to test artifacts. Traces aren't uploaded anywhere, and the report is local.
- `E2E_CLERK_USER_EMAIL` is not secret, but it lives in `.env.local` with the rest.

## Acceptance Criteria

1. `pnpm test:e2e:install && pnpm test:e2e` runs green locally with `E2E_CLERK_USER_EMAIL` set. Without it, only the public specs run and the rest show as skipped with the reason.
2. Running it twice in a row passes both times, since each run starts from a fresh creator.
3. No OpenAI or YouTube requests are made, and no Paystack checkout is started.
4. `pnpm test` (Vitest) is unchanged and doesn't pick up `e2e/`.
5. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e:install
pnpm test:e2e
```

If I can't run the signed-in specs because `E2E_CLERK_USER_EMAIL` isn't set yet, I'll run the public specs, report that the signed-in ones were skipped, and leave the full run to you.

## Manual Test Procedure

1. In the Clerk dashboard (**development** instance) › Users › Create user, use an email like `you+e2e_clerk_test@yourdomain.com`. No password is needed.
2. Add `E2E_CLERK_USER_EMAIL=<that email>` to `.env.local`.
3. Run `pnpm test:e2e:install` once, then `pnpm test:e2e`. It should be all green, with the two projects listed.
4. Run `pnpm test:e2e` again: still green.
5. Run `pnpm exec playwright show-report` and look through the HTML report.
6. Remove `E2E_CLERK_USER_EMAIL` and run again: the public specs pass, and the signed-in specs show as skipped with the reason.
