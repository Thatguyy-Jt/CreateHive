# Global Design System

## Goal

Set up the product's global design system in Tailwind v4 and CSS, so every future page is built from shared tokens and primitives instead of one-off styles. The system should be modeled on the design *principles* of a mature social-media-management marketing site (Metricool, studied as a virtual reference), not its text, assets or branding. It must feel like a modern, confident creator-tools product.

Scope is the foundation only: tokens, typography, containers, spacing, buttons, links and a few reusable responsive primitives. No product features, auth, data or AI.

## Skills Read

None. The approved project skills are Clerk and Supabase, and neither applies to styling.

## Existing Code Inspected

- `app/globals.css`: Tailwind v4 (`@import "tailwindcss"`) with `--background`/`--foreground`, a `@theme inline` block mapping `--font-sans` and `--font-mono`, and a dark-mode media query. `body` hard-codes `font-family: Arial`, which overrides the Geist font set in the layout.
- `app/layout.tsx`: loads Geist and Geist Mono with `next/font/google` and applies their variables on `<html>`.
- `app/page.tsx`: the placeholder landing page from the scaffold-fixes work.
- `next.config.ts`: Tailwind runs through a `@tailwindcss/turbopack` loader rule. There is no PostCSS config and no `tailwind.config`, so all customisation goes in CSS (`@theme`, `@utility`, `@layer`).
- `package.json`: no component library, no `clsx`/`tailwind-merge`, no shadcn yet.

## Reference Analysis (Metricool, studied, not copied)

Source: the live homepage HTML plus its main stylesheet (values below are measured, not guessed).

| Area | What the reference does | Principle we adopt |
|---|---|---|
| Typography | A geometric sans (Plus Jakarta Sans) at weights 400/500/600/700 for everything. An elegant serif in italic is used *only* as a highlighted word inside large headlines. Display sizes use `clamp()`, from 28px on mobile to 56–64px on desktop. Headline line-height is about 1.2 with slightly negative tracking. Body is 16–18px. | One sans for UI and body. One serif accent used sparingly inside headlines. Fluid display scale. Tight headline leading. |
| Colour | A very dark warm neutral is used for text *and* primary buttons (about 384 uses). A single neon accent appears on hover and on dark sections. Supporting pastels are used for section backgrounds and offset shadows. Greys are a small ramp: `#151515`, `#666`, `#B3B3B3`, `#F2F2F2`. | Dark ink as the primary colour. One high-energy accent used sparingly. 4–5 soft tints for section backgrounds. A short neutral ramp. |
| Buttons | Large and chunky: 20px bold text, `24px 40px` padding, 16px radius. The default is dark with accent-coloured text, and it **inverts** to the accent background with dark text on hover. A slower colour transition and an arrow glyph on text links. | Big tap targets. Colour inversion on hover. Rounded-2xl shape. Text-link variant with an arrow. |
| Radius and borders | The radius scale is 8 / 16 / 20px plus pills. Borders are rare and thin. Depth comes from *hard offset shadows* in a pastel (`16px 16px 0 0`) rather than blur. Soft blur shadows are used only on floating UI. | Generous radii. A flat, offset-shadow "sticker" style for featured cards. Minimal borders. |
| Spacing and layout | A 4/8-based rhythm with named steps: 12, 16, 24, 32, 40, 48, 96, 160, 200px. A content container of about 1241px, widening to 1500px on large screens. Sections have large vertical padding that shrinks on mobile. | A named spacing scale and a section-padding primitive that scales with the viewport. One main container, with narrow and wide variants. |
| Navigation | An announcement bar above the header. A logo on the left, grouped dropdown menus, plain links, then a language switcher, login link and a primary CTA on the right. On mobile it collapses to a hamburger with a full-height panel. | Header primitive: bar, logo, links, CTA group. Collapses below `lg`. (Structure only. The real nav is a later feature.) |
| Product presentation | Large product screenshots are the hero. Alternating image/text feature blocks, each with a small eyebrow label, a heading, body copy and a text CTA. A numbered 01–05 benefit grid. An FAQ accordion. Logo strips. | Reusable `Section`, `Eyebrow`, split (media + text) layout and card primitives. |
| Imagery | Real product UI in rounded frames, with soft pastel backdrops and hard offset shadows. | A `media-frame` utility: rounded corners, overflow hidden, optional offset shadow. |
| Responsive | Breakpoints at 767px and 1024px (so about `md` and `lg`). `clamp()` type. Multi-column grids collapse to a single column under 768px. | Mobile-first. We keep Tailwind's `sm 640 / md 768 / lg 1024 / xl 1280` and collapse grids below `md`. |

**Deliberately not copied:** their copy, logos, images, icons, exact hex values (we use our own palette), their exact font pairing (we choose our own, below), and any layout so specific that it would read as a clone.

## Decisions / Assumptions

1. **Own palette, not theirs.** The reference's dark aubergine + neon lime pairing is its brand identity, so we use a different hue family: deep green-black ink with a mint "signal" accent.
2. **Own font pairing.** The reference uses Plus Jakarta Sans plus Bodoni Moda. To avoid mirroring its identity, we use **Manrope** (via `next/font/google`) for body and UI, and **Instrument Serif** (italic) for the headline accent word. Geist is dropped from the sans role and Geist Mono is kept for code.
3. **Tailwind v4 CSS-first.** Tokens go in `@theme` in `app/globals.css`. Reusable primitives use `@utility` and `@layer components`. No `tailwind.config` and no new dependencies.
4. **No component library yet.** shadcn/ui is in the blueprint stack but not installed. We'll make the tokens use shadcn-compatible names (`--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--ring`, `--radius`) so adding it later is straightforward.
5. **Light theme is the designed default, dark mode is supported.** Dark follows `prefers-color-scheme`, as it does today.
6. **No marketing page rebuild.** The only page change is a swatch/specimen route (below) to prove the system works. The placeholder home page stays as is, apart from picking up the new fonts and colours.
7. **No fake functionality.** The header primitive is structure only and is not mounted on any real page.

## Files Likely to Change

| File | Change |
|---|---|
| `app/globals.css` | Replace with the full token layer, base styles, and component/utility primitives |
| `app/layout.tsx` | Swap the fonts to Manrope + Instrument Serif (+ Geist Mono), apply the variables, set the `<body>` classes |
| `app/page.tsx` | Light touch: use the new `container`, `display` and `btn` classes so it reflects the system |
| `app/design-system/page.tsx` (new) | A development-only specimen page showing type scale, colours, spacing, buttons, links and layout primitives, to verify the system visually |

No new packages.

## Database Changes

None.

## Implementation Requirements

### 1. Colour tokens (`@theme` + `:root`)

- **Ink** (primary dark): a 0–950 ramp around a deep green-black, with ~`#10201E` as the main ink.
- **Signal** (accent): a mint ramp, ~`#3DDC97` as the main accent.
- **Tints** (section backgrounds / shadows): `sky`, `blush`, `butter`, `lilac`, each at a light value.
- **Neutrals**: a 5-step grey ramp (`50, 200, 400, 600, 900`), from near-white to near-black.
- **Semantic tokens** (these are what components use): `--background`, `--foreground`, `--surface`, `--surface-muted`, `--primary`, `--primary-foreground`, `--accent`, `--accent-foreground`, `--muted`, `--muted-foreground`, `--border`, `--ring`, and status colours `--success`, `--warning`, `--danger`. All are exposed to Tailwind as `bg-primary`, `text-muted-foreground` and so on.
- Dark mode redefines the semantic tokens only, not the raw ramps.
- Text on every background/foreground pair must meet **WCAG AA (4.5:1)**. The accent is only ever used with dark ink text.

### 2. Typography

- Font tokens: `--font-sans` (Manrope), `--font-display-accent` (Instrument Serif), `--font-mono` (Geist Mono).
- A fluid display scale built on `clamp()`: `text-display-xl` (~40→72px), `text-display-lg` (~34→56px), `text-display-md` (~28→44px), `text-heading` (~22→32px). The standard Tailwind sizes cover body and small text, with a body default of 16px (18px for `lead` text).
- Headlines use leading ~1.1–1.2 and tracking ~`-0.02em`. Body uses ~1.6.
- An `.accent-word` utility: renders a span in the serif italic with the accent colour or underline treatment, for the single highlighted word in a headline.
- An `.eyebrow` utility: small, uppercase, tracked, medium weight, muted.
- Base heading/paragraph styles are applied through `@layer base`, so unstyled `h1`–`h4` and `p` look right.
- Remove the hard-coded `font-family: Arial` from `body`.

### 3. Spacing and containers

- A named spacing scale in `@theme`, following the reference's 4/8 rhythm: `--spacing-section-sm/md/lg` for vertical section padding, which shrinks on mobile and grows on desktop (about 64→96px and 96→160px, via `clamp()`).
- `.container-page`: max-width 1240px, centred, with horizontal gutters of 16px (mobile), 24px (`md`) and 32px (`lg`).
- Variants: `.container-narrow` (~760px, for prose and forms) and `.container-wide` (~1440px).
- `.section`: vertical padding from the section tokens. `.section-tint-*` modifiers set a tinted or dark background and automatically flip the text colour.

### 4. Buttons

A `.btn` base plus variants, all with a minimum tap height of 44px, a visible focus ring, a disabled state and a `transition` of colour only (respecting `prefers-reduced-motion`):

- `.btn-primary`: ink background, accent text. **On hover it inverts**: accent background, ink text.
- `.btn-secondary`: transparent background, 1.5px ink border. On hover it fills with ink.
- `.btn-ghost`: no border, a muted hover background.
- `.btn-accent`: accent background, ink text, for use on dark sections.
- Sizes: `.btn-sm`, default and `.btn-lg` (the chunky hero size, 16px radius).
- A `.btn-block` modifier for full-width on mobile.

### 5. Links

- `.link`: inline link with an underline offset that thickens on hover.
- `.link-arrow`: a text-CTA link with a trailing arrow (a CSS pseudo-element, not an image) that nudges right on hover.
- Global `a:focus-visible` ring.

### 6. Surfaces, borders, radii, shadows

- Radius tokens: `--radius-sm 8px`, `--radius-md 16px`, `--radius-lg 24px`, `--radius-pill`.
- `.card`: a surface background, a 1px border, and the `md` radius.
- `.card-offset`: the flat "sticker" depth, a hard offset shadow in a tint colour (`12px 12px 0 0`) with no blur.
- `.media-frame`: rounded, overflow hidden, with an optional offset shadow, for product screenshots.
- `--shadow-float`: a soft blur shadow used only for floating UI such as menus.

### 7. Reusable responsive primitives

- `.grid-auto-fit`: a responsive card grid (`repeat(auto-fit, minmax(...))`).
- `.split`: a two-column media + text layout that stacks below `md`, with a `.split-reverse` modifier that flips the order only at `md` and above.
- `.stack-*`: vertical rhythm helpers (`stack-sm/md/lg`) using the spacing scale.
- `.site-header` and `.site-header-inner`: a sticky bar with a logo area, a link area and a CTA area, collapsing below `lg`. These are structure-only styles.
- `.announcement-bar`: a slim full-width strip above the header.
- A `.sr-only`-style skip link style (`.skip-link`).

### 8. Specimen page

`app/design-system/page.tsx`: a Server Component that renders every token and primitive above: colour swatches with their names, the type scale, the spacing scale, all button variants and sizes in each state, links, cards, the split layout, and the grid. It is marked `robots: noindex`. It is for development verification only and contains no product claims.

## AI Behavior

None.

## Security Requirements

None affected. Static CSS and server-rendered markup only; no data, secrets or user input. Fonts load through `next/font` (self-hosted at build time, with no runtime requests to Google).

## Acceptance Criteria

- `app/globals.css` is organised into clearly commented sections: tokens, base, typography, layout, buttons, links, surfaces and primitives.
- All semantic colour pairs meet AA contrast in light and dark modes.
- The body font is Manrope (not Arial). Headlines use the fluid scale. The serif italic appears only through `.accent-word`.
- `.btn-primary` visibly inverts on hover. Every interactive element shows a focus ring on keyboard focus.
- At 375px there is no horizontal scroll. `.split` and the grids collapse to one column, and section padding shrinks.
- `/design-system` renders every primitive in light and dark mode.
- `/` still renders and now uses the new fonts and colours.
- No new dependencies were added. `package.json` is unchanged.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm build
```

(No unit tests apply, since this is CSS and static markup. The specimen page is the verification surface.)

## Manual Test Procedure

1. Run `pnpm dev` and open `/design-system`.
2. **Typography:** confirm Manrope is rendering (not Arial), the display sizes scale smoothly while you resize the window, and the serif italic accent word appears only where `.accent-word` is used.
3. **Colour:** check the swatches against the token names. Toggle the OS between light and dark and confirm the semantic colours flip and the text stays readable.
4. **Buttons:** hover each variant (`primary` should invert), Tab through them to see the focus rings, and check the disabled state and the three sizes.
5. **Links:** hover `.link` and `.link-arrow` and confirm the underline and the arrow nudge.
6. **Responsive:** at 1280px, 768px and 375px, confirm the container gutters change, `.split` stacks below 768px, the grid reflows, and there is no horizontal scrolling.
7. **Reduced motion:** enable "reduce motion" in the OS and confirm the hover transitions are disabled.
8. Open `/` and confirm it still renders with the new fonts and colours.

### UI notes

- **Visual interpretation:** confident and flat, in the style of a modern creator-tools product. The look is dark ink, generous whitespace, big rounded buttons, pastel section tints, and hard offset shadows rather than blurry ones. The serif italic accent word adds personality to headlines.
- **Layout:** one centred container, sections separated by large vertical padding, and alternating media/text splits.
- **Typography:** a fluid display scale with tight leading. 16px body (18px lead). Uppercase tracked eyebrows.
- **Spacing:** a 4/8 rhythm with named section steps.
- **Component behavior:** colour inversion on hover (colour transition only, ~200ms), an arrow nudge on text links, and 44px minimum tap targets.
- **Responsive and mobile behavior:** mobile-first. The grids collapse under `md`. The header collapses under `lg`. Gutters step from 16px to 24px to 32px.
- **Loading, empty and error states:** not applicable to this foundation. The `.card` and `.stack-*` primitives are what those states will be built from later.
