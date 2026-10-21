# App UI: Monochrome Signage Pass (ink on white, one green for actions)

## Goal

Restyle every logged-in page (`/app/**` and the `/onboarding` canvas) using the principles in the style reference the owner shared (`DESIGN (1).md`, a breakdown of Sprout Social's visual system). We study it as a reference and don't copy it. The owner wants the logged-in UI and layout to follow its principles:

> Near-black ink on a white canvas. One vivid green kept for actions only. Bold geometric type that works like wayfinding signage. Surfaces defined by borders and two radii (6px controls / 16px cards), not shadows.

This replaces the look from `prompts/app-ui-premium-pass.md` (deep-green sidebar, green-gradient hero, soft shadows). That pass is still **uncommitted** in the working tree, and this pass builds directly on top of it: same components, same class names, same layout skeleton, new visual language.

As before, **no product logic changes**: no services, actions, schemas, data reads, auth or AI.

## Skills Read

- `emil-design-eng`: motion only with purpose. Press scale 0.97, hover gated to fine pointers, no `transition: all`, nothing animates on navigation.
- `apple-design`: wayfinding (breadcrumbs, a clear active state), hierarchy from weight and size, reduced-motion fallbacks.
- `dataviz`: charts move to a monochrome accent (ink) with one grey for de-emphasis, and keep a legend and non-colour cues.

## Reference Principles → How We Apply Them

| Reference principle | Applied in the app |
|---|---|
| **99% achromatic.** Ink `#040404` on white `#ffffff`, greys for chrome | Canvas, sidebar, top bar and cards are all white. Text is ink. Chrome uses Ash `#d9d9d9` / Smoke `#cbcece`. Muted text is Pewter `#6e797a`. The tinted canvas `#f6f8f7` and the deep-green sidebar go away. |
| **Green `#98e58e` is rationed to actions** and selected states, never decoration | Green is used for: primary buttons, the active sidebar item, checked chips, the "above baseline" pill, and the logo hexagon (our "brand leaf"). Everything currently green for decoration (blockquote bars, `bg-accent` badges, icon tints, the hero gradient, chart lines) becomes ink or grey. |
| **Single geometric family, 400 vs 800.** No 500/600 | Proxima Nova is licensed, so we use **Nunito Sans** (one of the reference's listed substitutes) at 400/700/800, scoped to the app only. Every 500/600 weight in the app maps to 400/700. |
| **Two radii**: 6px controls, 16px cards (plus pill badges) | Buttons, inputs, nav items, icon tiles and quick create are 6px. Cards, panels, the hero, stat tiles and toasts are 16px. Pills and badges are fully round. The current 8/9/10/12/14px radii are removed. |
| **No shadows on cards.** Shadow belongs to the nav only | Cards are border-defined (1px Ash). The one shadow (`rgba(39,51,51,0.24) 0 4px 8px`) sits on the sticky top bar and floating UI (mobile menu, popovers, toasts). |
| **Reversed dark hero panel**: black canvas, white headline, green CTA | The dashboard's **Today** card becomes the single ink-black panel: white 800-weight headline and a green primary button. |
| **Links are always underlined** | `.link` and breadcrumb ancestors are ink with a permanent 1px underline. Sidebar items are navigation, not inline links, so they use fill and weight instead. |
| **Signage headlines**: big, tight, 800 | Page titles are 32px/800, the headline floor in the reference. Section titles are 21px/700, and figures are 32px/800. |
| **4px grid; 16 / 32 / 64 rhythm; 1200px max** | `.app-main` max-width 75rem (1200px). 32px between page blocks, 24px between cards (gap-6), 16px inside blocks. |
| **Gradient wash as a stage**, never decoration | Used once: behind the empty-state panel (`EmptyHero`), as a soft prism wash (green → teal → periwinkle at low opacity). The pastel tiles become white bordered tiles with ink icons. |

**Not copied:** Sprout's name, leaf logo, copy, photography, pricing or integrations content, and the 76/57px marketing display sizes (an app dashboard has no marketing hero).

## Existing Code Inspected

- `app/globals.css`
  - Section 2: semantic tokens.
  - Sections 4 and 7: `.eyebrow` and `.link` use weight 600. `.accent-word` is serif and marketing only.
  - Section 11 (lines ~972–1794): the whole app look from the previous pass. Pinned light tokens on `body:has(.app-shell, .app-canvas)`, `.nav-dark` sidebar, translucent `.app-topbar`, breadcrumbs, `.app-main`, `.page-header`/`.icon-tile`, `.card`/`.card-offset`/`.card-hero`, disclosure cards, `.btn*`, inputs, chips, `.panel-hero`/`.hero-tile-*`, `.kpi-band`/`.stat-tile`, `.pill-above/below/around`, skeletons.
- `app/layout.tsx`: Manrope / Instrument Serif / Geist Mono through `next/font`. Clerk `appearance` uses CSS variables, with `fontFamily: var(--font-manrope)…`.
- `app/app/layout.tsx`: `.app-shell` contains `Sidebar` and a column with `AppHeader` and `main.app-main`. `app/onboarding/layout.tsx` uses `.app-canvas`.
- `components/app-shell/*`
  - `sidebar.tsx`: `.app-sidebar.nav-dark` and `QuickCreate`.
  - `sidebar-nav.tsx`: groups Plan / Create / Measure, a pinned Settings item, and "Soon" badges.
  - `app-header.tsx`: breadcrumbs and `UserButton showName`.
  - `mobile-nav.tsx`: `.app-mobile-panel.nav-dark`.
  - `page-header.tsx`, `empty-hero.tsx`, `card-header.tsx`, `breadcrumbs.tsx`, `icons.tsx`.
- `components/marketing/logo.tsx`: the hexagon fill is `var(--primary)` and the glyph is `var(--primary-foreground)`.
- `components/dashboard/today-card.tsx`: `card card-hero` on `TodayFrame` and `TodayError`. Hook `blockquote`s use `border-accent font-accent italic`, and so do `idea-summary.tsx`, `calendar-content.tsx` and `calendar-item-card.tsx`.
- `app/app/page.tsx`: hero row, then a 3-up grid, then the AI usage line.
- Charts (`components/charts/*`, `analytics-content.tsx` legend) read only `--chart-accent` / `--chart-muted`.
- `components/ui/toaster.tsx`: Sonner, radius `var(--radius-md)` (16px), font from `.toast` → `var(--font-sans)`.
- Usage counts: 120× `font-semibold` across 49 files, 0× `font-medium`. Button variants used: `btn-primary` (36), `btn-secondary` (37), `btn-ghost` (22), `btn-sm`, `btn-lg`. Accent utilities: `bg-accent` ×3, `border-accent` ×7, `text-accent-foreground` ×2.

## Decisions / Assumptions

1. **Mostly CSS again.** The look lives in `globals.css` section 11, which is rewritten. Component edits are limited to the files listed below. The 49 files using `font-semibold` are **not** edited: within the app scope `--font-weight-semibold` is set to 700 and `--font-weight-medium` to 400 (Tailwind v4 utilities read these variables), and Nunito Sans is loaded at 400/700/800 only.
2. **White sidebar, not black.** The reference is a white, border-defined system with one reversed panel. Making the sidebar black would add a second dark plane and compete with the Today hero. The sidebar is white with a 1px Ash right border. The active item is a green fill with ink 700 text, which matches the reference's "selected navigation states" use of green. *(If the owner prefers an ink-black sidebar, only the `.app-sidebar` tokens change.)*
3. **Font is app-only.** `Nunito_Sans` is added through `next/font` in `app/layout.tsx` (variable `--font-nunito-sans`, weights 400/700/800). It applies only under `body:has(.app-shell, .app-canvas)` by redefining `--font-sans` there, which also covers portaled toasts. Clerk's `fontFamily` becomes `var(--font-app, var(--font-manrope)), …`, and `--font-app` is set in the app scope, so the user menu matches while auth pages stay on Manrope. Marketing and auth pages are unchanged.
4. **Single family in the app.** Hook `blockquote`s drop the serif italic in the app (through CSS, not markup): app font, 700, upright, with an ink left rule instead of a green one.
5. **`--accent` becomes ink in the app** (`#040404`, foreground white). Every decorative `bg-accent` / `border-accent` turns monochrome without touching markup. `--primary` is the only green token.
6. **Primary button = green fill + ink text** (`#98e58e` / `#040404`, contrast ≈ 13:1). Hover (fine pointers) `#86d97b`. Green is never used as a text colour on white (≈ 1.6:1).
7. **Focus ring = ink** (`#040404`, 2px, offset 2px). A green ring would fail 3:1 on white.
8. **Light only.** The app tokens stay pinned light for both colour schemes, as in the previous pass.
9. **Type scale adapted for an app.** The previous owner feedback was that the type felt oversized. Body is 16px, the reference's smallest body size. Only page titles, the hero action title and stat figures reach 32px. Meta text is 13px. The 43–76px display sizes are not used.
10. **One extra neutral.** All of the reference's surfaces are white, but skeletons, hover fills and nested cards need a faint fill. We add `--fog: #f3f4f4` (derived from Smoke Gray) and use it only for those.
11. **No new features, data, dependencies or routes.** The only new package-level change is a `next/font/google` import (built in).

## Files Likely to Change

| File | Change |
|---|---|
| `app/globals.css` | Rewrite section 11 (tokens, sidebar, top bar, breadcrumbs, page header, cards, hero, controls, chips, pills, empty hero, KPI tiles, skeletons, charts tokens, type, weights, blockquote, links in app scope). Sections 1–10 are untouched. |
| `app/layout.tsx` | Add `Nunito_Sans` (400/700/800) to the `<html>` class list. Clerk `fontFamily` → `var(--font-app, var(--font-manrope)), …` |
| `components/app-shell/sidebar.tsx` | Drop `nav-dark` |
| `components/app-shell/mobile-nav.tsx` | Drop `nav-dark` from the panel |
| `components/app-shell/sidebar-nav.tsx` | "Soon" badge classes → `.badge-soon` (pill, 11px/700, Ash border, pewter text). Icon size 18 → 20 |
| `components/app-shell/empty-hero.tsx` | Remove the tint names from `TILES`. Tiles render as `hero-tile` only (white, bordered) |
| `components/app-shell/page-header.tsx` | No structural change. Possibly a class tweak so the title row aligns with the 32px title |
| `app/app/page.tsx` | Grid gaps `gap-5` → `gap-6` (24px). Layout order unchanged |
| Other pages under `app/app/**` | Only spacing utilities where they break the 4px rhythm (`gap-5` → `gap-6`, `gap-3.5` → `gap-4`). No markup restructuring |

## Database Changes

None.

## Implementation Requirements

### 1. Tokens (`body:has(.app-shell, .app-canvas)`, both colour schemes)

| Token | Value |
|---|---|
| `color-scheme` | `light` |
| `--canvas`, `--background`, `--surface` | `#ffffff` |
| `--fog`, `--surface-muted`, `--muted` | `#f3f4f4` |
| `--foreground` | `#040404` (Ink) |
| `--foreground-2` | `#162020` (Slate: secondary emphasis text) |
| `--muted-foreground` | `#6e797a` (Pewter, 4.6:1 on white, AA) |
| `--border` / `--card-edge` | `#d9d9d9` (Ash) |
| `--border-strong` | `#cbcece` (Smoke: inputs, image borders) |
| `--primary` / `--primary-foreground` | `#98e58e` / `#040404` |
| `--primary-hover` / `--primary-hover-foreground` | `#86d97b` / `#040404` |
| `--accent` / `--accent-foreground` | `#040404` / `#ffffff` |
| `--ring` | `#040404` |
| `--success` / `--warning` / `--danger` | `#1f7a3d` / `#9a5b00` / `#c2410c` (text-safe, AA on white) |
| `--chart-accent` / `--chart-muted` | `#040404` / `#a4adad` |
| `--nav-shadow` | `rgba(39, 51, 51, 0.24) 0 4px 8px 0` |
| `--font-app`, `--font-sans` | `var(--font-nunito-sans), ui-sans-serif, system-ui, sans-serif` |
| `--font-weight-medium` / `--font-weight-semibold` | `400` / `700` |
| `--radius-control` / `--radius-card` | `6px` / `16px` |
| `--card-shadow` | `none` (kept as a variable so existing rules resolve) |

The `--color-signal-*` ramps stay defined, but section 11 no longer references them.

### 2. Type (inside the app)

| Role | Size / line-height | Weight | Tracking |
|---|---|---|---|
| Page title `h1` | `clamp(1.75rem, 1.5rem + 1vw, 2rem)` (28→32px) / 1.18 | 800 | `-0.02em` |
| Section title `.text-heading`, card `h2` | `1.3125rem` (21px) / 1.33 | 700 | `-0.01em` |
| Card `h3` | `1.125rem` (18px) / 1.4 | 700 | 0 |
| Body (`.app-shell`, `.app-canvas`) | `1rem` / 1.6 | 400 | 0 |
| `.lead` | `1rem` / 1.6, pewter | 400 | 0 |
| Meta, `.field-help`, breadcrumbs | `0.8125rem` (13px) / 1.48 | 400 | 0 |
| `.eyebrow`, nav group labels | `0.75rem` (12px) | 700 | `0.08em`, uppercase |
| Stat figure, hero action title | `2rem` (32px) / 1.1 | 800 | `-0.02em` |

- Sizes are in rem so they honour the user's text size.
- `.link`, `.eyebrow` and any literal `font-weight: 600` / `500` rules that reach the app are overridden in scope to 700 / 400.
- `blockquote` in the app: `font-family: inherit`, `font-style: normal`, weight 700, colour ink, `border-left: 3px solid var(--foreground)`. This overrides `font-accent italic border-accent` from the markup.

### 3. Sidebar (`.app-sidebar`)

- White background, `border-right: 1px solid var(--border)`, no shadow. Width 15rem, sticky, `100dvh`. Hidden scrollbar (kept from the last pass).
- Brand row: 64px tall, logo and quick create, with a 1px Ash hairline below. The logo hexagon renders green with an ink glyph through the tokens. The wordmark is ink 800.
- **Quick create**: a 32px square, `--radius-control`, **solid dark** (ink bg, white plus icon). It's secondary to the green primary actions in the page and doesn't add a second green next to the active nav item. Hover: `#162020`. Press: `scale(0.95)`.
- Group label: 12px/700 uppercase pewter, `0.08em` tracking. 24px above each group except the first.
- **Nav item**: 40px tall on desktop (44px in the mobile panel), `--radius-control`, padding `0 12px`, gap 12px. 15px/400 ink. Icon 20px, ink at 0.72 opacity.
  - Hover (fine pointers): `--fog` fill, `background-color 150ms ease`.
  - **Active**: `#98e58e` fill, ink text, weight 700, icon at full opacity. The left bar is removed: fill plus weight is the non-colour cue.
- "Soon" items: pewter text, `.badge-soon` pill (Ash border, 11px/700).
- Pinned Settings sits at the bottom with an Ash hairline above.
- **Mobile panel**: white, 1px Ash border, `--radius-card`, `--nav-shadow`. Same open motion as today (from its trigger, 200ms `--ease-out`, opacity and scale 0.98 → 1). Reduced motion: opacity only.

### 4. Top bar (`.app-topbar`)

- Sticky, 64px from `lg` (56px below), **solid white**, `box-shadow: var(--nav-shadow)` (the one elevated plane), no backdrop blur, no bottom border. The `prefers-reduced-transparency` block becomes unnecessary and is removed.
- Breadcrumbs: 13px.
  - Ancestors: ink 400 with a permanent 1px underline (`text-underline-offset: 0.2em`). Hover: 2px thickness.
  - Separator: a 12px pewter chevron.
  - Current crumb: ink 700, no underline, `aria-current="page"`.
  - The leading dashboard icon is ink.
- Right side: `UserButton showName` (desktop), as today.

### 5. Page header

- Icon tile: 40px, white, 1px Ash border, `--radius-control`, ink icon at 20px, no shadow.
- Title: page title scale (§2). Description is `.lead` in pewter. The note is 13px.
- Back link: 13px ink with a permanent underline, arrow icon.
- 32px below the header (the page's `stack-lg` resolves to 2rem in the app).

### 6. Cards and surfaces

- `.card`: white, `1px solid var(--border)`, `--radius-card`, **no shadow**. Padding 16px, 24px from `md`.
- `.card-offset` (featured: strategy positioning, studio title, post title, calendar proposal, finish setup): the same card with a **1px ink border**. This is the reference's "emphatic border". The green top edge is removed.
- Nested `.card .card`: white, 1px Ash border, `--radius-card`. Cards are defined by their borders, not by a tonal lift.
- Disclosure cards (`details.card`): ink chevron, motion unchanged.
- `.panel-hero` (EmptyHero): white card with border and radius. Background is a **prism wash**: `linear-gradient(135deg, rgb(152 229 142 / 0.18) 0%, rgb(120 214 206 / 0.14) 45%, rgb(150 160 240 / 0.14) 100%)`. The grid overlay is removed. Title 21px/700. Tiles (`.hero-tile`) are white, 1px Ash border, `--radius-card` at 44px, ink icon. The staggered entrance motion stays. `.hero-tile-sky/blush/butter/lilac` are removed.
- `.kpi-band`: no fill, just the grid gap. `.stat-tile`: white, 1px Ash border, `--radius-card`, padding 16px. Label 13px/400 pewter, value 32px/800 ink, note 13px pewter.
- Skeleton: `--fog` fill, `--radius-control` for lines and `--radius-card` for blocks. The pulse stays (none when reduced motion is on).
- Toasts (app scope): white, 1px Ash border, 16px radius, `--nav-shadow`, app font.

### 7. Hero (`.card-hero`, the Today card): reversed panel

- `background: #040404`, no gradient, no grid (`::before` removed). `--radius-card`, no border, no shadow. Padding 24px, 32px from `md`.
- Scope tokens:
  - `--foreground: #ffffff`
  - `--muted-foreground: rgb(255 255 255 / 0.72)` (≥ 12:1)
  - `--border: rgb(255 255 255 / 0.24)`
  - `--surface: rgb(255 255 255 / 0.06)`, `--surface-muted: rgb(255 255 255 / 0.1)`
  - `--primary` stays green with ink text (the one chromatic thing on the panel)
  - `--accent: #ffffff`, `--accent-foreground: #040404`
  - `--ring: #ffffff`
  - `color-scheme: dark` (native date/time pickers)
- Hero action title `h3`: 32px/800 white. Card `h2` eyebrow-style label: 13px/700 uppercase, white 72%.
- `.btn-secondary` inside: transparent, 1px white 40% border, white text. Hover: white 10% fill.
- `.icon-badge` inside: white 10% fill, white icon. The blockquote rule (from §2) is white.
- Inputs inside: transparent, white 24% border, white text.

### 8. Controls

- `.btn`: `--radius-control`, 15px/700. Padding `12px 24px` (min-height 44px below `md`, 40px from `md`). `.btn-sm`: 13px/700, 32px tall from `md`, padding `6px 12px`. `.btn-lg`: 48px tall.
  - Press: `scale(0.97)`, `transform 160ms var(--ease-out)`.
  - Transitions only on `background-color, border-color, color, transform`.
- `.btn-primary`: green fill, ink text, 1px green border. Hover `#86d97b`.
- `.btn-secondary` (outlined ghost): transparent, **1px ink border**, ink text. Hover: `--fog` fill.
- `.btn-ghost`: transparent, no border, ink text with an underline on hover (fine pointers). It stays recognisable as an action through weight 700.
- Disabled: 45% opacity, no press scale (as today).
- Inputs, textareas and selects: white, 1px Smoke `#cbcece` border, `--radius-control`, 16px text (no iOS zoom), pewter placeholder. Focus: ink border and a 2px ink ring with offset.
- `.chip`: pill radius, 1px Ash border, 13px/700. **Checked**: green fill, 1px ink border, ink text. The border change is the non-colour cue.
- Pills: `.pill` is round, 13px/700, padding `4px 12px`.
  - `.pill-above`: green fill, ink text, up-arrow.
  - `.pill-below`: `#fbeee0` fill, `#7a4700` text, down-arrow.
  - `.pill-around`: `--fog` fill, ink text.
  - Arrows and text stay, so colour is never the only cue.
- `.link` (app scope): ink, weight 400, a permanent 1px underline, hover 2px. The underline is the affordance, so links don't need extra weight.

### 9. Charts

Only the tokens change: `--chart-accent: #040404`, `--chart-muted: #a4adad`. The line-chart area fill stays at the existing `opacity={0.1}` (an ink wash). The legend swatches in `analytics-content.tsx` follow automatically, and settled vs. not-settled is still also conveyed by the legend and tooltip text.

### 10. Layout and rhythm

- `.app-main`: `max-width: 75rem` (1200px), centred within the column (`margin-inline: auto`). Padding `24px 16px 64px` → `32px 24px 64px` (`md`) → `40px 40px 80px` (`lg`).
- In the app, `stack-lg` = 32px, `stack-md` = 16px, and `stack-sm` = 8px.
- Card grids use `gap-6` (24px).
- Dashboard order is unchanged: header, Today hero (full width), 3-up grid (Strategy · Performance · What AI learned; `lg` 3 / `md` 2 / mobile 1), AI usage line.
- Onboarding (`.app-canvas`): white canvas, a 64px header with an Ash hairline below the logo, content in the existing narrow container. It inherits every rule above.

### 11. Pages covered (visual check list)

Dashboard, Strategy, Opportunities, Research, Calendar, Studio list, Studio package (`/app/studio/[id]`), Analytics, Post results (`/app/analytics/[id]`), Insights, Settings, Onboarding. None of them needs markup changes beyond §10 spacing. Each must be checked visually (see the manual test).

## AI Behavior

None.

## Security Requirements

No change. No new data access, no client-side privileged calls, and no secrets. `RequireSession` and every `auth.protect()` stay as they are. The font is self-hosted by `next/font` (no runtime third-party request).

## Acceptance Criteria

1. On light **and** dark OS themes, every logged-in page shows a white sidebar, a white top bar with a soft shadow, a white canvas, ink text and Ash-bordered cards with no card shadows.
2. Green `#98e58e` appears only on primary buttons, the active nav item, checked chips, `pill-above` and the logo hexagon. A search of section 11 finds no other use of `--primary` or green hex values as decoration.
3. The app renders in Nunito Sans. There are no 500/600 weights in computed styles of app text (spot-check headings, buttons, nav, `font-semibold` elements). Marketing (`/`) and auth (`/sign-in`) still render in Manrope and look unchanged.
4. Radii: controls are 6px, cards 16px, pills round. No 8/9/10/12/14px radii remain in section 11.
5. The Today card is an ink-black panel in all its states (each recommendation kind, error, skeleton). Its inputs, pills, hook, green primary button, secondary button and links are legible (AA) and work. Native pickers render dark.
6. Links (`.link`, breadcrumb ancestors, back links) are underlined at rest.
7. Focus is visible as an ink ring on every control on white, and a white ring inside the hero.
8. Charts render ink and grey, and the legends match.
9. The dashboard and all pages in §11 hold at 1440 / 1024 / 768 / 375 widths with no horizontal scroll. The sidebar has no visible scrollbar at 1366×768.
10. Motion: the same as the previous pass (press scale, mobile menu from its trigger, the EmptyHero stagger), with reduced-motion fallbacks. No `transition: all`.
11. No changes to `lib/**`, `actions.ts`, services, schemas or tests' expectations. No new npm dependencies.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Manual Test Procedure

1. `pnpm dev`, then sign in. On `/app`: white sidebar with a green **Dashboard** item, white top bar with a shadow and the breadcrumb, a 32px/800 "Dashboard" title, the black Today panel with a green button, and three bordered white cards below it.
2. Click every sidebar item and both detail routes (open a Studio package; open a post's results). Check the active item (green fill, bold), the breadcrumb (underlined ancestors, bold current) and the 32px page title on each.
3. On each page in §11, look for leftovers: green used decoratively, shadows on cards, rounded corners other than 6/16/pill, serif italics, mint left bars.
4. Dashboard: exercise the Today states you can reach (schedule saved idea with the date/time form, review new, plan next week). Tab through: the white focus ring is visible inside the hero.
5. Opportunities / Research: toggle filter chips. Checked chips are green with an ink border.
6. Analytics and post results: charts are ink/grey, the legend matches, and the pills show an arrow plus text.
7. Trigger a toast (save an idea) and open the Clerk user menu: both are white, bordered and in the app font.
8. Resize to 1440 / 1024 / 768 / 375. At mobile width: the top bar with quick create (black), Menu and avatar. The white bordered menu panel opens from its trigger and closes on navigation and Escape.
9. Switch the OS to dark mode: the app is unchanged (light). Check `/` and `/sign-in`: unchanged from before this pass.
10. DevTools: emulate `prefers-reduced-motion: reduce`. The menu only fades and skeletons don't pulse.

## Out of Scope

- Marketing site, auth pages and the design-system specimen page (`app/design-system`).
- An app dark mode.
- New dashboard widgets, KPIs, search, notifications, or any new data.
- Replacing icons or the logo artwork.
- Restructuring page markup beyond spacing utilities.

## Revision 1 (owner feedback after first implementation)

1. **Today card is no longer black.** It uses the same white, Ash-bordered `.card` surface as the Insights cards. It's still set apart by its uppercase label and the 32px/800 action title, and its buttons use the standard app styles (green primary, outlined secondary). The `card-hero` dark scope tokens are removed.
2. **The sidebar's quick-create ("Start in Studio") button is removed.** The owner found its purpose unclear, and Studio is already in the nav. `QuickCreate` stays in the mobile top bar for now.
3. **Breadcrumbs drop the "Dashboard" root crumb** on other pages, because the sidebar already links the dashboard. Section pages show just the section ("Studio"). Detail pages show "Studio › Content package" with the section linked. `/app` still shows "Dashboard". The dashboard icon on the first crumb is removed. `tests/app-shell/breadcrumbs.test.ts` is updated to match.

## Revision 2

The owner meant the **Insights empty-state panel** (the prism-wash gradient), not the white insight cards. The wash is now a single token, `--prism-wash`, used by both `.panel-hero` and the Today card (`.card-hero`). Everything else from Revision 1 is unchanged.

## Revision 3

The quick-create ("+") button is also removed from the mobile/tablet top bar. The `QuickCreate` component and its `.app-quick-create` styles are deleted, since nothing uses them any more. Studio stays reachable from the nav and the mobile menu.
