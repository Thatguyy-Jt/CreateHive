# Observability (Sentry, Vercel Analytics, Safe Logging)

Phase 1 (Foundation), item "Observability (Sentry / Vercel Analytics)" in `PHASES.md`.

## Goal

Make failures visible without leaking creator data (AGENTS.md §21). After this:

1. Unexpected server and browser errors are captured in Sentry, with route and error digest but no cookies, headers, request bodies, emails or user ids.
2. The structured log events we already emit (`ai_generation_failed`, `ensure_user_failed` and so on) go through one logger that only accepts a fixed set of safe fields, writes JSON to the console as today, and forwards failures to Sentry.
3. A route error boundary and a global error page replace Next.js's blank default, so a crash shows a recoverable screen with a retry.
4. Vercel Web Analytics measures page views in production.

Everything works with no keys set (local dev, CI, tests): Sentry stays off and the app behaves as it does now. This adds no product feature and no database change.

## Skills Read

- `ai-sdk`: not applicable. I only read how the AI service logs (see below).
- `clerk` and `clerk-nextjs-patterns`: re-read for `proxy.ts` matcher behaviour, because Sentry's optional tunnel route would have to be excluded from it (decision 7).
- No Sentry or Vercel Analytics skill exists in `.agents/skills/`. The SDK facts below come from the current Sentry manual-setup docs and the Vercel Web Analytics quickstart (fetched this session) and from Next.js's bundled docs (`node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`, `03-api-reference/03-file-conventions/instrumentation.md`). I will confirm every Sentry export and option against the installed package's types after install, and stop and report if one differs.

## Existing Code Inspected

- Both `AGENTS.md` files: §18 (predictable failures), §21 (observability, no secrets or unnecessary private data in logs), §22.
- `package.json`: Next 16.4.0, React 19.3.0, pnpm. No `@sentry/nextjs`, no `@vercel/analytics`.
- `next.config.ts`: plain config with `cacheComponents: true`, Turbopack rules, no wrapper.
- `app/layout.tsx`: root layout with `ClerkProvider` inside `<body>`; no analytics, no error files anywhere (`error.tsx`, `global-error.tsx`, `not-found.tsx` do not exist).
- `proxy.ts`: bare `clerkMiddleware()` with a broad matcher.
- Logging sites, all `console.error(JSON.stringify({ event, ... }))`: `lib/services/users.ts`, `lib/services/current-user.ts`, `lib/ai/index.ts`, and the `log()` helper plus one direct call in `lib/ai/run-structured.ts`. The AI service's logs carry only `kind`, `model`, `code`, `latency_ms`, `db_code` or `variables`.
- `lib/ai/errors.ts`: `APICallError` objects carry `requestBodyValues` (the prompt) and `responseBody`. They must never be handed to Sentry.
- Tests: `tests/ai/run-structured.test.ts` asserts logs contain no prompt, user id or key. `tests/services/users.test.ts` spies on `console.error`. Both must keep passing.
- No background jobs, server actions or route handlers exist yet, so there is nothing to instrument there.

## Decisions / Assumptions

1. **Packages.** `@sentry/nextjs` (latest is 11.6.0, peer range covers Next 16) and `@vercel/analytics` (latest 2.0.1). Speed Insights is not added; it is a separate paid-tier product and not in the blueprint.
2. **Off unless configured.** Sentry initialises only when `NEXT_PUBLIC_SENTRY_DSN` is set and the environment is not `test`. A DSN is designed to be public, so the `NEXT_PUBLIC_` prefix is correct. Source-map upload runs only when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are all set; `SENTRY_AUTH_TOKEN` is a secret and is documented in `.env.example` by name only. I will not read or edit `.env.local`; you add the values.
3. **Privacy by configuration.**
   - `sendDefaultPii: false`.
   - Session Replay and the feedback widget are **not** enabled (the Sentry sample enables both; they would record creator content).
   - A shared `beforeSend` removes `request.cookies`, `request.headers`, `request.data`, `request.query_string` and `user` from every event on server, edge and client.
   - We never call `Sentry.setUser`. Events are not tied to a creator.
   - Tracing sample rate 0.1 in production, 1.0 in development, with no custom span data.
4. **One logger.** `lib/observability/log.ts` exports `logEvent(level, event, fields)`.
   - `fields` is typed to an allow-list of scalar keys: `kind`, `model`, `code`, `latency_ms`, `db_code`, `stage`, `name`, `variables` (string array). Anything else is a type error, so prompts, responses, ids and emails cannot be added by accident.
   - It prints the same JSON line as today, so existing log tooling and tests keep working.
   - For `error` level it also calls `Sentry.captureMessage(event, { level, tags: fields })`. It **never** receives or forwards `Error` objects, because provider errors contain prompts.
   - Warnings are logged but not sent to Sentry, to keep volume down.
   - With no DSN the Sentry calls are no-ops, so unit tests need no mocking of the network.
5. **Uncaught errors use Sentry's own capture.** `instrumentation.ts` exports `onRequestError = Sentry.captureRequestError` (Next 15+ hook, confirmed in Next's docs). Those events pass through the same `beforeSend`. Next's own `digest` stays on the event, so a user-visible error id can be matched to Sentry.
6. **Error screens.** `app/app/error.tsx` (route boundary inside the shell, so navigation stays) and `app/global-error.tsx` (replaces the root layout, so it brings its own `<html>`/`<body>` and imports `globals.css`). Both are client components, call `Sentry.captureException(error)` once in an effect, and show: what happened, a **Try again** button (`reset()`), and a link back to the dashboard or homepage. They show the `digest` as a short reference code, never the error message.
7. **No Sentry tunnel route.** `tunnelRoute` would need excluding from the Clerk `proxy.ts` matcher and adds server load. Cost: ad-blockers will drop some browser-side events. Server errors are unaffected. Recorded as a follow-up.
8. **Vercel Analytics** goes in `app/layout.tsx` inside `<body>`: `import { Analytics } from "@vercel/analytics/next"`. It is cookieless, does nothing locally and only reports once Web Analytics is enabled on the Vercel project (a dashboard click I cannot do). The privacy policy item remains open for launch.
9. **Not in scope.** Server-action wrapping (no actions exist), Inngest/job failure logging (no jobs), uptime monitoring, alert rules and dashboards in Sentry (configured in the Sentry UI), and a user-facing status page.
10. **Existing log events are renamed nowhere.** Event names stay stable so nothing downstream breaks.

## Files Likely to Change

| File | Change |
|---|---|
| `package.json`, `pnpm-lock.yaml` | Add `@sentry/nextjs`, `@vercel/analytics` |
| `next.config.ts` | Wrap with `withSentryConfig` (import path confirmed from the installed package; the docs show `@sentry/nextjs/config`). `silent: !process.env.CI`. Source-map upload options only when the three env values exist |
| `instrumentation.ts` (new) | `register()` loads the server or edge config by `NEXT_RUNTIME`; exports `onRequestError` |
| `instrumentation-client.ts` (new) | Client `Sentry.init` (no replay, no feedback) and `onRouterTransitionStart` |
| `sentry.server.config.ts`, `sentry.edge.config.ts` (new) | Server and edge `Sentry.init` |
| `lib/observability/sentry-options.ts` (new) | Shared options: DSN gate, sample rates, `sendDefaultPii: false`, `scrubEvent` used as `beforeSend` |
| `lib/observability/log.ts` (new) | `logEvent` with the field allow-list |
| `lib/ai/run-structured.ts`, `lib/ai/index.ts`, `lib/services/users.ts`, `lib/services/current-user.ts` | Replace direct `console.error/warn` with `logEvent` (same event names and fields) |
| `app/app/error.tsx`, `app/global-error.tsx` (new) | Error boundaries described in decision 6 |
| `app/layout.tsx` | Add `<Analytics />` |
| `.env.example` | Add `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (names only) |
| `tests/observability/*.test.ts` (new) | See Checks |
| `PHASES.md` | Tick the observability item |

## Database Changes

None.

## Implementation Requirements

1. **Install** both packages with pnpm. Check `node_modules/@sentry/nextjs` types for `withSentryConfig`, `captureRequestError`, `captureRouterTransitionStart`, `captureException` and `captureMessage` before using them.
2. **`sentry-options.ts`** exports:
   - `sentryEnabled(env)`: true only with a non-empty DSN and `NODE_ENV !== "test"`.
   - `baseSentryOptions()`: `{ dsn, enabled, sendDefaultPii: false, tracesSampleRate, beforeSend: scrubEvent }`.
   - `scrubEvent(event)`: returns the event with the fields in decision 3 removed. Pure function so it can be unit tested.
3. **Init files** read the DSN from `process.env.NEXT_PUBLIC_SENTRY_DSN` and spread `baseSentryOptions()`. The client file adds only `onRouterTransitionStart`.
4. **`logEvent`** signature: `logEvent(level: "error" | "warn", event: string, fields?: SafeLogFields)`. `error` goes to `console.error` and Sentry; `warn` goes to `console.warn` only. Unknown keys fail typecheck.
5. **Replace logging call sites** one for one. The `variables` field stays a list of variable names, never values.
6. **Error boundaries** follow the design tokens already in `app/globals.css` (see UI below).
7. **Fail-soft:** if Sentry throws, the logger must not (wrap the capture call in try/catch). A broken monitoring tool must never take down a request.
8. **Analytics** renders nothing visible and adds no client state of ours.

## AI Behavior

No change in model behaviour, prompts or limits. The only change is where the AI service's existing failure logs go: through `logEvent`, so `ai_generation_failed`, `ai_limit_check_failed` and the others become Sentry messages tagged with `kind`, `model` and `code`. This is how AGENTS.md §21's "AI failures" monitoring is met. No prompt, response or provider error object is sent (decision 4).

## Security Requirements

- `NEXT_PUBLIC_SENTRY_DSN` is public by design. `SENTRY_AUTH_TOKEN` is read only by the build and never reaches client code or `.env.example` with a value.
- No cookies, headers, bodies, query strings, emails or user ids in Sentry events (decision 3), enforced by `scrubEvent` and tested.
- The logger's typed allow-list prevents adding private creator data to logs.
- Error screens show a digest reference only, never an error message or stack.
- Analytics is cookieless and sends no custom event data.

## Acceptance Criteria

1. With no Sentry variables set, `pnpm dev`, `pnpm test` and `pnpm build` behave as before and print no Sentry errors.
2. With a DSN set, a thrown error in a Server Component appears in Sentry with the route and a `digest`, and with no cookies, headers, request body or user.
3. A browser-side error appears in Sentry with no replay and no feedback widget on the page.
4. A failed AI call (for example a forced `provider_error`) appears in Sentry as a message tagged with `kind`, `model` and `code`, containing no prompt text.
5. Passing an extra key (for example `userId`) to `logEvent` fails typecheck.
6. A crash inside `/app/...` shows the in-shell error screen with **Try again**; a crash in the root layout shows the global error screen. Neither shows the error message.
7. `<Analytics />` is present in the root layout and the page still renders when its script is blocked.
8. All existing tests still pass, including the "logs contain no prompt, user id or key" test.

## Checks

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build   # required: next.config and instrumentation changed
```

New automated tests (offline):
- `tests/observability/scrub-event.test.ts`: cookies, headers, body, query string and user are removed; other fields kept.
- `tests/observability/log.test.ts`: prints one JSON line per call; `error` forwards to a mocked Sentry capture with tags only; `warn` does not; a throwing Sentry capture does not throw; output never contains a value passed outside the allow-list (type-level check plus a runtime check that unknown keys at runtime are dropped).
- `tests/observability/sentry-options.test.ts`: disabled without a DSN or in `test`; sample rates; `sendDefaultPii` is false.
- Existing AI and users tests keep passing unchanged.

## Manual Test Procedure

1. Create a Sentry project (platform Next.js) and copy its DSN. Put `NEXT_PUBLIC_SENTRY_DSN=...` in `.env.local` yourself. Leave the other three variables empty for now.
2. Run `pnpm dev`. Temporarily add `throw new Error("sentry server test")` at the top of the `Greeting` function in `app/app/page.tsx`, and open `/app` signed in. You should see the in-shell error screen with a reference code. In Sentry, an issue appears with a request path and no cookies or headers. **Revert the change.**
3. Repeat with a client component that throws in an effect or a click handler. Open the issue and confirm there is no Replay tab and no user.
4. `app/global-error.tsx` only appears when the root layout itself crashes, which can't be triggered safely by hand. Confirm it compiles in `pnpm build`, and optionally throw temporarily inside `app/layout.tsx` in dev to see it, then revert.
5. Remove `NEXT_PUBLIC_SENTRY_DSN`, restart, trigger the same error: the screen still works and nothing reaches Sentry.
6. After deploying to Vercel, enable **Analytics** for the project in the Vercel dashboard, visit a few pages, and confirm views appear (this can take a few minutes).
7. Optional source maps: set `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` in the Vercel project (not `.env.example`), deploy, and confirm stack traces show source files.

## UI

Only the two error screens.

- **Visual interpretation:** calm and honest, matching the app's flat, outlined style. No illustration. One clear message, one primary action.
- **Layout:** `app/app/error.tsx` renders inside the shell's `<main>`: a single `.card` capped at `max-w-xl`, left-aligned, with `stack-sm` spacing. `global-error.tsx` is a full-height centred column on the page background (it cannot use the shell).
- **Typography:** `h1` for "Something went wrong" using the existing heading styles; `text-muted-foreground` for the explanation; reference code in `font-mono` at small size.
- **Copy (final wording):** heading "Something went wrong"; body "We've been notified and are looking into it. Your work is saved. Try again, and if it keeps happening, mention this code when you contact us."; code line "Reference: <digest>" only when a digest exists.
- **Actions:** `Try again` (`.btn .btn-primary`, calls `reset()`) and a secondary link (`.btn .btn-secondary`) to `/app` or `/`. Minimum 44px touch height, as the existing nav does.
- **Responsive:** single column at every width; buttons stack below 480px and sit in a row above it.
- **States:** there is no loading state; the screen is static. There is no empty state.
- **Dark mode:** uses semantic tokens only, so it follows the OS theme like the rest of the app. `global-error.tsx` imports `app/globals.css` itself because it replaces the root layout.
- **Accessibility:** the heading receives focus on mount so screen readers announce the error; the buttons are real buttons and links.

## Known Limitations / Follow-ups

- Sentry alert rules, release tracking and dashboards are set up in the Sentry UI, not in code.
- No tunnel route, so ad-blockers drop some browser events (decision 7).
- Server actions and background jobs will each need their own wrapper when they exist (Phase 2 and Phase 7).
- `console.error/warn` remain the log sink for non-error levels; there is no log drain.
- The privacy policy must disclose Sentry and Vercel Analytics before public launch.
- Sentry's browser SDK adds client bundle weight; I will report the size change from `pnpm build`.
