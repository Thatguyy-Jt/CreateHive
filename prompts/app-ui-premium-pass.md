# App UI: Premium SaaS Pass (green sidebar, white pages)

## Goal

The first remodel (`prompts/app-ui-remodel.md`) shipped, but the owner finds it doesn't feel like a premium SaaS product. Viewed on a dark-mode system, sidebar, canvas and panels all share one dark green base, so nothing separates and the type feels oversized. A visible scrollbar also sits beside the sidebar.

This pass restyles the logged-in app after a new reference dashboard ("Haze", studied as a virtual reference, not copied). The target is a **deep-green sidebar, white/near-white pages, compact type, soft elevated white cards, one dark-green hero card, and a translucent top bar with breadcrumbs**. The motion and material principles come from the `apple-design` and `emil-design-eng` skills.

As before, **no product logic changes**: no services, actions, schemas, data, auth or AI.

## Skills Read

- `apple-design`: materials and depth (heavier, darker material for structural regions like sidebars; translucent toolbar with content scrolling underneath; no light translucency stacked on light), typography (size-specific tracking, tight leading on large text, hierarchy from weight + size, spacing in rem), wayfinding ("Where am I?", hence breadcrumbs), simplicity through hierarchy, critically-damped motion with no bounce for UI that wasn't flicked, reduced motion and reduced transparency.
- `emil-design-eng`: purpose and frequency test for motion (navigation never animates), ease-out under 300ms, press scale of 0.97, hover gated to fine pointers, popovers originate from their trigger, no `transition: all`.

## Reference Analysis (Haze dashboard)

| Area | What the reference does | Principle we adopt |
|---|---|---|
| **Structure** | Dark sidebar, white top bar, light-grey canvas, white cards. Three distinct planes | Three clear planes: **deep-green sidebar** (heaviest material), **translucent white top bar**, **#f6f8f7 canvas with white cards** |
| **Sidebar** | Small logo tile and wordmark; tiny uppercase group labels (~11px, letter-spaced, low contrast); compact 13–14px items about 36px tall; outline icons at 16–18px; active item a subtly lighter fill; no visible scrollbar | Same rhythm on deep green (`#0c241f → #08170f`): white-ish text at 72% opacity, active item `rgb(255 255 255 / 0.08)` fill with white text and a mint icon, hidden scrollbar |
| **Top bar** | Breadcrumb (section › page, current page in brand green), utility icons, avatar + name on the right; hairline bottom edge | Breadcrumb ("Dashboard › Studio › Content package"), Clerk `UserButton` with name on the right. **No** search, notifications, language or theme icons (we have none of those features) |
| **Hero card** | One dark-green gradient card with a faint grid, a huge white figure, a delta chip, a ghost button and a decorative line | **The "What should I do today?" card becomes the single hero**: green→near-black gradient, faint grid, white type, mint primary button. It's the one place with this much weight, so the dashboard answers "what should I do today?" at a glance (AGENTS.md §14) |
| **KPI cards** | White, ~14px radius, no heavy border, very soft shadow; small grey label, large bold figure, tiny coloured meta | Cards: white, 14px radius, `1px rgb(16 32 30 / 0.06)` border and a two-layer soft shadow. Stat tiles: 13px label, 24–28px bold figure with `-0.02em` tracking |
| **Panels** | Section title ~18px semibold; content dense but airy (20–24px padding); selected row tinted green with a green border | Section titles 17px bold, panel padding 20/24px. Selected/active rows use a pale mint tint + mint border (opportunity tabs, chips) |
| **Colour** | Neutral greys everywhere, brand green only for brand moments: the hero, active states, positive deltas, primary actions | Neutral canvas and white. Green is reserved for sidebar, hero, primary buttons, active/selected states and positive comparisons |
| **Type** | Small, crisp UI type (13–15px) with large figures as the only big text | App base 15px; page title 22–24px; meta 13px; only the hero and stat figures go big |

**Not copied:** Haze's name, logo, palette values, copy, revenue/charts content, and the utility icons we can't back with features.

## Existing Code Inspected

- `app/globals.css` section 11 (from the last pass): `.app-shell/.app-canvas` tokens with **light and dark** variants, sidebar/nav/topbar/page-header/panel/control/empty-hero/kpi/skeleton classes. `.app-sidebar` uses `overflow-y: auto`, **which shows the scrollbar** in the owner's screenshot.
- `app/app/layout.tsx`: `.app-shell` flex row with `Sidebar`, then a column with `AppHeader` (mobile only) and `main.app-main`.
- `components/app-shell/{sidebar,sidebar-nav,app-header,mobile-nav,page-header,card-header,empty-hero,icons}.tsx`, `lib/app-shell/nav-items.ts` (`isActiveHref`).
- `components/dashboard/today-card.tsx`: `TodayFrame` and `TodayError` render `section.card.card-offset`. Children include `IdeaMeta` pills, a hook `blockquote`, `ScheduleIdeaForm` (date/time inputs + submit), `.btn-primary` links and `.link`s. All are token-styled.
- `app/app/page.tsx`: the xl two-column dashboard.
- `components/marketing/logo.tsx`: hexagon fills `var(--primary)` / `var(--primary-foreground)`, and the wordmark inherits `currentColor`.
- `app/layout.tsx`: Clerk `appearance` variables are CSS vars (`var(--foreground)` etc.), so Clerk UI follows whatever tokens are in scope where it renders, including portals under `body`.
- Charts read `--chart-accent` / `--chart-muted`.

## Decisions / Assumptions

1. **The app's pages are always light**, even on a dark-mode system. The owner asked for "white pages like the inspo", and the dark-mode render is what made everything one colour. The light tokens are pinned on `body:has(.app-shell, .app-canvas)` (not on `.app-shell`) so that portaled UI (Clerk's user menu, Sonner toasts) also renders light, with `color-scheme: light` so native date/time pickers match. The **sidebar is always deep green**. Marketing and auth pages keep following the system theme. (This reverses the "keep light + dark" choice from the first pass for the app area only. Dark mode for the app can return later as its own task.)
2. **Hero = Today card only.** `TodayFrame`/`TodayError` switch from `card-offset` to `card card-hero`. Other `card-offset` panels (strategy positioning, Studio item title, post title, calendar timezone/proposal, finish setup) become white cards with a 3px mint top edge, a quieter "featured" signal.
3. **Desktop top bar returns** (it was mobile-only): breadcrumbs left, `UserButton showName` right. The sidebar footer no longer holds the account. Settings stays pinned at the bottom of the sidebar.
4. **Breadcrumbs come from the pathname only** (no data): `Dashboard` for `/app`, `Dashboard › {Section}` for sections, and `Dashboard › {Section} › Content package` / `Post results` for the two detail routes. Pure function in `lib/app-shell/breadcrumbs.ts`, tested.
5. **Primary buttons** use `--color-signal-700` (`#117c52`) with white text (≈5:1, AA), hover `--color-signal-800`. Inside the hero they flip to mint (`signal-400`) with ink text.
6. **Hidden sidebar scrollbar**, scrolling kept: `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`. Compact nav (36px items on desktop) so it fits a 768px-tall viewport without scrolling.
7. **No new data, dependencies or features.** No KPI row on the dashboard (it would need new reads). No search, notifications or theme toggle.

## Files Likely to Change

| File | Change |
|---|---|
| `app/globals.css` | Rewrite section 11: pinned light app tokens on `body:has(...)`, remove the app dark-mode overrides, `.nav-dark` scope (sidebar + mobile menu), hidden sidebar scrollbar, compact nav, translucent `.app-topbar` for all breakpoints, breadcrumb styles, compact type scale, new card elevation, `.card-hero` (dark scope), `card-offset` → mint top edge, primary button colours, reduced-transparency fallback |
| `app/app/layout.tsx` | Column order unchanged; `AppHeader` now renders on all breakpoints |
| `components/app-shell/app-header.tsx` | Desktop: breadcrumbs + `UserButton showName`. Mobile: logo, quick create, menu, `UserButton` |
| `components/app-shell/breadcrumbs.tsx` (new, client) | Reads `usePathname` behind Suspense (fallback: "Dashboard"), renders `nav[aria-label="Breadcrumb"] > ol`, current page has `aria-current="page"` |
| `lib/app-shell/breadcrumbs.ts` (new) | `breadcrumbsFor(pathname)` → `{ label, href? }[]` from `navItems` + the two detail labels |
| `components/app-shell/sidebar.tsx` | `nav-dark` class, remove the account footer, logo row tweaks |
| `components/app-shell/mobile-nav.tsx` | Panel gets `nav-dark` |
| `components/app-shell/page-header.tsx` | Compact: 40px icon tile, smaller title/description, no full-width divider (the top bar provides structure) |
| `components/dashboard/today-card.tsx` | `card-offset` → `card-hero` on `TodayFrame` and `TodayError` (2 class strings) |
| `app/app/page.tsx` | Layout: hero (Today + next idea) full width, then a 3-up grid (`lg:grid-cols-3`: Strategy · Performance · What AI learned), then the AI usage line. Suspense boundaries and skeleton fallback (`card-hero` for the Today skeleton) kept |
| `tests/app-shell/breadcrumbs.test.ts` (new) | Breadcrumb mapping for every nav route, both detail routes, and unknown paths |

## Database Changes

None.

## Implementation Requirements

### 1. Tokens (pinned light, app only)

On `body:has(.app-shell, .app-canvas)`, in both colour schemes:

| Token | Value |
|---|---|
| `color-scheme` | `light` |
| `--background` / `--canvas` | `#f6f8f7` |
| `--surface` | `#ffffff` |
| `--surface-muted` / `--muted` | `#f1f4f3` |
| `--foreground` | `var(--color-ink-900)` |
| `--muted-foreground` | `#56665f` (AA on white and canvas) |
| `--border` | `#e5eae8` |
| `--primary` / `--primary-foreground` | `var(--color-signal-700)` / `#ffffff` |
| `--accent` / `--accent-foreground` | `var(--color-signal-400)` / `var(--color-ink-900)` |
| `--ring` | `var(--color-signal-600)` |
| `--success` / `--warning` / `--danger` | light values from section 2 |
| `--chart-accent` / `--chart-muted` | `var(--color-signal-600)` / `var(--color-neutral-400)` |
| `--card-shadow` | `0 1px 2px rgb(16 32 30 / 0.04), 0 2px 8px -2px rgb(16 32 30 / 0.06)` |

The `@media (prefers-color-scheme: dark)` blocks for `.app-shell/.app-canvas` and `.hero-tile` are removed. `--color-signal-*` ramps are unchanged.

### 2. Type (inside the app)

- `.app-shell, .app-canvas`: `font-size: 0.9375rem` (15px, rem so it honours the user's text size); body line-height 1.55.
- `h1` (page title): `clamp(1.375rem, 1.3rem + 0.3vw, 1.5rem)`, weight 700, tracking `-0.02em`, line-height 1.2.
- `.text-heading` (section titles): `1.0625rem`, weight 700, tracking `-0.01em`.
- `.lead`: `0.9375rem`, muted. `.field-help`: `0.8125rem`. `.eyebrow`: `0.6875rem`, tracking `0.1em`.
- Hook blockquotes keep Instrument Serif (as today).

### 3. Sidebar (`.app-sidebar.nav-dark`)

- Background `linear-gradient(180deg, #0c241f 0%, #08170f 100%)` (heaviest material, darker than any page surface), a `1px rgb(255 255 255 / 0.06)` inner right edge, width 15rem, sticky, `100dvh`, `overflow-y: auto` with **hidden scrollbar**, `overscroll-behavior: contain`.
- `.nav-dark` scope tokens: `--foreground: #e8f1ee`, `--muted-foreground: rgb(232 241 238 / 0.56)`, `--border: rgb(255 255 255 / 0.08)`, `--primary: var(--color-signal-400)`, `--primary-foreground: var(--color-ink-900)` (so the logo hexagon renders mint with an ink play glyph), `color: var(--foreground)`.
- Logo row: 56px tall, logo + 32px quick-create (mint bg, ink plus, radius 9px). A hairline below.
- Group label: 11px, 600, `0.1em` tracking, uppercase, muted, `padding: 0 12px`, 16px above each group except the first.
- Item: 36px tall on desktop (44px below `lg`, in the mobile panel), radius 8px, padding `0 12px`, gap 10px, 14px weight 500, `rgb(232 241 238 / 0.78)`, icon 18px at 0.56 opacity. Hover (fine pointers only): `rgb(255 255 255 / 0.05)` background, `background-color 150ms ease`. Active: `rgb(255 255 255 / 0.09)` background, white text weight 600, mint (`signal-400`) icon, plus the 3px mint bar on the left edge. No border or shadow.
- Pinned Settings at the bottom with a hairline above.
- Mobile panel (`.app-mobile-panel.nav-dark`): same green material, radius 14px, `0 16px 40px -12px rgb(8 23 15 / 0.45)` shadow. Opens from its trigger (`transform-origin: top right`) with `opacity 0→1, scale 0.98→1, translateY(-4px)→0`, 200ms `var(--ease-out)`, no exit animation. Reduced motion: opacity only.

### 4. Top bar (`.app-topbar`, all breakpoints)

- Sticky, 56px (60px from `lg`), `background: rgb(255 255 255 / 0.72)`, `backdrop-filter: blur(20px) saturate(180%)`, bottom hairline `rgb(16 32 30 / 0.06)`. Content scrolls under it. `@media (prefers-reduced-transparency: reduce)`: solid white, no blur.
- Desktop: `Breadcrumbs` on the left, `UserButton showName` on the right. Mobile: logo, then (spacer) quick create, Menu, `UserButton` (no name). Breadcrumbs are hidden below `md` except the current page name.
- Breadcrumbs: 13px. Ancestors are links in `muted-foreground` (hover → foreground). The separator is a 12px chevron icon (`aria-hidden`). The current page is `signal-700` weight 600 with `aria-current="page"`. The first crumb has an 16px dashboard icon.
- Horizontal padding matches `.app-main` so breadcrumbs align with page content.

### 5. Page header (compact)

- 40px icon tile (white, 1px border, radius 10px, card shadow, `signal-700` icon). Title and description to its right. Note under the description. Back link (detail pages) above, 13px.
- No bottom divider. `margin-bottom` comes from the page's `stack-lg`.

### 6. Cards and controls

- `.card`: white, `1px solid rgb(16 32 30 / 0.06)`, radius 14px, `--card-shadow`, padding 20px (24px from `md`). Nested `.card .card`: `--surface-muted`, no shadow, radius 12px.
- `.card-offset`: white, `box-shadow: inset 0 3px 0 var(--color-signal-500), var(--card-shadow)` (mint top edge), no tinted border.
- `.btn`: radius 9px, 14px/600; min-height 2.75rem below `md`, 2.375rem (`btn-sm` 2rem) from `md`. Press `scale(0.97)` with `transform 160ms var(--ease-out)`. Primary: `signal-700` bg, white text, hover `signal-800`. Secondary: white bg, `--border`, hover `--surface-muted`. Hover styles only on fine pointers.
- Inputs: radius 9px, 1px `--border`, white bg, focus ring as today.
- `.chip:has(input:checked)` and selected pills: `color-mix(signal-500 12%, white)` bg with `signal-600` border.
- `.stat-tile`: `--surface-muted`, radius 12px, value 1.625rem/700 with `-0.02em`. The KPI band inside platform cards stays, retoned.
- `EmptyHero`: unchanged structure on the white card. Tiles use the light tint values only.

### 7. Hero card (`.card-hero`)

- `background: radial-gradient(120% 80% at 100% 0%, rgb(61 220 151 / 0.16), transparent 55%), linear-gradient(135deg, #0f3a2e 0%, #0b2a23 45%, #07140f 100%)`, plus a faint 40px grid (`rgb(255 255 255 / 0.04)` lines, masked to fade toward the left). Radius 16px, no border, shadow `0 12px 32px -16px rgb(8 23 15 / 0.5)`.
- Dark scope tokens: `--foreground: #f2f7f5`, `--muted-foreground: rgb(242 247 245 / 0.7)`, `--border: rgb(255 255 255 / 0.14)`, `--surface: rgb(255 255 255 / 0.06)` (inputs, pills), `--surface-muted: rgb(255 255 255 / 0.08)`, `--primary: var(--color-signal-400)`, `--primary-foreground: var(--color-ink-900)`, `--accent: var(--color-signal-400)`, `--ring: var(--color-signal-400)`, `color-scheme: dark` (date/time pickers), `color: var(--foreground)`.
- Inside: the `h2` stays 17px, and the main action title (`h3`) becomes 1.5rem/700 with `-0.02em` (the big figure moment). The icon badge is `rgb(255 255 255 / 0.08)` with a mint icon. Primary hover → `signal-300`. Secondary: transparent, white 20% border.
- Text contrast: white 70% on `#0b2a23` is ≥ 7:1.

### 8. Dashboard layout

```
[ PageHeader ]
[ Today (hero) ................................................ ]
[ Next idea worth making (white card, only when present) ....... ]
[ Strategy ]  [ Performance ]  [ What AI learned ]      ← lg: 3 cols, md: 2, sm: 1
AI usage line (muted, small)
```

- Grid `gap-5`, cards in a row stretch to equal height (`items-stretch`, cards `h-full`). Existing `mt-auto` actions sit at the bottom.
- Suspense boundaries, skeletons and fail-independently behaviour unchanged.

### 9. Main column

`.app-main`: `max-width: 82rem`, padding `24px 16px 64px` → `28px 24px` (`md`) → `32px 40px 80px` (`lg`).

## AI Behavior

None.

## Security Requirements

No change. Breadcrumbs read only the pathname. No new data access, secrets or client-side privileged calls. `RequireSession` and every `auth.protect()` stay in place.

## Acceptance Criteria

1. On a **dark-mode** system the app shows a deep-green sidebar, a translucent white top bar, a light canvas and white cards. The Clerk user menu and toasts are light too. Marketing and auth pages still follow the system theme.
2. The sidebar shows no scrollbar at 1366×768 or larger, and still scrolls (without a visible bar) on shorter viewports.
3. The Today card renders as the green hero in all its states (each recommendation kind, error, skeleton). Its date/time inputs, pills, hook, primary button and links are legible (AA) and work.
4. Breadcrumbs are correct for every route, including both detail routes. The current crumb is marked `aria-current="page"`.
5. The dashboard follows the layout in §8 at `lg`, `md` and mobile widths.
6. All interactions listed in the previous prompt's acceptance criteria #8 still work.
7. Motion: the mobile menu materialises from its trigger, buttons press-scale, nothing animates on navigation, and reduced motion/transparency fallbacks apply. No `transition: all`.
8. No changes to `lib/**` except the new `lib/app-shell/breadcrumbs.ts`, no `actions.ts` changes, no new dependencies.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Manual Test Procedure

1. Set the OS/DevTools to **dark**, run `pnpm dev`, and sign in. Check `/app`: green sidebar, white top bar with "Dashboard" breadcrumb and your name, light canvas, and the green Today hero.
2. Visit every sidebar link and both detail pages. Check the breadcrumb trail and the active item, and that ancestor crumbs navigate.
3. Resize to 1366×768: no sidebar scrollbar. Shrink the window height to about 600px: the sidebar scrolls with the wheel and no bar is visible.
4. Dashboard: check every Today state you can reach (schedule saved idea → use its date/time form, review new, plan next week). Inputs must be readable inside the hero and the native pickers dark-styled.
5. Widths 1440 / 900 / 375: dashboard grid 3 → 2 → 1 columns. Mobile: top bar, green menu panel opening from the Menu button, closing on navigation and Escape.
6. Open the Clerk user menu and trigger a toast (e.g. save an idea): both are light.
7. DevTools rendering: emulate `prefers-reduced-motion: reduce` (menu fades only) and `prefers-reduced-transparency: reduce` (solid top bar).
8. Open `/` and `/sign-in` in dark mode: they're unchanged.

## Out of Scope

App dark mode, theme toggle, search, notifications, KPI row with new data, charts in the hero, marketing/auth changes, new dependencies.
