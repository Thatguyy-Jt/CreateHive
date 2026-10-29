# Testing

## Unit and database tests (Vitest)

```bash
pnpm test
```

This covers services, schemas, AI output validation, billing, and every migration against an in-memory Postgres (PGlite) with RLS. It needs no network or accounts. `pnpm test:live` runs the one opt-in test that calls the real AI provider.

## Browser smoke tests (Playwright)

`e2e/` drives the real app in Chromium against your Clerk **development** instance and your Supabase project. It covers:

- **Public pages (desktop and phone width):** the homepage and pricing render, `/app` redirects to sign-in, `/api/health` answers, and `/api/cron/daily` refuses calls without its token.
- **Signed in as the test creator:**
  - Every app page loads without the error screen, before onboarding.
  - Onboarding validates fields, saves both steps and lands on Strategy.
  - Settings downloads the data export and gates account deletion. The account is never actually deleted.

### One-time setup

1. In the Clerk dashboard, using the **development** instance, go to Users › Create user. Give it an email such as `you+e2e_clerk_test@yourdomain.com`. No password is needed.
2. Add it to `.env.local`:
   ```
   E2E_CLERK_USER_EMAIL=you+e2e_clerk_test@yourdomain.com
   ```
3. Install the browser: `pnpm test:e2e:install`.

### Running

```bash
pnpm test:e2e                     # starts its own dev server on :3100
pnpm exec playwright show-report  # HTML report of the last run
```

Without `E2E_CLERK_USER_EMAIL`, only the public specs run and the rest show as skipped.

**Stop your own `pnpm dev` first.** Next.js allows only one dev server per project folder, so the suite's server on :3100 won't start while yours runs ("Another next dev server is already running").

### What it does to your data

- **The test creator's data is deleted at the start of every run,** so each run starts fresh. The Clerk user is kept. No other creator is touched.
- **AI is off for the test server** (`AI_ENABLED=false`), so no OpenAI or YouTube calls are made. AI features show their "paused" message, and that path is tested.
- **No Paystack checkout is ever started.**

### Safety guards

Global setup (`e2e/global-setup.ts`) stops the run when:

- `CLERK_SECRET_KEY` is a production key (`sk_live_`)
- `E2E_CLERK_USER_EMAIL` doesn't match exactly one Clerk user
- the test creator has a Paystack subscription (cancel it first)

### Not covered yet

- CI: running in CI would need Clerk and Supabase secrets in GitHub, ideally with a separate test Supabase project.
- Paystack checkout, AI generation and YouTube refresh. Vitest covers their logic with fakes.
