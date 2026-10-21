# App UI Remodel (logged-in experience)

## Goal

Give the logged-in app (`/app/**`, plus the post-sign-up `/onboarding` canvas) a modern product-dashboard look, inspired by the references the owner shared (Buffer's Insights and Metricool's Analytics/Reporting), while **changing no product logic**. The app should feel like a calm, crisp creator tool:

- an icon-led sidebar with grouped navigation, a quick-create button and the account at the bottom
- a consistent page header (icon tile + title + description) on every page
- soft, rounded "panels" on a slightly tinted canvas instead of the marketing-style "sticker" cards
- KPI-style stat tiles, illustrated empty states and calmer skeletons
- small, purposeful motion, following Emil Kowalski's design-engineering rules

The visual change is made mainly through **app-scoped CSS** on the existing shared classes (`card`, `btn`, `field`, `stack-*`, `text-heading`, …), plus a few new presentational components. Data fetching, server actions, services, schemas, auth and AI stay as they are.

## Skills Read

- `emil-design-eng` (installed at `.claude/skills/emil-design-eng`). Applied rules: animate only with purpose and by frequency (nothing on navigation, which happens tens of times a day), custom ease-out curve, UI motion under 300ms, `:active` press scale of 0.97, never animate from `scale(0)`, transitions over keyframes for UI that can be interrupted, only `transform`/`opacity`, hover gated behind `(hover: hover) and (pointer: fine)`, honour `prefers-reduced-motion`, a short stagger for rare decorative entrances.

## Reference Analysis (studied, not copied)

| Reference | What it does | What we adopt |
|---|---|---|
| Buffer sidebar | Logo plus a filled quick-create "+" at the top; icon + label nav; the active item is a filled rounded pill; a small progress card and the account block at the bottom | Same structure, our tokens. The quick-create goes to Studio. The account block uses Clerk's `UserButton`. **No** fake progress card (we have no "channels") |
| Buffer page header | Icon in a bordered rounded tile, then the title; a toolbar row below with a hairline divider | `PageHeader` component: icon tile, title, description, optional back link and actions slot, divider below |
| Buffer KPI row | A row of equal rounded tiles on a slightly raised band | Restyled `StatTile`: muted panel, small label, large figure |
| Buffer empty state | A large panel with a faint grid, floating emoji/icon tiles, centred title, one line of copy and a single primary action | `EmptyHero` component for the top-level empty states that already exist |
| Buffer metrics panel | A large rounded panel with a section title and the chart inside | Platform cards on Analytics become panels with the stat row and chart inside (already the structure; styling only) |
| Metricool cards | Feature cards: heading, short description, circular icon badge top-right, one clear action | Dashboard secondary cards get a section header row with a small circular icon badge |
| Metricool palette | Light canvas, white panels, one loud accent used sparingly | Light theme: tinted canvas with white panels; mint accent only on primary actions and active states |

**Deliberately not copied:** brand colours, logos, copy, emoji artwork, and any control we can't back with real functionality: date-range tabs, channel/tag filters, export, "connect a channel", the sidebar collapse toggle, reports/Looker integrations (AGENTS.md §14 and §25: no UI that implies features we don't have).

## Existing Code Inspected

- `app/layout.tsx`: root layout, fonts (Manrope / Instrument Serif / Geist Mono), `ClerkProvider` with token-based `appearance`, `<body class="min-h-full flex flex-col">`.
- `app/app/layout.tsx`: the `/app` shell. A `RequireSession` (`auth.protect()` + `ensureCurrentUser`) sits behind `<Suspense>` because of Cache Components. Also a skip link, a `hidden lg:block` 16rem aside with `Logo` + `SidebarNav`, `AppHeader`, `<main id="main" class="container-wide …">` and `Toaster`.
- `components/app-shell/app-header.tsx`: sticky `site-header`. Mobile logo, `<details>` menu with `SidebarNav`, and `UserButton` (shown on every breakpoint).
- `components/app-shell/sidebar-nav.tsx`: client component. `usePathname` sits behind Suspense (the fallback renders with no active item), and the "soon" item variant is kept.
- `lib/app-shell/nav-items.ts`: 9 live items with typed hrefs.
- All `/app` pages: `page.tsx` for dashboard, strategy, opportunities, research, calendar, studio, `studio/[id]`, analytics, `analytics/[id]`, insights and settings. Each renders a static `<div class="stack-sm"><h1>…</h1><p class="lead">…</p><p class="field-help">…</p></div>` plus Suspense-wrapped content with card skeletons. `app/app/error.tsx` uses `components/errors/error-screen.tsx`.
- Dashboard: `components/dashboard/{today-card,next-idea-card,idea-summary,performance-card,learned-card,ai-usage-line}.tsx`, `components/strategy/dashboard-strategy-card.tsx`. Every card is a self-contained async server component that does its own auth and data loading and has its own error and empty copy.
- Analytics: `components/analytics/analytics-content.tsx` (`PlatformCard` with `StatTile`s + `ColumnChart`, `NeedsResults`, `PostRow`, empty state, "Log a past post" `<details>`), `components/analytics/comparison.tsx` (`ComparisonPill`), `components/charts/*` (SVG charts, colours from `--chart-accent`/`--chart-muted`).
- `components/settings/section-skeleton.tsx`: shared skeleton bars.
- `app/globals.css`: raw ramps (`@theme static`), semantic tokens on `:root` with a `prefers-color-scheme: dark` override, `@theme inline` mapping, a type scale as `@theme` variables (`--text-heading`, `--text-display-*`, `--text-lead`), and component classes `.btn*`, `.card`, `.card-offset`, `.field*`, `.input/.textarea/.select`, `.chip`, `.alert`, `.site-header`, `.skip-link`, `.disclosure`, plus the Sonner overrides. `.card` is used about 143 times, `stack-sm` about 191, `btn-*` about 170 and `card-offset` 17.
- `app/onboarding/layout.tsx`: focused layout outside the shell (logo + narrow main).
- `package.json`: Next 16.4, React 19.3, Tailwind 4, Sonner, Clerk 7. **No icon library**, no motion library, no shadcn.
- `tests/`: services, db/RLS, schemas, AI, analytics/calendar helpers. **No component or markup tests**, so no test depends on class names.

## Decisions / Assumptions

1. **Light + dark stays.** The app keeps following `prefers-color-scheme`. Both themes get the new canvas/panel treatment (owner's choice).
2. **Scope: the shell plus every `/app` page** (owner's choice), through app-scoped CSS. Dashboard and Analytics get the largest layout changes. The other pages get the shell, `PageHeader`, the panel styling and, where they already have one, an `EmptyHero` for their top-level empty state.
3. **App-scoped, not global.** New styles live under a `.app-shell` class (and a lighter `.app-canvas` for onboarding). The marketing site, sign-in/up pages and `/design-system` look exactly the same as before.
4. **No logic changes.** No edits to `lib/**` (except `lib/app-shell/nav-items.ts`), `app/**/actions.ts`, services, schemas, migrations, AI prompts or Clerk/Supabase setup. Component edits are limited to markup and class changes. Every `id`, `aria-*`, `name`, form field, `key`, Suspense boundary, `auth.protect()` call, `connection()` call, error branch and user-facing message stays as it is (the only copy change is the dashboard greeting, below).
5. **No new dependencies.** Icons are a small local set of inline SVGs (24px grid, 1.75 stroke, `currentColor`, `aria-hidden`). Motion is CSS only.
6. **Quick-create links to `/app/studio`.** It is a real route where creators start a package. It is a link, not a new action.
7. **Account block:** `UserButton` moves into the sidebar footer on desktop and stays in the mobile top bar. If Clerk 7's `UserButton` supports `showName`, the name is shown next to the avatar; if not, it falls back to the avatar only. No extra data fetch.
8. **No sidebar collapse, no AI-usage meter in the sidebar** in this pass. Both would need new state or new data placement, which is out of scope.
9. **Page width:** the dashboard uses a two-column grid on `xl` and wider. Analytics widens to `max-w-5xl`. Other pages keep their current max widths.
10. **Copy change, dashboard greeting only:** "Signed in as {name}." becomes "Welcome back, {name}." ("Welcome back." when there is no name). Same data source (`currentUser()`).

## Files Likely to Change

| File | Change |
|---|---|
| `app/globals.css` | New section **11. APP SHELL**: app tokens (light + dark), `.app-shell` scoped overrides for type scale, `.card`, `.card-offset`, `.btn`, inputs, `.chip`; new classes `.app-sidebar`, `.app-nav-*`, `.page-header*`, `.panel-hero`, `.icon-tile`, `.icon-badge`, `.skeleton`; motion tokens `--ease-out`, `--ease-in-out` |
| `app/app/layout.tsx` | New shell structure: canvas wrapper `.app-shell`, sticky full-height sidebar, mobile top bar, `main` padding. Session guard, skip link and Toaster are kept exactly as they are |
| `components/app-shell/sidebar-nav.tsx` | Icon + label items, grouped sections, active pill. Keeps the Suspense/`usePathname` pattern and the "soon" variant. Active state also matches sub-routes (`/app/studio/[id]` → Studio) |
| `components/app-shell/app-header.tsx` | Mobile/tablet only (`lg:hidden`): logo, quick-create, menu button, `UserButton` |
| `components/app-shell/mobile-nav.tsx` (new, client) | The `<details>` menu panel. Closes on route change (it stays open today after client navigation) and on Escape |
| `components/app-shell/sidebar.tsx` (new) | Desktop sidebar: logo + quick-create, `SidebarNav`, footer with `UserButton` |
| `components/app-shell/icons.tsx` (new) | Inline SVG icon set: dashboard, strategy, opportunities, research, calendar, studio, analytics, insights, settings, plus, menu, arrow-left, sparkle, chart, target, search, lightbulb |
| `components/app-shell/page-header.tsx` (new) | `PageHeader({ icon, title, description?, note?, back?, actions? })`, a server component with no data |
| `components/app-shell/empty-hero.tsx` (new) | `EmptyHero({ title, titleId, children, action? })`: grid panel with decorative icon tiles (`aria-hidden`) |
| `lib/app-shell/nav-items.ts` | Add `icon` and `group` ("Plan", "Create", "Measure", plus Settings pinned last) to each item. Hrefs are unchanged |
| `app/app/{page,strategy,opportunities,research,calendar,studio,studio/[id],analytics,analytics/[id],insights,settings}/page.tsx` | Replace the heading block with `PageHeader`, with the **same text**. Skeletons use the new `.skeleton`. Dashboard and Analytics layout changes (below) |
| `components/dashboard/*.tsx`, `components/strategy/dashboard-strategy-card.tsx` | Card header row (title + icon badge). Classes only, same content/branches |
| `components/charts/stat-tile.tsx` | KPI tile styling |
| `components/analytics/analytics-content.tsx` | Empty state → `EmptyHero` (same text, plus a link to the existing "Log a past post" section). Panel spacing. No data changes |
| `components/analytics/comparison.tsx` | `ComparisonPill` gets a tinted background per direction (above = success tint, below = warning tint, about usual = neutral). Arrow and text are unchanged, so colour is never the only signal |
| `components/{studio/studio-list-content,opportunities/opportunities-content,research/research-content,insights/insights-content}.tsx` | Only if they render a top-level "nothing yet" state: wrap it in `EmptyHero` with the same copy and actions |
| `components/settings/section-skeleton.tsx` | Uses `.skeleton` bars |
| `components/errors/error-screen.tsx` | No change. It picks up the panel styling from `.card` inside `.app-shell` |
| `app/onboarding/layout.tsx` | Adds `.app-canvas` (tokens + canvas background only) |
| `tests/app-shell/nav-items.test.ts` (new) | Nav integrity: unique hrefs, every live item has an icon and group, and the groups are in order |

## Database Changes

None.

## Implementation Requirements

### 1. Tokens (`app/globals.css`, section 11)

Defined on `.app-shell, .app-canvas`, redefining the existing semantic tokens locally so every existing component follows automatically:

| Token | Light | Dark |
|---|---|---|
| `--canvas` (page background) | `#f4f6f5` | `#0a1210` |
| `--surface` (panels) | `#ffffff` | `#111c19` |
| `--surface-muted` (tiles, hover, skeleton) | `#eef2f0` | `#182622` |
| `--border` | `#e1e7e4` | `#21322d` |
| `--nav-active-bg` | `#ffffff` | `#1a2a26` |
| `--panel-shadow` | `0 1px 2px rgb(16 32 30 / 0.04), 0 1px 1px rgb(16 32 30 / 0.03)` | `none` |
| `--grid-line` (hero grid) | `color-mix(in srgb, var(--foreground) 6%, transparent)` | same formula |

Other semantic tokens (foreground, muted-foreground, accent, ring, success, warning, danger, chart-*) stay unchanged. All text pairs must still meet WCAG AA 4.5:1 on `--canvas`, `--surface` and `--surface-muted` in both themes, so check `--muted-foreground` on the new dark canvas.

Motion tokens (global, `:root`): `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`.

### 2. Typography inside `.app-shell`

Override the type-scale variables locally (the utilities and base `h1–h4` already read these variables):

- `--text-display-lg` (page `h1`): `clamp(1.5rem, 1.35rem + 0.6vw, 1.875rem)`, line-height 1.2, tracking `-0.02em`
- `--text-heading` (section titles, `.text-heading`): `clamp(1.0625rem, 1rem + 0.3vw, 1.25rem)`, weight 700
- `--text-display-md` (onboarding headline): one step down from today
- `--text-lead`: `1rem`, line-height 1.55
- Body stays 16px. Numbers in tiles and tables use `tabular-nums` where they align in columns (tables already do).

### 3. Shell layout

**Desktop (`lg` and wider):**

- Grid: `[sidebar 15.5rem][content 1fr]`, on the canvas background.
- Sidebar: sticky, `h-dvh`, canvas background, right hairline border, `p-4`, flex column.
  - Top row: `Logo`, plus a 36px square quick-create link aligned to the right (`aria-label="Start in Studio"`, plus icon, accent background, ink icon, radius 10px, press scale 0.95).
  - Nav groups with small uppercase muted labels (`eyebrow`, 0.6875rem): **Plan** (Dashboard, Strategy, Opportunities, Research), **Create** (Calendar, Studio), **Measure** (Analytics, Insights). Settings is pinned above the footer.
  - Item: 40px tall, radius 10px, `gap-3`, 18px icon in `muted-foreground`, label 0.9375rem weight 500. Hover (gated): `--surface-muted` background, `background-color 150ms ease`. Active (`aria-current="page"`): `--nav-active-bg`, 1px border `--border`, `--panel-shadow`, weight 600, icon in `foreground` with a 3px accent dot or bar. Active state is **not** colour alone: weight, border and background all change.
  - Active matching: exact match for `/app`, prefix match (`pathname === href || pathname.startsWith(href + "/")`) for the rest.
  - Footer: hairline top border, `UserButton` (with name if supported).
- Content column: no top bar on desktop. `main#main` has `px-6 lg:px-10 py-8 lg:py-10` and `max-w-[90rem]`.

**Mobile/tablet (below `lg`):**

- Sticky top bar, 56px, canvas background with 88% mix + blur (as today's `site-header`), hairline bottom border: logo · (spacer) · quick-create · Menu button · `UserButton`.
- The menu is a `<details>` panel anchored under the bar, full width minus a 12px gutter, a `.card` panel with `shadow-float`, and the same grouped `SidebarNav`.
  - Opening: `opacity 0→1` and `translateY(-6px)→0`, 180ms `var(--ease-out)`, via `@starting-style`. Closing: instant (no exit animation).
  - Closes on route change (a `usePathname` effect sets `open = false`), on Escape, and when a link inside it is clicked.
- Tap targets of at least 44px everywhere in the mobile menu.

**Must keep:** skip link (first focusable), `RequireSession` in its Suspense, `Toaster`, `id="main"`.

### 4. Panels (`.app-shell .card`)

- `background: var(--surface)`, `border: 1px solid var(--border)`, `border-radius: 1.25rem`, `box-shadow: var(--panel-shadow)`, padding `1.25rem`, or `1.5rem` from `md`.
- `.card-offset` (featured, e.g. "What should I do today?"): no offset shadow. Instead the border is `color-mix(accent 45%, border)` and the background is a faint accent wash at the top (`radial-gradient(120% 60% at 0% 0%, color-mix(accent 10%, transparent), transparent 60%)` over the surface).
- Nested cards (a `.card` inside a `.card`) get `--surface-muted`, no shadow and a 1rem radius, so nesting reads as depth rather than duplication.
- `details.card > summary` keeps its 44px tap target and gets a chevron that rotates 180° (`transform 200ms var(--ease-out)`).

### 5. Controls inside `.app-shell`

- `.btn`: radius 0.625rem, weight 600, font size 0.9375rem, min-height 2.75rem below `md` and 2.5rem from `md`. Transition: `background-color 150ms ease, border-color 150ms ease, color 150ms ease, transform 160ms var(--ease-out)`. `:active` → `transform: scale(0.97)` (not on disabled).
- `.btn-primary`: accent (mint) background, ink text, in both themes. Hover (gated) → `--color-signal-300`. Focus ring unchanged.
- `.btn-secondary`: surface background, 1px `--border`, foreground text. Hover → `--surface-muted` background and `muted-foreground` border. **No** full colour inversion.
- `.btn-ghost`: unchanged apart from radius and transition.
- `.btn-sm`: min-height 2.25rem from `md` and 2.75rem below.
- `.input/.textarea/.select`: 1px border, radius 0.625rem, `--surface` background. Focus ring as today.
- `.chip`: 1px border, checked state background `color-mix(accent 14%, surface)`, check mark kept.
- `.alert`: radius 0.75rem, unchanged colours.
- No `transition: all` anywhere.

### 6. `PageHeader`

```tsx
<PageHeader
  icon="analytics"
  title="Analytics"
  description="Log what you posted and see how each post compares with your own usual numbers."
  note="We don't connect to your accounts yet: you enter the numbers from each platform's insights."
  back={{ href: "/app/analytics", label: "All posts" }} // detail pages only
  actions={…}                                           // optional; unused in this pass unless an existing page-level action already exists
/>
```

- Layout: optional back link (small, muted, arrow-left icon) above. Then a row: 44px `.icon-tile` (1px border, radius 0.75rem, surface background, 22px icon), then `h1` and the description (`.lead`) stacked. The note (`.field-help`) goes under the description. A hairline divider (`border-b`) follows with `pb-6`, and the content starts `mt-8`.
- The text for every page is **exactly** today's text. Detail pages: Studio item ("Content package", back "All Studio items"), Post results ("Post results", back "All posts").
- Static: no data and no client JS, so the shells still prerender.

### 7. Dashboard (`app/app/page.tsx`)

- `PageHeader` icon "dashboard", title "Dashboard", and the description is the greeting (inside its Suspense with the same fallback height).
- Layout from `xl`: `grid xl:grid-cols-[minmax(0,1fr)_22rem] gap-6 items-start`.
  - Main column: `DashboardToday` (Today card + Next idea), then `DashboardStrategyCard`.
  - Side column: `PerformanceCard`, `LearnedCard`, then `AiUsageLine` inside a small muted panel.
  - Below `xl`, a single column in this order: Today, Strategy, Performance, Learned, AI usage. This keeps today's priority: "What should I do today?" comes first (AGENTS.md §14).
- Each section keeps its own Suspense and its own skeleton, and skeleton heights match the panels so nothing jumps.
- Card header rows: `h2` on the left, 32px circular `.icon-badge` on the right (Metricool style, `aria-hidden`). Icons: Today → target, Next idea → lightbulb, Performance → chart, Learned → sparkle, Strategy → strategy.
- Performance card: the views figure is shown at `text-4xl` in a stat-tile treatment, and the sparkline sits full width beneath it. Text and branches are unchanged.

### 8. Analytics

- Page `max-w-5xl`, `PageHeader` as above.
- Platform cards: a panel header row with the platform name and its icon badge, then the 3 `StatTile`s as a KPI band (`--surface-muted` band with radius 1rem and tiles inside, like Buffer), then the chart.
- `StatTile`: no border, `--surface` on the muted band (or `--surface-muted` when standalone), radius 0.875rem, padding 1rem. Label 0.8125rem muted weight 500. Value `text-3xl` weight 700 with tracking `-0.02em`. Note 0.8125rem muted.
- Empty state (`overview.posts.length === 0`): `EmptyHero` with title "No posts yet", the existing body copy, and a primary link "Log a past post" pointing to `#log-past-post` (the existing `<details>` gets `id="log-past-post"`; it's already open when the page is empty).
- `ComparisonPill` tints as described in "Files Likely to Change". Text and arrows are unchanged.
- `NeedsResults` and `PostRow`: panel styling only.

### 9. `EmptyHero`

- A panel with min-height 18rem (14rem on mobile), a centred column, and an `h2` (`text-heading`, a bit larger: 1.375rem), a body paragraph and an optional action.
- Background: a faint 48px grid from two `linear-gradient`s using `--grid-line`, with a radial fade so the grid dissolves toward the edges (`mask-image`).
- 4–6 decorative 44px icon tiles placed absolutely around the edges (hidden below `sm` except 2), each a soft tinted square (sky/blush/butter/lilac at 70% in light, 18% mixed into the surface in dark) holding a local SVG icon. `aria-hidden`, `pointer-events: none`.
- Entrance (rare, so delight is acceptable): tiles fade in with `opacity 0→1` and `translateY(6px)→0`, 300ms `var(--ease-out)`, 50ms stagger, using `@starting-style`. No looping or floating animation. Reduced motion: opacity only.
- Used only where a top-level empty state already exists (Analytics for sure; Studio list, Opportunities, Research and Insights if their content component has one). Same copy, same actions, same heading ids.

### 10. Skeletons

- `.skeleton`: `--surface-muted` background, radius 0.5rem, and a gentle opacity pulse (`1 → 0.55 → 1`, 1.6s `ease-in-out`, infinite). Reduced motion: no pulse (the existing global rule already shortens animations; also set `animation: none` under the query).
- `SectionSkeleton` and the page skeletons switch to `.skeleton` and keep the same line counts and `aria-hidden`.

### 11. Other pages

Strategy, Opportunities, Research, Calendar, Studio (list + item), Insights and Settings: `PageHeader` with their current text and icon, existing max widths, and the panel and control styles from the CSS. No component restructuring beyond swapping in `EmptyHero` where §9 applies.

### 12. Onboarding

`app/onboarding/layout.tsx` wrapper gets `.app-canvas` (tokens + canvas background + type-scale overrides). Nothing else changes.

## AI Behavior

None. No prompts, models, schemas, usage metering or generation flows change.

## Security Requirements

- No change to authentication or authorization: `RequireSession` and each section's `auth.protect()` stay where they are.
- No new client-side data access. The new client component (`mobile-nav.tsx`) only reads `usePathname` and toggles a `<details>`.
- No secrets, env vars or provider calls in any changed file.
- `UserButton` stays Clerk-managed. No user data beyond what Clerk renders.

## Acceptance Criteria

1. Every `/app` route renders the new sidebar (desktop) or top bar + menu (mobile), with a `PageHeader` showing that page's existing title and description.
2. The active nav item is correct on every route, including `/app/studio/[id]` (Studio) and `/app/analytics/[id]` (Analytics).
3. The mobile menu opens with the described animation, closes after navigating, on Escape and when a link is clicked, and has tap targets of at least 44px.
4. The dashboard shows a two-column layout from `xl` and a single column below it, with "What should I do today?" first. All of today's states (each recommendation kind, error, empty) still render with the same copy and actions.
5. The Analytics empty state uses `EmptyHero`, and its "Log a past post" link scrolls to the open form. The populated state shows the KPI band, charts and table toggle as before.
6. Light and dark both look right (canvas, panels, borders, pills, buttons, charts), and text contrast is AA on canvas, surface and muted surfaces.
7. The marketing homepage, sign-in/up and `/design-system` look exactly as they do today.
8. Every existing interaction still works: onboarding submit, strategy generate/regenerate, opportunity generate/save/dismiss, research add/refresh, calendar schedule/plan week/timezone, Studio start/generate/edit/regenerate section/restore version/schedule/discard, analytics log past post/publish/add results/edit/delete/diagnose/save experiment, insights update/dismiss, settings timezone/account/privacy, and toasts.
9. Motion: buttons scale to 0.97 on press. Hover effects only apply on fine pointers. Nothing animates on navigation. No `transition: all`. With reduced motion, no movement animations play.
10. No changes under `lib/` other than `lib/app-shell/nav-items.ts`, no changes to any `actions.ts`, and no new dependencies.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

(`build` is required: the root `/app` layout and all page shells change, and Cache Components prerendering must still succeed.)

New test: `tests/app-shell/nav-items.test.ts`: unique hrefs; every live item has an `icon` and a `group`; groups appear in the order Plan → Create → Measure, then Settings.

## Manual Test Procedure

1. `pnpm dev`, sign in, and land on `/app`.
2. **Desktop, 1440px wide:** visit every route from the sidebar. Check the active pill, the page header text matches the previous heading/description, panels and buttons are restyled, and quick-create opens `/app/studio`. Open a Studio item and a post's results: the sidebar highlights Studio or Analytics and the back link works.
3. **Dashboard:** check the two columns at 1280px+ and a single column at 1024px. Confirm the Today card is first in both. Check each card's error branch by temporarily breaking the Supabase env in dev (each card fails independently, as before).
4. **Analytics:** with a fresh account, see the `EmptyHero`. "Log a past post" jumps to the open form. Log a post, add results to 2+ posts, and confirm the KPI band, chart, legend and "Show as table" all work.
5. **Mobile (375×812, DevTools):** the top bar, menu open animation, menu closing after tapping a link, Escape closing it, no horizontal scroll on any page, and tap targets at least 44px.
6. **Dark mode:** switch the OS/DevTools to dark, repeat steps 2–5 quickly, and spot-check contrast with DevTools on muted text over canvas and over tiles.
7. **Reduced motion:** turn on "prefers-reduced-motion: reduce" in DevTools. Skeletons stop pulsing, the EmptyHero tiles appear without moving, and the menu opens without sliding.
8. **Regression pass:** run through each interaction listed in Acceptance Criteria #8 once, and confirm the toasts appear styled.
9. **Outside the app:** open `/`, `/sign-in` and `/design-system` and confirm they are unchanged.

### Visual summary

- **Feel:** calm, crisp and product-like. A tinted canvas, white (light) or charcoal-green (dark) panels, hairline borders, one mint accent for primary actions and active states.
- **Radii:** panels 20px, tiles 14px, controls 10px, pills full.
- **Spacing:** 24px grid gap between panels, 20–24px panel padding, page gutter 24px (40px on large screens).
- **Type:** Manrope throughout. Page titles about 30px bold, section titles about 18–20px bold, body 16px, meta 13–14px muted. The Instrument Serif accent stays only on hooks (as today).

## Out of Scope

Channel connections, date-range filters, tags, export, the sidebar collapse toggle, theme toggle, new data on the dashboard, an AI-usage meter in the sidebar, any change to marketing/auth pages, shadcn installation, and icon/motion libraries.
