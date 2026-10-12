# App Shell and Clerk Authentication

Phase 1 (Foundation), items 1 and 2 in `PHASES.md`: "App shell" and "Authentication (Clerk)".

## Goal

Add Clerk sign-in and sign-up, and a protected `/app` route group with a navigation shell. After this, a visitor can create an account, sign in, land on `/app`, see who they are, and sign out. A signed-out visitor cannot reach `/app`.

This builds only the container that later phases fill in. It adds no creator features, no database and no webhooks.

## Skills Read

- `clerk` (router and SDK version table)
- `clerk-setup` (install steps, critical rules, existing-project guidance)
- `clerk-nextjs-patterns` and its `references/middleware-strategies.md` (`proxy.ts`, `auth.protect()` in each resource)
- `clerk-custom-ui` (appearance and theming)

`clerk-webhooks`, `clerk-orgs`, `clerk-billing` and the Supabase skills were not used. Their topics are out of scope here.

## Existing Code Inspected

- `AGENTS.md` (both copies): workflow, §11 auth rules, §14 "no fake UI", §15 route map.
- `package.json`: Next 16.4.0, React 19.3.0, Tailwind 4, pnpm. No Clerk, no Vitest, no Playwright. Scripts include `typecheck`.
- `app/layout.tsx`: root layout with Manrope, Instrument Serif and Geist Mono. It has no provider. It uses the global `LayoutProps<"/">` type.
- `app/page.tsx`: the marketing homepage, composed from `components/marketing/*`.
- `components/marketing/site-header.tsx` and `early-access-button.tsx`: the header shows a disabled "Early access / Coming soon" button. A code comment says it is disabled because sign-up does not exist yet.
- `app/globals.css`: the design system. It has semantic tokens, dark mode through `prefers-color-scheme`, and `.btn`, `.card` and `.container-*` primitives. There is no `components.json`, so shadcn/ui is not installed.
- `node_modules/next/dist/docs/.../file-conventions/proxy.md` exists, confirming that Next 16 uses `proxy.ts` and not `middleware.ts`.
- No `proxy.ts`, no `app/(app)` group, no `/sign-in` or `/sign-up` routes exist.
- `.env.local` exists. Per the `clerk-setup` skill I did not read it, so I do not know whether it already holds Clerk keys.

## Decisions / Assumptions

1. **Install manually, do not run `clerk init`.** `init` rewrites layout and middleware files and, signed out, can provision a new temporary Clerk application and replace keys. Instead I will `pnpm add @clerk/nextjs` and add the pieces from the Next.js quickstart by hand. This keeps the existing layout and design system intact.
2. **Keys come from you.** I will not create a Clerk application. Before manual testing you must put `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `.env.local`, or tell me to run `npx clerk@latest init`/`env pull` (this needs your approval). I will not read or edit `.env.local`. I will add a `.env.example` with variable names only.
3. **Current SDK (`@clerk/nextjs` v7+).** `ClerkProvider` goes inside `<body>`, `auth()` is awaited, and the `<Show>` component is used.
4. **`proxy.ts` is bare `clerkMiddleware()`** with the standard matcher including `/(api|trpc)(.*)`. No `createRouteMatcher` (deprecated per the skill).
5. **Protection happens in each resource.** The `/app` layout and every page under it call `await auth.protect()`. A layout check is an addition, never a substitute, so each page keeps its own check.
6. **Hosted components, not custom flows.** `<SignIn />` and `<SignUp />` on catch-all routes at `/sign-in/[[...sign-in]]` and `/sign-up/[[...sign-up]]`. Custom hook-based flows are out of scope.
7. **Redirects.** Set `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`, and the fallback redirect URLs after sign-in and sign-up to `/app`. These are non-secret and are documented in `.env.example`. Onboarding (`/onboarding`) does not exist yet, so new users go to `/app`.
8. **Theming.** Without shadcn, I will not use the shadcn theme. I will pass `appearance.variables` mapped to the existing palette (primary ink/mint, border radius, font family) and keep Clerk's default light/dark `color-scheme` behaviour. No new dependency such as `@clerk/ui` is added.
9. **Shell navigation shows only what exists.** Entries for routes that do not exist yet (Strategy, Opportunities, Calendar, Studio, Analytics and so on) are listed as visibly disabled with a "Soon" label, matching the existing `Coming soon` pattern, with no links. This follows AGENTS.md §14 and also shows the product map.
10. **Settings is a separate Phase 1 item.** The nav lists Settings as "Soon". It is not built here.
11. **Homepage CTA becomes real.** Sign-up now exists, so the disabled `EarlyAccessButton` is replaced in the header and the final CTA by "Sign in" and "Get started" links, shown through `<Show when="signed-out">`. Signed-in visitors see an "Open app" link plus `UserButton`. Any other place that renders the disabled button is updated the same way.
12. **No user table sync.** The Clerk `userId` is the identity for now. Syncing to Supabase `users` belongs with the database and webhook work.
13. **Tests.** Vitest and Playwright are not installed and adding them is outside this scope. Verification is `pnpm typecheck`, `pnpm lint`, `pnpm build` and the manual procedure. I will not claim automated auth tests exist.

## Files Likely to Change

| File | Change |
|---|---|
| `package.json`, `pnpm-lock.yaml` | Add `@clerk/nextjs` |
| `proxy.ts` (new) | Bare `clerkMiddleware()` and matcher |
| `app/layout.tsx` | Wrap `{children}` with `<ClerkProvider>` inside `<body>`, with the appearance mapping |
| `app/sign-in/[[...sign-in]]/page.tsx` (new) | Centered `<SignIn />` |
| `app/sign-up/[[...sign-up]]/page.tsx` (new) | Centered `<SignUp />` |
| `components/auth/auth-card-layout.tsx` (new, only if needed) | Shared centered layout for the two auth pages |
| `app/app/layout.tsx` (new) | Shell: calls `auth.protect()`, renders sidebar, top bar and content area |
| `app/app/page.tsx` (new) | Dashboard placeholder with its own `auth.protect()` |
| `components/app-shell/sidebar-nav.tsx` (new) | Nav list: Dashboard (live) and disabled "Soon" items |
| `components/app-shell/app-header.tsx` (new) | Top bar: logo, mobile nav trigger, `UserButton` |
| `lib/app-shell/nav-items.ts` (new) | Typed nav definition |
| `components/marketing/site-header.tsx`, `early-access-button.tsx`, `final-cta.tsx` | Replace the disabled CTA with auth-aware links |
| `.env.example` (new) | Variable names only |
| `app/globals.css` | Only small shell-layout classes, if Tailwind utilities are not enough |
| `PHASES.md` | Tick "App shell" and "Authentication (Clerk)" after verification |

The `/app` route group is a real path segment. The project needs a URL of `/app`, so the folder is `app/app/`, not a parenthesized group. This is confirmed against the Next 16 docs before writing.

## Database Changes

None.

## Implementation Requirements

**Auth**
- `proxy.ts` is `export default clerkMiddleware()` plus the matcher from the skill.
- `/sign-in` and `/sign-up` render the hosted components with the design-system background. Signed-in users who visit them are sent to `/app` by Clerk's redirect settings.
- `/app` and any route beneath it require a session. A signed-out request goes to `/sign-in`.
- A sign-out sends the user to `/`.

**Shell (`/app`)**
- Desktop (≥ 64rem): fixed left sidebar with logo, nav, and the `UserButton` at the bottom or top bar. Content area to the right in `container-wide`.
- Mobile: top bar with the logo, a `<details>`-based menu button (same pattern as the marketing header, no new JS) containing the nav, and `UserButton`.
- The Dashboard item is a real link with `aria-current="page"` when active. Active-state detection needs the pathname, so only the nav list is a small client component; the layout stays a Server Component.
- Disabled items are `aria-disabled`, not focusable links, with a "Soon" pill.
- `/app` page: an `h1` ("Dashboard"), the signed-in user's first name or email, and one honest card saying the dashboard fills in as features ship. No fake data and no actions that do nothing.
- The skip link and `<main id="main">` follow the pattern of the marketing page.

**Visual spec**
- Typography: existing `h1`/`h2` scale and Manrope. Nav items are `text-sm font-semibold`.
- Spacing: nav items have a 44px minimum height; sidebar width 16rem; content padding follows `container-wide`.
- Colors: only semantic tokens (`bg-surface`, `border-border`, `text-muted-foreground`). The active item uses `bg-surface-muted` with a visible border or marker, so it does not rely on color alone.
- Dark mode: follows `prefers-color-scheme` like the rest of the app. Clerk appearance variables must read correctly in both themes.
- Loading: Clerk's components render their own skeleton. The `/app` page is static after the auth check, so there is no extra spinner.
- Empty state: the dashboard card above.
- Error state: a missing or invalid publishable key must fail with Clerk's clear dev error, not a blank page. A global error for failed sign-in is handled by Clerk's components.
- Mobile: no horizontal scroll at 375px; tap targets ≥ 44px.

## AI Behavior

None.

## Security Requirements

- `CLERK_SECRET_KEY` is read only on the server and is never imported in a client component. Only `NEXT_PUBLIC_*` values are public.
- `.env.local` is not read, printed, committed or modified. `.env.example` has names with empty values.
- Every page under `/app` and its layout call `await auth.protect()`. The proxy does not decide access.
- The user identity comes only from `auth()` on the server. No user ID is accepted from the browser.
- No webhook endpoints are added, so there is no unauthenticated route beyond `/`, `/sign-in`, `/sign-up` and `/design-system`.
- Confirm `.gitignore` excludes `.env*` (except `.env.example`) before adding the example file.

## Acceptance Criteria

- `@clerk/nextjs` is installed, and `proxy.ts` exists with a bare `clerkMiddleware()`.
- A new user can sign up at `/sign-up`, ends up on `/app`, and sees their name or email and the `UserButton`.
- A signed-out request to `/app` redirects to `/sign-in`, and no protected content is in the response.
- Signing out from `UserButton` returns to `/`.
- The homepage header shows Sign in and Get started when signed out, and Open app and `UserButton` when signed in. No disabled "Coming soon" auth buttons remain.
- The shell works at 375px, 768px and 1280px, and in light and dark mode.
- Nav items for unbuilt routes are visibly disabled and cannot be activated.
- `CLERK_SECRET_KEY` does not appear in any client bundle or in the git diff.
- No unrelated files change.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm build
```

`pnpm build` is required, since routes, configuration and server modules change. The Clerk keys must be present for the build to pass. If they are not, I will report that and not call the build passed.

There are no automated tests in this change (see Decision 13).

## Manual Test Procedure

1. Put your Clerk dev keys in `.env.local` (see `.env.example`) and run `pnpm dev`.
2. Open http://localhost:3000 signed out. Confirm the header shows Sign in and Get started.
3. Open http://localhost:3000/app in a private window. Confirm you are redirected to `/sign-in`.
4. Click Get started and create an account. Confirm you land on `/app`, see the shell and your name or email, and see the avatar in the top bar.
5. Reload `/app`. Confirm you stay signed in.
6. Open `/sign-in` while signed in. Confirm you are redirected to `/app`.
7. Click the disabled nav items. Confirm nothing happens, they cannot be tabbed to, and they are labelled "Soon".
8. Use `UserButton` → Sign out. Confirm you return to `/` and `/app` is protected again.
9. Narrow the window to 375px. Confirm the sidebar becomes the top-bar menu, nothing scrolls horizontally, and the menu opens and closes.
10. Switch the OS to dark mode. Confirm the shell and Clerk forms are readable.
11. Search the built output (`.next/static`) for the secret key's prefix. Confirm there are no matches.
12. Run `pnpm typecheck`, `pnpm lint` and `pnpm build`.
